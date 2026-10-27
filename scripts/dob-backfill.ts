// =============================================================================
// Date of birth backfill — Jail Intake → Profile
// =============================================================================
//   npm run dob:backfill                     dry run (default): who would get what
//   npm run dob:backfill -- --apply          write to Monday
//   npm run dob:backfill -- --apply --limit=5
//
// The Monday automation that turns a paid Jail Intake into an appointment +
// profile did not copy the date of birth. This fills a Profile's empty
// "Date of Birth" (text2__1) from the Jail Intake linked to any of its
// appointments (the same path as the Fee K auto-fill's POC). A profile whose
// intakes disagree on the date is listed and left alone. Each profile is
// re-read from Monday before writing: only an empty column is filled.
// A dry run opens live.db read-only and never calls Monday.
// =============================================================================

import Database from "better-sqlite3";
import { fetchItemsByIds, changeMultipleColumnValues, setApiToken } from "@case-pipeline/monday";
import { countMondayCalls } from "./lib/monday-usage.js";

const PROFILE_DOB_COLUMN = "text2__1";

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/**
 * The intake's free-text date as MM/DD/YYYY (the profiles' own format), or null
 * when it isn't clearly a date: "6/1/1990", "03-01-1972", "01.07.1987",
 * "1993-03-22", "July 9, 1989" and "09-17-88" work; "254-023-886", "00-00-00"
 * and a two-digit year under 30 ("02-02-02": 1902 or 2002?) don't.
 */
