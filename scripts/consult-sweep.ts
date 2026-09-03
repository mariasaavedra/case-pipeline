// =============================================================================
// Consult folder sweep — scheduled entry point
// =============================================================================
// The replacement for the Calendly→Zapier automation.
//
//   npm run consult:sweep                 # dry run, last 45 days
//   npm run consult:sweep -- --apply      # act
//   npm run consult:sweep -- --days=90 --apply
//
// Runs against live.db to find candidates, then verifies each one against
// SharePoint and Monday directly before doing anything. It is safe to run
// often: everything it does is idempotent, and a consult that already has a
// folder recorded is skipped without a single API call.
// =============================================================================

import Database from "better-sqlite3";
import fs from "node:fs";
import { setApiToken, mondayRequest } from "@case-pipeline/monday";
import { graphAuthFromEnv } from "./sharepoint/auth.js";
import { decide, perform, ensureConsultDoc, type SweepCandidate } from "./sharepoint/sweep.js";
import { consultOutcome } from "./sharepoint/consult-status.js";
import { consultFolderName, consultFolderPath } from "./sharepoint/consult-naming.js";
import { cachedAccount } from "./sharepoint/auth.js";
import { renderDocxTemplate } from "@case-pipeline/template";
import type { TimelineNote } from "./sharepoint/consult-note.js";

const APPOINTMENT_BOARDS = ["appointments_r", "appointments_lb", "appointments_m"];
const PROFILES_BOARD_ID = "8025265377";

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const flag = (n: string) => process.argv.includes(`--${n}`);

function loadCandidates(db: Database.Database, days: number): SweepCandidate[] {
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const placeholders = APPOINTMENT_BOARDS.map(() => "?").join(",");
  return db
    .prepare(`
      SELECT
        bi.profile_local_id                                   AS profileLocalId,
        p.monday_item_id                                      AS profileMondayId,
        p.name                                                AS profileName,
        json_extract(p.raw_column_values, '$.first_name')     AS firstName,
        json_extract(p.raw_column_values, '$.last_name')      AS lastName,
        json_extract(bi.column_values, '$.consult_date.date') AS consultDate,
        bi.status                                             AS apptStatus,
        p.raw_column_values                                   AS profileJson,
        bi.column_values                                      AS apptJson,
        COALESCE(
          NULLIF(TRIM(COALESCE(json_extract(bi.column_values, '$.consult_sharepoint'), '')), ''),
          NULLIF(TRIM(COALESCE(json_extract(p.raw_column_values, '$.consult_file'), '')), ''),
          NULLIF(TRIM(COALESCE(json_extract(p.raw_column_values, '$.e_file'), '')), '')
        )                                                     AS existingLink
      FROM board_items bi
      JOIN profiles p ON p.local_id = bi.profile_local_id
      WHERE bi.board_key IN (${placeholders})
        AND json_extract(bi.column_values, '$.calendly.label') = 'yes'
        AND json_extract(bi.column_values, '$.consult_date.date') >= ?
      ORDER BY consultDate DESC
    `)
    .all(...APPOINTMENT_BOARDS, since) as SweepCandidate[];
}

/**
 * Read a column straight from Monday.
 *
 * live.db lags Monday by up to a sync interval, so a link somebody entered by
 * hand ten minutes ago is invisible to the query above. Checking Monday before
 * writing means the sweep can never clobber a fresher, more trustworthy value.
 */
async function currentValue(itemId: string, columnId: string): Promise<string> {
  const res = await mondayRequest<{ data: { items: Array<{ column_values: Array<{ text: string | null }> }> } }>(
    `query ($id: [ID!], $col: [String!]) {
       items(ids: $id) { column_values(ids: $col) { text } }
     }`,
    { id: [itemId], col: [columnId] },
  );
  return res.data.items[0]?.column_values[0]?.text?.trim() ?? "";
}



/** Activity types that can hold a consult note. See sharepoint/consult-note.ts. */
const NOTE_ACTIVITY_TYPES = ["Consult note", "Casenote"];

/**
 * Timeline notes for the candidates, in ONE query.
 *
 * Batch-loaded rather than per-candidate: 124k rows in client_updates, and the
 * repo's own pattern for multi-profile reads is IN (...) plus a group, not a
 * sub-query per row (see libs/query/src/appointments.ts).
 */
function loadTimelineNotes(
  db: Database.Database,
  profileIds: string[],
): Map<string, TimelineNote[]> {
  const byProfile = new Map<string, TimelineNote[]>();
  if (!profileIds.length) return byProfile;

  const ids = profileIds.map(() => "?").join(",");
  const types = NOTE_ACTIVITY_TYPES.map(() => "?").join(",");
  const rows = db
    .prepare(`
      SELECT profile_local_id AS pid, activity_type_name AS activityType,
             text_body AS text, author_name AS author,
             substr(created_at_source, 1, 10) AS date
      FROM client_updates
      WHERE profile_local_id IN (${ids})
        AND activity_type_name IN (${types})
        AND TRIM(COALESCE(text_body, '')) <> ''
    `)
    .all(...profileIds, ...NOTE_ACTIVITY_TYPES) as Array<TimelineNote & { pid: string }>;

  for (const { pid, ...note } of rows) {
    const list = byProfile.get(pid) ?? [];
    list.push(note);
    byProfile.set(pid, list);
  }
  return byProfile;
}

/** Cached so the template is read from disk once per run, not once per client. */
let templateBuffer: Buffer | null = null;
function consultTemplate(): Buffer {
  templateBuffer ??= fs.readFileSync("templates/consult-summary.docx");
  return templateBuffer;
}

/**
 * Ensure the CONSULT subfolder, and write the summary once the consult has
 * actually happened.
 *
 * Only for folders in SCAL Consults. A client whose folder has already moved to
 * E-Files or Closed has hired or finished, and putting a consult summary into
 * their case file is not this automation's business.
 */
