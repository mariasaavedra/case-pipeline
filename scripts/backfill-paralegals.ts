// =============================================================================
// Backfill board_items.paralegals from stored column_values
// =============================================================================
// The sync mapper used to read `columnValues.paralegals` while boards key the
// column `paralegal` (singular), so board_items.paralegals stayed empty and the
// paralegal grouping in Active/My Cases was broken. The mapper is now fixed, but
// existing rows were written with the bug. This re-derives the column from the
// column_values JSON already in the DB — no Monday.com calls, idempotent.
//
// Usage:
//   npx tsx scripts/backfill-paralegals.ts            # data/live.db (default)
//   npx tsx scripts/backfill-paralegals.ts --db=seed  # data/seed.db
//   npx tsx scripts/backfill-paralegals.ts --dry-run  # report only, no writes
// =============================================================================

import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractBoardItemFields } from "./sync/mapper";

const args = process.argv.slice(2);
const dbArg = args.find((a) => a.startsWith("--db="))?.split("=")[1] ?? "live";
const dryRun = args.includes("--dry-run");

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data");
const dbPath = path.join(dataDir, `${dbArg}.db`);

const db = new Database(dbPath);
db.pragma("busy_timeout = 5000");

const rows = db
  .prepare("SELECT local_id, board_key, column_values, paralegals FROM board_items WHERE column_values IS NOT NULL")
  .all() as { local_id: string; board_key: string; column_values: string; paralegals: string | null }[];

const upd = db.prepare("UPDATE board_items SET paralegals = ? WHERE local_id = ?");

let changed = 0;
let nowFilled = 0;
const sample = new Set<string>();

const apply = db.transaction(() => {
  for (const r of rows) {
    let cvs: Record<string, unknown>;
    try {
      cvs = JSON.parse(r.column_values);
    } catch {
      continue;
    }
    const derived = extractBoardItemFields(r.board_key, cvs).paralegals;
    if (derived !== r.paralegals) {
      if (!dryRun) upd.run(derived, r.local_id);
      changed++;
      if (derived) {
        nowFilled++;
        for (const n of derived.split(",")) if (sample.size < 15) sample.add(n.trim());
      }
    }
  }
});
apply();

console.log(
  `${dryRun ? "[dry-run] " : ""}Backfill paralegals on ${dbArg}.db: ${changed} rows changed, ${nowFilled} now have a paralegal (of ${rows.length}).`,
);
if (sample.size) console.log("  paralegals found:", [...sample].sort().join(" | "));
db.close();
