// =============================================================================
// Sync advisory lock (single-row)
// =============================================================================
// Coordinates the two writers to live.db so they never run concurrently:
//   - the live sync process (scripts/sync/index.ts), which does a full replace
//   - the write-queue processor (apps/api), which drains pending Monday.com writes
//
// SQLite's busy_timeout already prevents corruption, but a full sync drops and
// rebuilds tables — the queue processor must not run mutations against a DB
// mid-rebuild. This lock makes that mutual exclusion explicit. Both writers call
// acquireSyncLock() before writing and releaseSyncLock() when done.
//
// The lock is stored in the `sync_state` table (schema v11). A lock older than
// STALE_MS is treated as abandoned (holder crashed) and can be stolen, so a
// dead process can never wedge the system permanently.
// =============================================================================

import type BetterSqlite3 from "better-sqlite3";
type Database = BetterSqlite3.Database;

/** A held lock older than this is considered abandoned and may be stolen. */
const STALE_MS = 30 * 60 * 1000; // 30 minutes — comfortably longer than a sync run

/**
 * Try to acquire the single-row advisory lock. Returns true if acquired.
 * Succeeds when the lock is free or the current holder's lock has gone stale.
 */
export function acquireSyncLock(db: Database, holder: string): boolean {
  const now = Date.now();
  const staleBefore = new Date(now - STALE_MS).toISOString();
  const res = db
    .prepare(
      `UPDATE sync_state
          SET locked_by = ?, locked_at = ?
        WHERE id = 1
          AND (locked_by IS NULL OR locked_at < ?)`,
    )
    .run(holder, new Date(now).toISOString(), staleBefore);
  return res.changes > 0;
}

/** Release the lock, but only if this holder still owns it. */
export function releaseSyncLock(db: Database, holder: string): void {
  db.prepare(
    `UPDATE sync_state
        SET locked_by = NULL, locked_at = NULL
      WHERE id = 1 AND locked_by = ?`,
  ).run(holder);
}

/** Record the outcome of a completed sync run (for observability / health). */
export function recordSyncResult(db: Database, status: string): void {
  db.prepare(
    `UPDATE sync_state
        SET last_sync_at = ?, last_sync_status = ?
      WHERE id = 1`,
  ).run(new Date().toISOString(), status);
}