async function maybeWriteConsultDoc(
  auth: ReturnType<typeof graphAuthFromEnv>,
  c: SweepCandidate,
  consultPath: string,
  actionKind: "create" | "link",
  timeline: TimelineNote[],
) {
  if (actionKind === "link" && !consultPath.includes(" Consults/")) return null;

  const named = consultFolderName({ firstName: c.firstName, lastName: c.lastName });
  if (!named.ok || !c.consultDate) return null;
  const pathInSite = consultFolderPath(Number(c.consultDate.slice(0, 4)), named.name);

  const parse = (raw: string | null | undefined): Record<string, unknown> => {
    if (!raw) return {};
    try {
      const v = JSON.parse(raw) as unknown;
      return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  };

  return ensureConsultDoc(
    auth,
    pathInSite,
    {
      profileName: c.profileName,
      profile: parse(c.profileJson),
      appointment: parse(c.apptJson),
      timeline,
      apptStatus: c.apptStatus,
      consultDate: c.consultDate,
    },
    (vars) => renderDocxTemplate(consultTemplate(), vars),
    // The document waits for the consultation to have taken place.
    { writeDocument: consultOutcome(c.apptStatus) === "proceeded", account: cachedAccount() },
  );
}

async function main() {
  const days = Number(arg("days") ?? 45);
  const apply = flag("apply");
  const dbPath = (arg("db") ?? "live") === "live" ? "data/live.db" : "data/seed.db";

  const db = new Database(dbPath, { readonly: true });
  const candidates = loadCandidates(db, days);
  const notesByProfile = loadTimelineNotes(db, [...new Set(candidates.map((c) => c.profileLocalId))]);

  const token = process.env.MONDAY_API_TOKEN?.trim();
  if (apply) {
    if (!token) {
      console.error("MONDAY_API_TOKEN is not set — refusing to create folders we cannot record.");
      process.exit(1);
    }
    setApiToken(token);
  }

  const auth = graphAuthFromEnv();
  console.log(`[sweep] ${candidates.length} Calendly consults in the last ${days} days`);
  console.log(`[sweep] ${apply ? "APPLY" : "dry run"} — ${auth.describe()}`);

  const tally = { linked: 0, created: 0, skipped: 0, failed: 0, docs: 0 };
  const receipt: string[] = ["action,profile,monday_item_id,path,url,detail"];

  for (const c of candidates) {
    // Skipping on the local value first keeps the common case free of API calls.
    if (c.existingLink) {
      tally.skipped++;
      continue;
    }

    try {
      const decision = await decide(auth, c);
      if (decision.action.kind === "skip") {
        tally.skipped++;
        receipt.push(row(["skip", c.profileName, c.profileMondayId, "", "", decision.action.reason]));
        continue;
      }

      const { kind, path, target } = decision.action;
      if (!apply) {
        console.log(`  would ${kind}  ${path}   [${c.profileName}]`);
        receipt.push(row([`would-${kind}`, c.profileName, c.profileMondayId, path, "", target.label]));
        continue;
      }

      const live = await currentValue(c.profileMondayId!, target.columnId);
      if (live) {
        tally.skipped++;
        receipt.push(row(["skip", c.profileName, c.profileMondayId, path, "", `${target.label} already set in Monday`]));
        continue;
      }

      const result = await perform(auth, decision, async (columnId, url) => {
        await mondayRequest(
          `mutation ($b: ID!, $i: ID!, $c: String!, $v: String!) {
             change_simple_column_value(board_id: $b, item_id: $i, column_id: $c, value: $v) { id }
           }`,
          { b: PROFILES_BOARD_ID, i: c.profileMondayId, c: columnId, v: url },
        );
      });

      if (result.outcome === "linked") tally.linked++;
      else if (result.outcome === "created") tally.created++;
      console.log(`  ${result.outcome}  ${path}   [${c.profileName}]`);
      receipt.push(row([result.outcome, c.profileName, c.profileMondayId, path, result.url ?? "", target.label]));

      // The CONSULT subfolder and its summary. Only for a folder in Consults —
      // a client whose folder has moved to E-Files or Closed is past this stage.
      if (kind === "create" || kind === "link") {
        const doc = await maybeWriteConsultDoc(auth, c, path, kind, notesByProfile.get(c.profileLocalId) ?? []);
        if (doc) {
          tally.docs++;
          console.log(`      CONSULT/${doc.kind === "left-alone" ? `${doc.name} — left alone (${doc.reason})` : doc.name}`);
          receipt.push(row([`doc-${doc.kind}`, c.profileName, c.profileMondayId, path, "", "name" in doc ? doc.name : ""]));
        }
      }
    } catch (err) {
      tally.failed++;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  FAILED  ${c.profileName}: ${message}`);
      receipt.push(row(["failed", c.profileName, c.profileMondayId, "", "", message]));
    }
  }

  console.log(
    `[sweep] created ${tally.created}  linked ${tally.linked}  docs ${tally.docs}  ` +
      `skipped ${tally.skipped}  failed ${tally.failed}`,
  );

  if (apply && (tally.created || tally.linked || tally.failed)) {
    fs.mkdirSync("output", { recursive: true });
    const path = `output/consult-sweep-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
    fs.writeFileSync(path, receipt.join("\n"));
    console.log(`[sweep] receipt: ${path}`);
  }

  // A failure must be visible to whatever scheduled this.
  if (tally.failed) process.exitCode = 1;
}

function row(values: Array<string | null>): string {
  return values.map((v) => `"${(v ?? "").replace(/"/g, '""')}"`).join(",");
}

main().catch((err) => {
  console.error("[sweep]", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
