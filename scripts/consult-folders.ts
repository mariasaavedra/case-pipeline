// =============================================================================
// Consult folders — plan / report
// =============================================================================
// Replaces the Calendly→Zapier automation that can no longer skip an existing
// folder. Trigger: an item on Appointments R / LB / M whose "Calendly?" status
// is "yes" and which is linked to a profile.
//
//   npm run consult:folders -- --db=live              # plan (local only)
//   npm run consult:folders -- --db=live --match      # + look in SharePoint
//   npm run consult:folders -- --db=live --match --out=plan.csv
//   npm run consult:folders -- --db=live --match --link          # dry run
//   npm run consult:folders -- --db=live --match --link --apply  # writes Monday
//   npm run consult:folders -- --db=live --match --create --year=2026 --limit=5
//   npm run consult:folders -- --db=live --match --create --year=2026 --limit=5 --apply
//   npm run consult:folders -- --db=live --link-file=config/consult-folder-links.json --apply
//
// Plan and match are READ-ONLY. Nothing is created and nothing is written to Monday.
//
// --match matters more than it sounds: most of the backlog predates the broken
// automation, and those folders usually already exist — in Consults, or in
// E-Files/Closed if the client has since hired or closed. Creating without
// checking would put a duplicate next to a client's real file.
// =============================================================================

import Database from "better-sqlite3";
import fs from "node:fs";
import { consultFolderName, consultFolderPath, type NameRefusal } from "./sharepoint/consult-naming.js";
import { graphAuthFromEnv } from "./sharepoint/auth.js";
import { resolveSiteDrive, listChildren, getItemByPath, ensureFolderPath } from "./sharepoint/folders.js";
import { buildFolderIndex, findMatch, looseCandidates, type FolderRef } from "./sharepoint/match.js";
import { GraphError, type GraphAuth } from "./sharepoint/graph-client.js";
import { linkTargetForSite, CONSULT_FILE, type LinkTarget } from "./sharepoint/link-target.js";
import { consultOutcome, type ConsultOutcome } from "./sharepoint/consult-status.js";
import { changeSimpleColumnValue, setApiToken } from "@case-pipeline/monday";

const APPOINTMENT_BOARDS = ["appointments_r", "appointments_lb", "appointments_m"];

const HOST = "sharmacrawford.sharepoint.com";
/** Where a consult folder can legitimately be, in lifecycle order. */
const CONSULTS_SITE = "scalconsults";
const EFILES_SITE = "scalefiles";
const CLOSED_SITE = "SCALClosed";
const INITIALS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
/** Profiles board — config/boards.yaml. */
const PROFILES_BOARD_ID = "8025265377";

interface Row {
  itemLocalId: string;
  boardKey: string;
  itemName: string;
  profileLocalId: string;
  profileMondayId: string | null;
  profileName: string;
  firstName: string | null;
  lastName: string | null;
  consultDate: string | null;
  apptStatus: string | null;
  existingLink: string | null;
}

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}
const flag = (name: string) => process.argv.includes(`--${name}`);

function loadRows(db: Database.Database): Row[] {
  const placeholders = APPOINTMENT_BOARDS.map(() => "?").join(",");
  return db
    .prepare(`
      SELECT
        bi.local_id                                          AS itemLocalId,
        bi.board_key                                         AS boardKey,
        bi.name                                              AS itemName,
        bi.profile_local_id                                  AS profileLocalId,
        p.monday_item_id                                     AS profileMondayId,
        p.name                                               AS profileName,
        json_extract(p.raw_column_values, '$.first_name')    AS firstName,
        json_extract(p.raw_column_values, '$.last_name')     AS lastName,
        json_extract(bi.column_values, '$.consult_date.date') AS consultDate,
        bi.status                                            AS apptStatus,
        -- Any link already recorded, in any of the three places one can live.
        COALESCE(
          NULLIF(TRIM(COALESCE(json_extract(bi.column_values, '$.consult_sharepoint'), '')), ''),
          NULLIF(TRIM(COALESCE(json_extract(p.raw_column_values, '$.consult_file'), '')), ''),
          NULLIF(TRIM(COALESCE(json_extract(p.raw_column_values, '$.e_file'), '')), '')
        )                                                    AS existingLink
      FROM board_items bi
      JOIN profiles p ON p.local_id = bi.profile_local_id
      WHERE bi.board_key IN (${placeholders})
        AND json_extract(bi.column_values, '$.calendly.label') = 'yes'
      ORDER BY consultDate DESC
    `)
    .all(...APPOINTMENT_BOARDS) as Row[];
}

