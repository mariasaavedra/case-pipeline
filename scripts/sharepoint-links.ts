// =============================================================================
// SharePoint folder index + profile link backfill
// =============================================================================
// Indexes every client folder in SCAL Consults / E-Files / Closed into
// sp_folders, then proposes a folder for every profile whose E-File or
// Consult File column is empty. See scripts/sharepoint/profile-links.ts for
// the rules and docs/features/sharepoint-catalog.md for the why.
//
//   npm run sharepoint:links -- --db=live                  # scan + report (read-only)
//   npm run sharepoint:links -- --db=live --cached         # report from the last scan
//   npm run sharepoint:links -- --db=live --apply --limit=10          # write 10 (high only)
//   npm run sharepoint:links -- --db=live --apply                     # write every high
//   npm run sharepoint:links -- --db=live --apply --include-medium    # + medium
//   npm run sharepoint:links -- --db=live --column=e_file ...         # one column only
//
// Scanning is read-only in SharePoint; it only writes the sp_folders table.
// Monday is written ONLY with --apply, only into EMPTY columns (re-checked
// live against Monday right before each write), and every write lands in a
// receipt CSV under output/.
// =============================================================================

import Database from "better-sqlite3";
import fs from "node:fs";
import { initializeSchema } from "@case-pipeline/seed/db/schema";
import { changeSimpleColumnValue, mondayRequest, setApiToken } from "@case-pipeline/monday";
import { graphAuthFromEnv } from "./sharepoint/auth.js";
import { scanSite, CLIENT_SITES } from "./sharepoint/scan.js";
import type { FolderRef } from "./sharepoint/match.js";
import {
  proposeLinks, folderCaseNo, consultFolderYear,
  type LinkProposal, type ProfileInput, type LinkColumn, type LinkConfidence,
} from "./sharepoint/profile-links.js";
import { CONSULT_FILE, E_FILE, type LinkTarget } from "./sharepoint/link-target.js";

/** Profiles board — config/boards.yaml. */
const PROFILES_BOARD_ID = "8025265377";
const TARGETS: Record<LinkColumn, LinkTarget> = { e_file: E_FILE, consult_file: CONSULT_FILE };

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}
const flag = (name: string) => process.argv.includes(`--${name}`);

// ---- Folder index -----------------------------------------------------------

/**
 * Upsert one site's scan. A folder the scan no longer finds is marked
 * missing_since rather than deleted: it was renamed, moved or removed, and the
 * row is still the best record of what used to be there.
 */
function storeSite(db: Database.Database, site: string, folders: FolderRef[]): void {
  const now = new Date().toISOString();
  const upsert = db.prepare(`
    INSERT INTO sp_folders (item_id, site, drive_id, name, path, web_url, year, case_no, modified_at_source, first_seen_at, last_seen_at, missing_since)
    VALUES (@id, @site, @driveId, @name, @path, @webUrl, @year, @caseNo, @modified, @now, @now, NULL)
    ON CONFLICT(item_id) DO UPDATE SET
      site = excluded.site, drive_id = excluded.drive_id, name = excluded.name, path = excluded.path,
      web_url = excluded.web_url, year = excluded.year, case_no = excluded.case_no,
      modified_at_source = excluded.modified_at_source, last_seen_at = excluded.last_seen_at, missing_since = NULL
  `);
  const markMissing = db.prepare(
    "UPDATE sp_folders SET missing_since = ? WHERE site = ? AND last_seen_at < ? AND missing_since IS NULL",
  );

  db.transaction(() => {
    for (const f of folders) {
      if (!f.id || !f.driveId || !f.webUrl) continue;
      upsert.run({
        id: f.id, site, driveId: f.driveId, name: f.name, path: f.path, webUrl: f.webUrl,
        year: consultFolderYear(f), caseNo: folderCaseNo(f.name), modified: f.modified ?? null, now,
      });
    }
    markMissing.run(now, site, now);
  })();
}

function loadFolders(db: Database.Database): FolderRef[] {
  return (db.prepare(`
    SELECT item_id AS id, drive_id AS driveId, site, name, path, web_url AS webUrl, modified_at_source AS modified
    FROM sp_folders WHERE missing_since IS NULL
  `).all() as FolderRef[]);
}

// ---- Profiles ---------------------------------------------------------------

function loadProfiles(db: Database.Database): ProfileInput[] {
  const text = (key: string) => `NULLIF(TRIM(COALESCE(json_extract(raw_column_values, '$.${key}'), '')), '')`;
  return db.prepare(`
    SELECT local_id AS localId, monday_item_id AS mondayId, name,
           ${text("first_name")} AS firstName, ${text("last_name")} AS lastName,
           ${text("case_no")} AS caseNo, ${text("e_file")} AS eFile, ${text("consult_file")} AS consultFile,
           json_extract(raw_column_values, '$.last_consult_date.date') AS consultDate
    FROM profiles
    WHERE deleted_at IS NULL AND monday_item_id IS NOT NULL
  `).all() as ProfileInput[];
}

// ---- Monday -----------------------------------------------------------------

