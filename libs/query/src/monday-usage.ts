// =============================================================================
// Monday API usage — our own per-job call counts (monday_api_calls, v34)
// =============================================================================
// The counter lives in libs/monday/src/usage.ts; the API server and the sync
// script drain it into this table every minute. Read next to Monday's own
// platform_api report in Settings → Sync health.

import type BetterSqlite3 from "better-sqlite3";
type Database = BetterSqlite3.Database;

export interface MondayCallRow {
  day: string;
  job: string;
  calls: number;
}

/** Add drained counts (UTC day + job) to the table. One transaction. */
export function addMondayCallCounts(db: Database, rows: MondayCallRow[]): void {
  if (rows.length === 0) return;
  const upsert = db.prepare(`
    INSERT INTO monday_api_calls (day, job, calls) VALUES (?, ?, ?)
    ON CONFLICT(day, job) DO UPDATE SET calls = calls + excluded.calls
  `);
  db.transaction(() => {
    for (const r of rows) upsert.run(r.day, r.job, r.calls);
  })();
}

/** Calls per day per job from `sinceDay` (UTC YYYY-MM-DD) on, newest day first. */
export function getMondayCallCounts(db: Database, sinceDay: string): MondayCallRow[] {
  return db
    .prepare("SELECT day, job, calls FROM monday_api_calls WHERE day >= ? ORDER BY day DESC, calls DESC")
    .all(sinceDay) as MondayCallRow[];
}