/**
 * Collect every client folder from one site into a flat list of refs.
 *
 * Layout differs per site and is handled explicitly rather than by recursion:
 * Consults nests under {YYYY} Consults/{initial}, E-Files under {initial}, and
 * Closed is flat. A generic crawl would be slower and would wander into the
 * project folders ("EL TORO LOCO", "AIC FOIA LITIGATION") that are not clients.
 */
async function scanSite(
  auth: GraphAuth,
  site: string,
  years: number[],
): Promise<FolderRef[]> {
  const drive = await resolveSiteDrive(auth, HOST, site);
  const found: FolderRef[] = [];

  const collect = async (parentPath: string) => {
    const parent = await getItemByPath(auth, drive.driveId, parentPath);
    if (!parent?.folder) return;
    for (const child of await listChildren(auth, drive.driveId, parent.id)) {
      if (child.folder) {
        found.push({ name: child.name, site, path: `${parentPath}/${child.name}`, webUrl: child.webUrl });
      }
    }
  };

  if (site === CLOSED_SITE) {
    const root = await getItemByPath(auth, drive.driveId, "");
    if (root) {
      for (const child of await listChildren(auth, drive.driveId, root.id)) {
        if (child.folder) found.push({ name: child.name, site, path: child.name, webUrl: child.webUrl });
      }
    }
    return found;
  }

  // Every year folder that EXISTS, not the ones the plan happens to mention.
  // The site has 24 of them going back to 2003; indexing only the planned years
  // (2024-2026) made repeat consults look new and created 5 duplicate folders
  // on 2026-09-03. `years` is kept only to bound the work when a caller asks.
  let parents: string[];
  if (site === CONSULTS_SITE) {
    const root = await getItemByPath(auth, drive.driveId, "");
    const yearDirs = root
      ? (await listChildren(auth, drive.driveId, root.id))
          .filter((c) => c.folder && /consults$/i.test(c.name))
          .map((c) => c.name)
      : years.map((y) => `${y} Consults`);
    parents = yearDirs.flatMap((y) => INITIALS.map((i) => `${y}/${i}`));
  } else {
    parents = INITIALS.map((i) => i);
  }

  for (const parentPath of parents) {
    try {
      await collect(parentPath);
    } catch (err) {
      // A missing initial folder is normal (no 2024 consults starting with Q).
      if (err instanceof GraphError && err.status === 404) continue;
      throw err;
    }
  }
  return found;
}

interface MatchedRow {
  profileLocalId: string;
  profileMondayId: string | null;
  profileName: string;
  path: string;
  where: string;
  how: string;
  webUrl?: string;
}

/**
 * Write the URL of an already-existing folder into the right Monday column.
 *
 * Only ever fills a column that is EMPTY. Re-reads the current value from the
 * database first: the plan may be minutes old, and overwriting a link somebody
 * entered by hand in the meantime would destroy the more trustworthy value.
 */