function normalizeDob(text: string): string | null {
  const t = text.trim().replace(/\s+/g, " ");
  let m: RegExpMatchArray | null;
  let y: number, mo: number, d: number;
  if ((m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) [y, mo, d] = [+m[1]!, +m[2]!, +m[3]!];
  else if ((m = t.match(/^(\d{1,2}) ?[/.-] ?(\d{1,2}) ?[/.-] ?(\d{2}|\d{4})$/))) {
    [mo, d, y] = [+m[1]!, +m[2]!, +m[3]!];
    if (m[3]!.length === 2) {
      if (y < 30) return null;
      y += 1900;
    }
  } else if ((m = t.match(/^([A-Za-z]+)\.? (\d{1,2}),? (\d{4})$/))) {
    mo = MONTHS.findIndex((n) => n.startsWith(m![1]!.toLowerCase()) && m![1]!.length >= 3) + 1;
    [d, y] = [+m[2]!, +m[3]!];
  } else return null;
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (mo < 1 || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  if (y < 1920 || y > new Date().getUTCFullYear() - 10) return null;
  return `${String(mo).padStart(2, "0")}/${String(d).padStart(2, "0")}/${y}`;
}

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const apply = process.argv.includes("--apply");
const limit = Number(arg("limit") ?? Infinity);
const dbPath = (arg("db") ?? "live") === "live" ? "data/live.db" : "data/seed.db";
const db = new Database(dbPath, { readonly: !apply });

const rows = db.prepare(`
  SELECT p.local_id AS localId, p.monday_item_id AS profileId, p.name,
         ji.monday_item_id AS intakeId, ji.name AS intakeName,
         TRIM(json_extract(ji.column_values, '$.date_of_birth')) AS dob
    FROM profiles p
    JOIN board_items a ON a.board_key LIKE 'appointments_%' AND a.deleted_at IS NULL AND a.profile_local_id = p.local_id
    JOIN json_each(a.column_values) rel ON rel.key LIKE '%jail_intakes%' AND rel.type = 'object'
    JOIN json_each(json_extract(rel.value, '$.linked_item_ids')) link
    JOIN board_items ji ON ji.board_key = '_fa_jail_intakes' AND ji.deleted_at IS NULL AND ji.monday_item_id = CAST(link.value AS TEXT)
   WHERE p.deleted_at IS NULL AND p.monday_item_id IS NOT NULL
     AND COALESCE(TRIM(p.date_of_birth), '') = ''
     AND COALESCE(TRIM(json_extract(ji.column_values, '$.date_of_birth')), '') <> ''
   GROUP BY p.local_id, ji.monday_item_id
   ORDER BY p.name
`).all() as { localId: string; profileId: string; name: string; intakeId: string; intakeName: string; dob: string }[];

type Candidate = { localId: string; profileId: string; name: string; dob: string; intakes: string[] };
const byProfile = new Map<string, typeof rows>();
for (const r of rows) byProfile.set(r.profileId, [...(byProfile.get(r.profileId) ?? []), r]);

const candidates: Candidate[] = [];
const conflicts: { name: string; profileId: string; dobs: string[] }[] = [];
const unreadable: { name: string; profileId: string; text: string }[] = [];
for (const [profileId, rs] of byProfile) {
  const parsed = rs.map((r) => ({ r, dob: normalizeDob(r.dob) }));
  for (const p of parsed) if (!p.dob) unreadable.push({ name: p.r.name, profileId, text: p.r.dob });
  const dobs = [...new Set(parsed.flatMap((p) => (p.dob ? [p.dob] : [])))];
  if (dobs.length === 0) continue;
  if (dobs.length > 1) {
    conflicts.push({ name: rs[0]!.name, profileId, dobs });
    continue;
  }
  candidates.push({ localId: rs[0]!.localId, profileId, name: rs[0]!.name, dob: dobs[0]!, intakes: rs.map((r) => r.intakeName) });
}

const todo = candidates.slice(0, limit);
const written: Candidate[] = [];
const skipped: { c: Candidate; reason: string }[] = [];
const failed: { c: Candidate; error: string }[] = [];

if (!apply) {
  for (const c of todo) console.log(`[dob] would fill ${c.name} (${c.profileId}): ${c.dob}  ← ${c.intakes.join(" | ")}`);
} else {
  const token = process.env.MONDAY_API_TOKEN;
  if (!token) {
    console.error("MONDAY_API_TOKEN is not set.");
    process.exit(1);
  }
  setApiToken(token);
  countMondayCalls("dob-backfill", dbPath);
  const setLocal = db.prepare(`
    UPDATE profiles SET date_of_birth = ?,
           raw_column_values = json_set(COALESCE(raw_column_values, '{}'), '$.date_of_birth', ?)
     WHERE local_id = ?`);

  // Re-read every profile from Monday first: someone may have typed it since the last sync.
  const live = new Map((await fetchItemsByIds(todo.map((c) => c.profileId))).map((i) => [i.id, i]));
  for (const c of todo) {
    const item = live.get(c.profileId);
    if (!item?.board?.id) {
      skipped.push({ c, reason: "not on Monday" });
      continue;
    }
    const current = (item.column_values.find((v) => v.id === PROFILE_DOB_COLUMN)?.text ?? "").trim();
    if (current) {
      setLocal.run(current, current, c.localId);
      skipped.push({ c, reason: `already set on Monday (${current})` });
      continue;
    }
    try {
      await changeMultipleColumnValues(item.board.id, c.profileId, { [PROFILE_DOB_COLUMN]: c.dob });
      setLocal.run(c.dob, c.dob, c.localId);
      written.push(c);
      console.log(`[dob] filled ${c.name} (${c.profileId}): ${c.dob}`);
    } catch (err) {
      failed.push({ c, error: err instanceof Error ? err.message : String(err) });
    }
  }
}

console.log(
  `\n${apply ? "" : "DRY RUN — "}${candidates.length} profile(s) with no date of birth whose Jail Intake has a readable one; ` +
    `${apply ? `filled ${written.length}, skipped ${skipped.length}, failed ${failed.length}` : `would fill ${todo.length}`}.`,
);
for (const s of skipped) console.log(`  skipped ${s.c.name} (${s.c.profileId}): ${s.reason}`);
for (const f of failed) console.log(`  FAILED ${f.c.name} (${f.c.profileId}): ${f.error}`);
for (const x of conflicts) console.log(`  left alone ${x.name} (${x.profileId}): intakes disagree — ${x.dobs.join(" vs ")}`);
for (const x of unreadable) console.log(`  not a date ${x.name} (${x.profileId}): intake says "${x.text}"`);
if (!apply) console.log("Nothing was written. Add --apply to write.");
db.close();
process.exit(failed.length ? 1 : 0);
