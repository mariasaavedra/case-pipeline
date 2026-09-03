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
import { decide, perform, type SweepCandidate } from "./sharepoint/sweep.js";

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

async function main() {
  const days = Number(arg("days") ?? 45);
  const apply = flag("apply");
  const dbPath = (arg("db") ?? "live") === "live" ? "data/live.db" : "data/seed.db";

  const db = new Database(dbPath, { readonly: true });
  const candidates = loadCandidates(db, days);

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

  const tally = { linked: 0, created: 0, skipped: 0, failed: 0 };
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
    } catch (err) {
      tally.failed++;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  FAILED  ${c.profileName}: ${message}`);
      receipt.push(row(["failed", c.profileName, c.profileMondayId, "", "", message]));
    }
  }

  console.log(
    `[sweep] created ${tally.created}  linked ${tally.linked}  skipped ${tally.skipped}  failed ${tally.failed}`,
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