async function linkExisting(matched: MatchedRow[], db: Database.Database, apply: boolean): Promise<void> {
  const byTarget = new Map<string, { target: LinkTarget; rows: MatchedRow[] }>();
  for (const row of matched) {
    const target = linkTargetForSite(row.where);
    const entry = byTarget.get(target.columnId) ?? { target, rows: [] };
    entry.rows.push(row);
    byTarget.set(target.columnId, entry);
  }

  console.log(`\n${apply ? "Writing" : "Would write"} ${matched.length} folder URLs to Monday:`);
  for (const { target, rows } of byTarget.values()) {
    console.log(`  ${String(rows.length).padStart(4)} → ${target.label} (${target.columnId})`);
  }

  if (!apply) {
    console.log(`\n  Dry run. Re-run with --apply to write them.`);
    return;
  }

  const token = process.env.MONDAY_API_TOKEN?.trim();
  if (!token) {
    console.error(`\n  MONDAY_API_TOKEN is not set — cannot write.`);
    process.exitCode = 1;
    return;
  }
  // The Monday client keeps the token in module state; reading the env var is
  // not enough, it has to be handed over explicitly (as server.ts and the sync
  // both do).
  setApiToken(token);

  const current = db.prepare("SELECT raw_column_values FROM profiles WHERE local_id = ?");
  const receipt: string[] = ["profile_name,monday_item_id,column,url"];
  let written = 0, skipped = 0, failed = 0;

  for (const row of matched) {
    const target = linkTargetForSite(row.where);
    if (!row.profileMondayId || !row.webUrl) {
      skipped++;
      continue;
    }

    const raw = current.get(row.profileLocalId) as { raw_column_values: string | null } | undefined;
    const existing = raw?.raw_column_values
      ? (JSON.parse(raw.raw_column_values) as Record<string, unknown>)[target.columnKey]
      : null;
    if (typeof existing === "string" && existing.trim()) {
      skipped++;
      continue;
    }

    try {
      await changeSimpleColumnValue(PROFILES_BOARD_ID, row.profileMondayId, target.columnId, row.webUrl);
      receipt.push(csvRow([row.profileName, row.profileMondayId, target.label, row.webUrl]));
      written++;
      if (written % 25 === 0) console.log(`    ${written}/${matched.length}…`);
    } catch (err) {
      failed++;
      console.error(`    FAILED ${row.profileName}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // A receipt, because this changed live client records and "what did it do"
  // must be answerable without trawling Monday's activity log.
  const receiptPath = `output/consult-links-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
  fs.mkdirSync("output", { recursive: true });
  fs.writeFileSync(receiptPath, receipt.join("\n"));

  console.log(`\n  written ${written}   skipped ${skipped}   failed ${failed}`);
  console.log(`  receipt: ${receiptPath}`);
}

/**
 * Create the folders that genuinely do not exist, then record each URL.
 *
 * Runs AFTER --match by construction: creating without having looked is how a
 * duplicate lands next to a client's real file. The year and initial folders
 * already exist in SCAL Consults (all 26 letters, every year), so in practice
 * only the leaf is created — but ensureFolderPath still walks the whole path,
 * because a new year rolls over eventually and that day should not be an
 * outage.
 *
 * Creation and recording are deliberately one step: a folder created without
 * its URL written back is invisible to everyone, and the next run would not
 * even know to look for it.
 */
async function createMissing(
  auth: GraphAuth,
  rows: Array<Row & { path: string }>,
  db: Database.Database,
  apply: boolean,
): Promise<void> {
  const drive = await resolveSiteDrive(auth, HOST, CONSULTS_SITE);

  console.log(`\n${apply ? "Creating" : "Would create"} ${rows.length} folder(s) in ${drive.siteName}:`);
  for (const row of rows) console.log(`  ${row.path}`);

  if (!apply) {
    console.log(`\n  Dry run. Re-run with --apply to create them.`);
    return;
  }

  const token = process.env.MONDAY_API_TOKEN?.trim();
  if (!token) {
    console.error(`\n  MONDAY_API_TOKEN is not set — refusing to create folders we cannot record.`);
    process.exitCode = 1;
    return;
  }
  setApiToken(token);

  const current = db.prepare("SELECT raw_column_values FROM profiles WHERE local_id = ?");
  const receipt: string[] = ["profile_name,monday_item_id,path,outcome,url,recorded"];
  let created = 0, existed = 0, failed = 0, recorded = 0;

  for (const row of rows) {
    try {
      const results = await ensureFolderPath(auth, drive.driveId, row.path, true);
      const leaf = results[results.length - 1]!;
      if (leaf.outcome === "created") created++;
      else existed++;

      const url = leaf.item?.webUrl;
      let didRecord = false;

      if (url && row.profileMondayId) {
        const raw = current.get(row.profileLocalId) as { raw_column_values: string | null } | undefined;
        const existing = raw?.raw_column_values
          ? (JSON.parse(raw.raw_column_values) as Record<string, unknown>).consult_file
          : null;
        if (!(typeof existing === "string" && existing.trim())) {
          await changeSimpleColumnValue(PROFILES_BOARD_ID, row.profileMondayId, CONSULT_FILE.columnId, url);
          didRecord = true;
          recorded++;
        }
      }

      console.log(`  ${leaf.outcome === "created" ? "created " : "existed "} ${row.path}${didRecord ? "  → recorded" : ""}`);
      receipt.push(csvRow([row.profileName, row.profileMondayId, row.path, leaf.outcome, url ?? "", String(didRecord)]));
    } catch (err) {
      failed++;
      console.error(`  FAILED  ${row.path}: ${err instanceof Error ? err.message : String(err)}`);
      receipt.push(csvRow([row.profileName, row.profileMondayId, row.path, "failed", "", "false"]));
    }
  }

  const receiptPath = `output/consult-created-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
  fs.mkdirSync("output", { recursive: true });
  fs.writeFileSync(receiptPath, receipt.join("\n"));

  console.log(`\n  created ${created}   already existed ${existed}   failed ${failed}   URLs recorded ${recorded}`);
  console.log(`  receipt: ${receiptPath}`);
}

/**
 * Record folders a PERSON has confirmed, from a reviewed file.
 *
 * Some folders no rule can reach: one filed under a middle name, a shared
 * folder for a couple sitting under the other party's initial, a folder whose
 * surname differs from the profile's. Guessing at those is how a client gets
 * attached to a stranger's file, so instead a human confirms the pairing and it
 * is recorded here, with a note saying who decided and when.
 *
 * The file is the audit trail. It is committed, so the reasoning survives.
 */
async function linkFromFile(auth: GraphAuth, filePath: string, db: Database.Database, apply: boolean): Promise<void> {
  const entries = JSON.parse(fs.readFileSync(filePath, "utf8")) as Array<{
    profileMondayId: string; profileName: string; site: string; path: string; note?: string;
  }>;

  console.log(`\n${apply ? "Recording" : "Would record"} ${entries.length} human-confirmed link(s) from ${filePath}:\n`);

  const token = process.env.MONDAY_API_TOKEN?.trim();
  if (apply) {
    if (!token) {
      console.error("  MONDAY_API_TOKEN is not set — cannot write.");
      process.exitCode = 1;
      return;
    }
    setApiToken(token);
  }

  let done = 0, failed = 0;
  for (const entry of entries) {
    const target = linkTargetForSite(entry.site);
    try {
      const drive = await resolveSiteDrive(auth, HOST, entry.site);
      const item = await getItemByPath(auth, drive.driveId, entry.path);
      if (!item?.folder) {
        console.error(`  NOT FOUND  ${entry.profileName}: ${entry.site}/${entry.path}`);
        failed++;
        continue;
      }
      console.log(`  ${entry.profileName}`);
      console.log(`      ${target.label} ← ${entry.site}/${entry.path}`);
      if (apply) {
        await changeSimpleColumnValue(PROFILES_BOARD_ID, entry.profileMondayId, target.columnId, item.webUrl);
        done++;
      }
    } catch (err) {
      failed++;
      console.error(`  FAILED  ${entry.profileName}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(apply ? `\n  recorded ${done}   failed ${failed}` : `\n  Dry run. Re-run with --apply to record them.`);
}

async function main() {
  const dbPath = (arg("db") ?? "seed") === "live" ? "data/live.db" : "data/seed.db";
  const out = arg("out");

  const db = new Database(dbPath, { readonly: true });

  const linkFile = arg("link-file");
  if (linkFile) {
    await linkFromFile(graphAuthFromEnv(), linkFile, db, flag("apply"));
    return;
  }

  const rows = loadRows(db);

  const planned: Array<Row & { path: string }> = [];
  const refused: Array<Row & { reason: NameRefusal; detail: string }> = [];
  const alreadyLinked: Row[] = [];
  const noDate: Row[] = [];

  for (const row of rows) {
    if (row.existingLink) {
      alreadyLinked.push(row);
      continue;
    }
    if (!row.consultDate) {
      noDate.push(row);
      continue;
    }
    const result = consultFolderName({ firstName: row.firstName, lastName: row.lastName });
    if (!result.ok) {
      refused.push({ ...row, reason: result.reason, detail: result.detail });
      continue;
    }
    const year = Number(row.consultDate.slice(0, 4));
    planned.push({ ...row, path: consultFolderPath(year, result.name) });
  }

  console.log(`Calendly consults on ${APPOINTMENT_BOARDS.join(", ")}: ${rows.length}\n`);
  console.log(`  already linked (skip)     ${alreadyLinked.length}`);
  console.log(`  no consult date (skip)    ${noDate.length}`);
  console.log(`  NEEDS A FOLDER            ${planned.length}`);
  console.log(`  needs a human             ${refused.length}`);

  const byYear = new Map<string, number>();
  for (const p of planned) byYear.set(p.path.slice(0, 4), (byYear.get(p.path.slice(0, 4)) ?? 0) + 1);
  console.log(`\n  by year: ${[...byYear].sort().reverse().map(([y, n]) => `${y}=${n}`).join("  ")}`);

  // Did the consultation actually take place? Only those get a folder.
  const byOutcome = new Map<ConsultOutcome, number>();
  for (const p of planned) {
    const o = consultOutcome(p.apptStatus);
    byOutcome.set(o, (byOutcome.get(o) ?? 0) + 1);
  }
  console.log(`  by outcome:`);
  for (const o of ["proceeded", "not-yet", "did-not-happen", "unknown"] as ConsultOutcome[]) {
    if (byOutcome.get(o)) console.log(`      ${String(byOutcome.get(o)).padStart(4)}  ${o}`);
  }

  // ---- Optional: look in SharePoint before believing any of this ----------
  const matched: Array<(typeof planned)[number] & { where: string; how: string; webUrl?: string }> = [];
  const ambiguousRows: Array<(typeof planned)[number] & { candidates: string }> = [];
  let missing = planned;

  if (flag("match")) {
    const auth = graphAuthFromEnv();
    console.log(`\nScanning SharePoint as ${auth.describe()} — read-only…`);

    const years = [...new Set(planned.map((p) => Number(p.path.slice(0, 4))))].sort();
    const refs: FolderRef[] = [];
    for (const site of [CONSULTS_SITE, EFILES_SITE, CLOSED_SITE]) {
      const found = await scanSite(auth, site, years);
      console.log(`  ${site.padEnd(14)} ${found.length} client folders`);
      refs.push(...found);
    }

    const index = buildFolderIndex(refs);
    const stillMissing: typeof planned = [];
    for (const row of planned) {
      const folderName = row.path.slice(row.path.lastIndexOf("/") + 1);
      const { match, ambiguous } = findMatch(index, folderName);
      if (match) {
        const also = match.alsoIn.length ? ` (+${match.alsoIn.length} more)` : "";
        matched.push({ ...row, where: match.folder.site, how: `${match.confidence}${also}`, webUrl: match.folder.webUrl });
        continue;
      }
      if (ambiguous.length) {
        ambiguousRows.push({ ...row, candidates: ambiguous.map((a) => `${a.site}:${a.name}`).join(" | ") });
        continue;
      }
      // Same surname, and one given name is a truncation of the other. Might be
      // the same person under a fuller name; might be a father and son. Either
      // way it must not become a new folder without someone looking.
      const loose = looseCandidates(index, folderName);
      if (loose.length) {
        ambiguousRows.push({ ...row, candidates: `POSSIBLE: ${loose.map((a) => `${a.site}:${a.name}`).join(" | ")}` });
        continue;
      }
      stillMissing.push(row);
    }
    missing = stillMissing;

    const byWhere = new Map<string, number>();
    for (const m of matched) byWhere.set(m.where, (byWhere.get(m.where) ?? 0) + 1);

    console.log(`\n  ALREADY EXISTS            ${matched.length}`);
    for (const [where, n] of byWhere) console.log(`      on ${where.padEnd(14)} ${n}`);
    console.log(`  needs a human (ambiguous  ${ambiguousRows.length}`);
    console.log(`    or a possible match)`);
    console.log(`  GENUINELY MISSING         ${missing.length}`);
  }

  // ---- Optional: record the folders that already exist -------------------
  if (flag("link")) {
    await linkExisting(matched, db, flag("apply"));
  }

  if (flag("create")) {
    if (!flag("match")) {
      console.error("\n  --create requires --match: creating without looking first is how duplicates happen.");
      process.exitCode = 1;
      return;
    }
    const year = arg("year");
    const limit = Number(arg("limit") ?? 0);
    let batch = year ? missing.filter((m) => m.path.startsWith(`${year} `)) : missing;
    // A folder belongs to a consultation that happened. Anything cancelled,
    // still upcoming, or carrying a status we don't recognise is left alone
    // unless explicitly asked for.
    if (!flag("include-all-outcomes")) {
      const before = batch.length;
      batch = batch.filter((m) => consultOutcome(m.apptStatus) === "proceeded");
      if (before !== batch.length) {
        console.log(`\n  Skipping ${before - batch.length} whose consult did not proceed (or has not yet).`);
      }
    }
    if (limit > 0) batch = batch.slice(0, limit);
    await createMissing(graphAuthFromEnv(), batch, db, flag("apply"));
  }

  console.log(`\nSample of what would be created:`);
  for (const p of missing.slice(0, 12)) {
    console.log(`  ${p.path}`);
    console.log(`      profile: ${p.profileName}`);
  }

  if (refused.length) {
    const byReason = new Map<NameRefusal, number>();
    for (const r of refused) byReason.set(r.reason, (byReason.get(r.reason) ?? 0) + 1);
    console.log(`\nRefused — these need a name fixed in Monday, not a guess here:`);
    for (const [reason, n] of byReason) console.log(`  ${String(n).padStart(4)}  ${reason}`);
    console.log(`\n  examples:`);
    for (const r of refused.slice(0, 6)) console.log(`    ${r.profileName}  →  ${r.detail}`);
  }

  if (out) {
    const csv = [
      "status,path,profile_name,first_name,last_name,consult_date,board,detail",
      ...missing.map((p) =>
        csvRow(["create", p.path, p.profileName, p.firstName, p.lastName, p.consultDate, p.boardKey, ""]),
      ),
      ...matched.map((m) =>
        csvRow(["exists", m.path, m.profileName, m.firstName, m.lastName, m.consultDate, m.boardKey, `${m.how} match on ${m.where}`]),
      ),
      ...ambiguousRows.map((a) =>
        csvRow(["ambiguous", a.path, a.profileName, a.firstName, a.lastName, a.consultDate, a.boardKey, a.candidates]),
      ),
      ...refused.map((r) =>
        csvRow(["review", "", r.profileName, r.firstName, r.lastName, r.consultDate, r.boardKey, r.detail]),
      ),
    ].join("\n");
    fs.writeFileSync(out, csv);
    console.log(`\nWrote ${missing.length + matched.length + ambiguousRows.length + refused.length} rows to ${out}`);
  }

  console.log(`\nNothing was created and nothing was written to Monday — this is a plan only.`);
}

function csvRow(values: Array<string | null>): string {
  return values.map((v) => `"${(v ?? "").replace(/"/g, '""')}"`).join(",");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
