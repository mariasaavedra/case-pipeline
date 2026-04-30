// =============================================================================
// Export DB stats to Excel (.xlsx)
//
// Usage:
//   bun scripts/export-stats.ts              # reads seed.db
//   bun scripts/export-stats.ts --db=live    # reads live.db
//
// Output: data/stats-YYYY-MM-DD.xlsx
// =============================================================================

import Database from "better-sqlite3";
type DatabaseInstance = InstanceType<typeof Database>;
import * as XLSX from "xlsx";
import { gatherStats } from "./stats";
import { validateSchema } from "./seed/lib/db/schema";

// =============================================================================
// Sheet builders
// =============================================================================

function buildSummarySheet(report: ReturnType<typeof gatherStats>): XLSX.WorkSheet {
  const p = report.profiles;
  const c = report.contracts;
  const u = report.updates;

  const rows = [
    ["Case Pipeline — Database Diagnostic", ""],
    ["Generated", report.generatedAt.replace("T", " ").slice(0, 16)],
    ["Source DB", report.dbPath],
    [""],
    ["PROFILES", ""],
    ["Total Profiles", p.total],
    ["  with A-Number", p.withANumber],
    ["  with Date of Birth", p.withDob],
    ["  with Email", p.withEmail],
    ["  with Phone", p.withPhone],
    [""],
    ["CONTRACTS", ""],
    ["Total Contracts", c.total],
    ["  Active", c.active],
    ["  Closed / Paid / Done", c.closed],
    [""],
    ["CASE NOTES", ""],
    ["Total Notes", u.total],
    ["  Linked to Profile", u.linkedToProfile],
    [""],
    ["BOARD ITEMS", ""],
    ["Total Items (all boards)", report.totalItems],
    ["  Items with no profile link", report.totalOrphaned],
  ];

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{ wch: 30 }, { wch: 16 }];
  return ws;
}

function buildBoardsSheet(report: ReturnType<typeof gatherStats>): XLSX.WorkSheet {
  const header = ["Board", "Board Key", "Total Items", "Linked to Profile", "Orphaned (no profile)", "% Linked"];
  const data = report.boards.map((b) => [
    b.label,
    b.boardKey,
    b.total,
    b.withProfile,
    b.orphaned,
    b.total > 0 ? Math.round((b.withProfile / b.total) * 100) + "%" : "—",
  ]);

  const ws = XLSX.utils.aoa_to_sheet([header, ...data]);
  ws["!cols"] = [{ wch: 32 }, { wch: 28 }, { wch: 13 }, { wch: 18 }, { wch: 22 }, { wch: 10 }];
  return ws;
}

function buildGroupsSheet(report: ReturnType<typeof gatherStats>): XLSX.WorkSheet {
  const header = ["Board", "Board Key", "Group", "Item Count"];
  const data = report.groups.map((g) => [
    g.boardLabel,
    g.boardKey,
    g.groupTitle,
    g.count,
  ]);

  const ws = XLSX.utils.aoa_to_sheet([header, ...data]);
  ws["!cols"] = [{ wch: 32 }, { wch: 28 }, { wch: 30 }, { wch: 12 }];
  return ws;
}

// One sheet per board showing its group breakdown
function buildPerBoardSheets(
  report: ReturnType<typeof gatherStats>
): { name: string; ws: XLSX.WorkSheet }[] {
  const sheets: { name: string; ws: XLSX.WorkSheet }[] = [];

  for (const board of report.boards) {
    const boardGroups = report.groups.filter((g) => g.boardKey === board.boardKey);
    if (boardGroups.length === 0) continue;

    const header = ["Group", "Item Count", "% of Board"];
    const data = boardGroups.map((g) => [
      g.groupTitle,
      g.count,
      board.total > 0 ? Math.round((g.count / board.total) * 100) + "%" : "—",
    ]);

    const ws = XLSX.utils.aoa_to_sheet([header, ...data]);
    ws["!cols"] = [{ wch: 32 }, { wch: 12 }, { wch: 14 }];

    // Sheet names must be ≤31 chars and must not contain : \ / ? * [ ]
    const name = board.label.replace(/[:\\/?*[\]]/g, "-").slice(0, 31);
    sheets.push({ name, ws });
  }

  return sheets;
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const args = process.argv.slice(2);
  const dbArg = args.find((a) => a.startsWith("--db="))?.split("=")[1] ?? "seed";
  const dbPath = dbArg === "live" ? "data/live.db" : "data/seed.db";

  let db: DatabaseInstance;
  try {
    db = new Database(dbPath, { readonly: true });
    validateSchema(db);
  } catch (e) {
    console.error(`\n  Error: ${(e as Error).message}\n`);
    process.exit(1);
  }

  console.log(`\nGathering stats from ${dbPath}...`);
  const report = gatherStats(db, dbPath);
  db.close();

  // Build workbook
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(wb, buildSummarySheet(report), "Summary");
  XLSX.utils.book_append_sheet(wb, buildBoardsSheet(report), "Boards Overview");
  XLSX.utils.book_append_sheet(wb, buildGroupsSheet(report), "Groups (all boards)");

  for (const { name, ws } of buildPerBoardSheets(report)) {
    XLSX.utils.book_append_sheet(wb, ws, name);
  }

  // Save
  const date = new Date().toISOString().slice(0, 10);
  const outPath = `data/stats-${date}.xlsx`;
  XLSX.writeFile(wb, outPath);

  console.log(`\nSheets written:`);
  console.log(`  - Summary`);
  console.log(`  - Boards Overview  (${report.boards.length} boards)`);
  console.log(`  - Groups (all boards)  (${report.groups.length} rows)`);
  console.log(`  - One tab per board  (${report.boards.length} tabs)`);
  console.log(`\nSaved to: ${outPath}\n`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