/**
 * The column as Monday has it NOW. live.db lags by up to a sync interval; a
 * link entered by hand in that window must win over anything inferred here.
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

async function backfill(proposals: LinkProposal[], limit: number): Promise<void> {
  const token = process.env.MONDAY_API_TOKEN?.trim();
  if (!token) {
    console.error("\nMONDAY_API_TOKEN is not set — cannot write.");
    process.exitCode = 1;
    return;
  }
  setApiToken(token);

  const batch = limit > 0 ? proposals.slice(0, limit) : proposals;
  console.log(`\nWriting ${batch.length} link(s) to Monday…`);

  const receipt = ["profile_name,monday_item_id,column,method,confidence,folder,url,outcome"];
  let written = 0, skipped = 0, failed = 0;

  for (const p of batch) {
    const target = TARGETS[p.column];
    const folder = p.folder!;
    let outcome: string;
    try {
      if (await currentValue(p.profile.mondayId, target.columnId)) {
        outcome = "skipped: filled in Monday meanwhile";
        skipped++;
      } else {
        await changeSimpleColumnValue(PROFILES_BOARD_ID, p.profile.mondayId, target.columnId, folder.webUrl!);
        outcome = "written";
        written++;
        if (written % 25 === 0) console.log(`  ${written}/${batch.length}…`);
      }
    } catch (err) {
      outcome = `failed: ${err instanceof Error ? err.message : String(err)}`;
      failed++;
      console.error(`  FAILED ${p.profile.name}: ${outcome}`);
    }
    receipt.push(csvRow([p.profile.name, p.profile.mondayId, target.label, p.method, p.confidence,
      `${folder.site}/${folder.path}`, folder.webUrl ?? "", outcome]));
  }

  // A receipt, because this changed live client records and "what did it do"
  // must be answerable without trawling Monday's activity log.
  const receiptPath = `output/sharepoint-links-written-${stamp()}.csv`;
  fs.mkdirSync("output", { recursive: true });
  fs.writeFileSync(receiptPath, receipt.join("\n"));
  console.log(`\n  written ${written}   skipped ${skipped}   failed ${failed}`);
  console.log(`  receipt: ${receiptPath}`);
}

// ---- Main -------------------------------------------------------------------

async function main() {
  const dbArg = arg("db") ?? "seed";
  // live | seed, or a path — a copy to try the report against.
  const dbPath = dbArg.endsWith(".db") ? dbArg : dbArg === "live" ? "data/live.db" : "data/seed.db";
  const db = new Database(dbPath);
  db.pragma("busy_timeout = 10000");
  initializeSchema(db);

  if (!flag("cached")) {
    const auth = graphAuthFromEnv();
    console.log(`Scanning SharePoint as ${auth.describe()} — read-only…`);
    for (const site of CLIENT_SITES) {
      const started = Date.now();
      const found = await scanSite(auth, site);
      storeSite(db, site, found);
      console.log(`  ${site.padEnd(14)} ${String(found.length).padStart(6)} client folders  (${Math.round((Date.now() - started) / 1000)}s)`);
    }
  }

  const folders = loadFolders(db);
  const profiles = loadProfiles(db);
  if (!folders.length) {
    console.error("\nsp_folders is empty — run without --cached first.");
    process.exitCode = 1;
    return;
  }

  const column = arg("column") as LinkColumn | undefined;
  const proposals = proposeLinks(profiles, folders).filter((p) => !column || p.column === column);

  // ---- Report ----
  const emptyE = profiles.filter((p) => !p.eFile).length;
  const emptyC = profiles.filter((p) => !p.consultFile).length;
  console.log(`\nProfiles ${profiles.length}   empty E-File ${emptyE}   empty Consult File ${emptyC}`);
  console.log(`Folders indexed ${folders.length}\n`);

  const tally = (col: LinkColumn, conf: LinkConfidence) =>
    proposals.filter((p) => p.column === col && p.confidence === conf).length;
  console.log(`                high  medium  review`);
  for (const col of ["e_file", "consult_file"] as LinkColumn[]) {
    console.log(`  ${TARGETS[col].label.padEnd(13)} ${String(tally(col, "high")).padStart(5)} ${String(tally(col, "medium")).padStart(7)} ${String(tally(col, "review")).padStart(7)}`);
  }

  const reportPath = arg("out") ?? `output/sharepoint-links-plan-${stamp()}.csv`;
  fs.mkdirSync("output", { recursive: true });
  fs.writeFileSync(reportPath, [
    "confidence,column,method,profile_name,monday_item_id,case_no,consult_date,folder,url,detail",
    ...proposals.map((p) => csvRow([
      p.confidence, TARGETS[p.column].label, p.method, p.profile.name, p.profile.mondayId,
      p.profile.caseNo, p.profile.consultDate,
      p.folder ? `${p.folder.site}/${p.folder.path}` : "", p.folder?.webUrl ?? "", p.detail,
    ])),
  ].join("\n"));
  console.log(`\nFull plan: ${reportPath}`);

  const writable = proposals.filter(
    (p) => p.folder && (p.confidence === "high" || (flag("include-medium") && p.confidence === "medium")),
  );

  if (!flag("apply")) {
    console.log(`\n${writable.length} link(s) would be written (${flag("include-medium") ? "high + medium" : "high only"}).`);
    console.log("Nothing was written to Monday. Re-run with --apply to write them.");
    return;
  }
  await backfill(writable, Number(arg("limit") ?? 0));
}

function stamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

function csvRow(values: Array<string | null>): string {
  return values.map((v) => `"${(v ?? "").replace(/"/g, '""')}"`).join(",");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
