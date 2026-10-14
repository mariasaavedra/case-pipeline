// =============================================================================
// Count a script's Monday API calls in monday_api_calls (Settings → Sync health)
// =============================================================================
// For the scheduled scripts that run as their own process (consult sweep, Drive
// intake): every Monday call they make is labelled `job`, and the counts are
// written to `dbPath` when the process exits. The sync writes its own counts
// as it goes (scripts/sync/index.ts). See libs/monday/src/usage.ts.

import Database from "better-sqlite3";
import { setDefaultMondayJob, drainMondayCallCounts } from "@case-pipeline/monday";
import { addMondayCallCounts } from "@case-pipeline/query";

export function countMondayCalls(job: string, dbPath: string): void {
  setDefaultMondayJob(job);
  // "exit" handlers must be synchronous — better-sqlite3 is.
  process.on("exit", () => {
    const rows = drainMondayCallCounts();
    if (rows.length === 0) return;
    try {
      const db = new Database(dbPath, { timeout: 5000 });
      try {
        addMondayCallCounts(db, rows);
      } finally {
        db.close();
      }
    } catch {
      // No table yet (pre-v34 DB) or the file is locked: counts are best-effort.
    }
  });
}
