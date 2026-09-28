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

/**
 * A held lock older than this is considered abandoned and may be stolen.
 *
 * It is NOT "longer than a sync run" any more — a full walk took ~4 hours on
 * 2026-09-28 and keeps growing. The holder is expected to call
 * refreshSyncLock() as it works, so this is the window after a holder goes
 * SILENT, not the length of the job. Keeping it short is the point: a crashed
 * sync frees the lock in half an hour instead of wedging the queue for a day.
 */
const STALE_MS = 30 * 60 * 1000;

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

/**
 * Keep a held lock alive. Long jobs must call this periodically.
 *
 * Without it a sync that outlives STALE_MS looks abandoned, and the write-queue
 * processor — which tries every minute — steals the lock and runs mutations
 * against a database mid-sync. That is the exact thing the lock exists to
 * prevent, and it had been possible from minute 30 of every nightly walk.
 *
 * Returns false when the lock was already lost, so a caller can notice rather
 * than carry on believing it holds it.
 */
export function refreshSyncLock(db: Database, holder: string): boolean {
  const res = db
    .prepare(`UPDATE sync_state SET locked_at = ? WHERE id = 1 AND locked_by = ?`)
    .run(new Date().toISOString(), holder);
  return res.changes > 0;
}

/** Who holds the lock right now, or null when it is free or gone stale. */
export function syncLockHolder(db: Database): string | null {
  const staleBefore = new Date(Date.now() - STALE_MS).toISOString();
  const row = db
    .prepare(`SELECT locked_by, locked_at FROM sync_state WHERE id = 1`)
    .get() as { locked_by: string | null; locked_at: string | null } | undefined;
  if (!row?.locked_by || !row.locked_at) return null;
  return row.locked_at < staleBefore ? null : row.locked_by;
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
