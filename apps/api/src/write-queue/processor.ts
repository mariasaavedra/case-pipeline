// =============================================================================
// Write-back queue processor
// =============================================================================
// Durable outbox for Monday.com writes. The API enqueues a mutation locally
// (instant, transactional) and this processor drains the queue in the
// background, retrying with exponential backoff. A queued write survives an API
// restart and a full re-sync (it keys off the stable monday_item_id), so a
// transient Monday.com outage never loses a staff member's edit.
//
// Coordination: drains run under the sync advisory lock so they never overlap a
// full sync that is rebuilding the database.
// =============================================================================

import type BetterSqlite3 from "better-sqlite3";
type Database = BetterSqlite3.Database;
import cron from "node-cron";
import { createUpdate } from "@case-pipeline/monday";
import { acquireSyncLock, releaseSyncLock } from "@case-pipeline/seed/db/sync-lock";

const LOCK_HOLDER = "write-queue";
const BATCH_SIZE = 20;

export type WriteOpType = "create_update" | "change_column" | "reschedule";

export interface EnqueueInput {
  opType: WriteOpType;
  targetTable?: string | null;
  targetLocalId?: string | null;
  mondayItemId?: string | null;
  /** Azure OID of the staff member who made the edit, so a retry posts under their token. */
  authorOid?: string | null;
  payload: Record<string, unknown>;
  maxAttempts?: number;
}

/** Resolves a staff member's personal Monday.com token from their Azure OID. */
export type TokenResolver = (authorOid: string) => string | null;

/** Append a write-back op to the durable queue. Returns the new row id. */
export function enqueueWrite(db: Database, input: EnqueueInput): number {
  const now = new Date().toISOString();
  const res = db
    .prepare(
      `INSERT INTO write_queue
         (op_type, target_table, target_local_id, monday_item_id, author_oid, payload,
          status, attempts, max_attempts, next_attempt_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?)`,
    )
    .run(
      input.opType,
      input.targetTable ?? null,
      input.targetLocalId ?? null,
      input.mondayItemId ?? null,
      input.authorOid ?? null,
      JSON.stringify(input.payload),
      input.maxAttempts ?? 5,
      now,
      now,
      now,
    );
  return Number(res.lastInsertRowid);
}

interface QueueRow {
  id: number;
  op_type: string;
  monday_item_id: string | null;
  author_oid: string | null;
  payload: string;
  attempts: number;
  max_attempts: number;
}

/**
 * Reset rows orphaned in 'syncing' back to 'pending'. A crash between marking a
 * row 'syncing' and resolving its dispatch would otherwise strand it forever
 * (the drainer only selects 'pending'). Run once at startup before scheduling.
 */
export function reconcileInFlightWrites(db: Database): number {
  const res = db
    .prepare(`UPDATE write_queue SET status = 'pending', updated_at = ? WHERE status = 'syncing'`)
    .run(new Date().toISOString());
  if (res.changes > 0) {
    console.warn(`[write-queue] reset ${res.changes} orphaned 'syncing' row(s) to 'pending' on startup.`);
  }
  return res.changes;
}

/**
 * Perform the actual Monday.com mutation for a queued op. This is the plug-in
 * point as write-back grows: add a case per op_type. Currently `create_update`
 * is implemented (notes); `change_column` and `reschedule` land with the
 * write-back feature (they need change_simple_column_value mutations).
 */
async function dispatch(row: QueueRow, token?: string): Promise<void> {
  const payload = JSON.parse(row.payload) as Record<string, unknown>;
  switch (row.op_type) {
    case "create_update": {
      if (!row.monday_item_id) throw new Error("create_update requires monday_item_id");
      const body = String(payload.body ?? payload.text ?? "");
      if (!body) throw new Error("create_update requires a non-empty body");
      await createUpdate(row.monday_item_id, body, token);
      return;
    }
    // TODO(monday-write): case "change_column" → change_simple_column_value
    // TODO(monday-write): case "reschedule"    → change a date column value
    default:
      throw new Error(`Unsupported write_queue op_type: ${row.op_type}`);
  }
}

/** Exponential backoff: 1m, 2m, 4m, 8m, 16m … capped at 30m. */
function backoffMs(attempts: number): number {
  return Math.min(30 * 60_000, 60_000 * 2 ** (attempts - 1));
}

/**
 * Drain due write_queue items once. Returns the count successfully synced.
 * Held under the sync advisory lock; if a sync owns the lock this is a no-op
 * until the next tick.
 */
export async function drainWriteQueue(
  db: Database,
  opts: { token?: string; resolveUserToken?: TokenResolver } = {},
): Promise<number> {
  if (!acquireSyncLock(db, LOCK_HOLDER)) return 0;
  try {
    const due = new Date().toISOString();
    const rows = db
      .prepare(
        `SELECT id, op_type, monday_item_id, author_oid, payload, attempts, max_attempts
           FROM write_queue
          WHERE status = 'pending'
            AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
          ORDER BY id
          LIMIT ?`,
      )
      .all(due, BATCH_SIZE) as QueueRow[];

    let synced = 0;
    for (const row of rows) {
      db.prepare(`UPDATE write_queue SET status = 'syncing', updated_at = ? WHERE id = ?`).run(
        new Date().toISOString(),
        row.id,
      );
      try {
        // Prefer the author's personal token so the retry is attributed to them;
        // fall back to the shared service token if they have none.
        const authorToken = row.author_oid ? opts.resolveUserToken?.(row.author_oid) : null;
        await dispatch(row, authorToken ?? opts.token);
        db.prepare(`UPDATE write_queue SET status = 'synced', updated_at = ? WHERE id = ?`).run(
          new Date().toISOString(),
          row.id,
        );
        synced++;
      } catch (err) {
        const attempts = row.attempts + 1;
        const message = err instanceof Error ? err.message : String(err);
        if (attempts >= row.max_attempts) {
          // Dead-letter: stop retrying, keep the error for inspection.
          db.prepare(
            `UPDATE write_queue SET status = 'failed', attempts = ?, last_error = ?, updated_at = ? WHERE id = ?`,
          ).run(attempts, message, new Date().toISOString(), row.id);
          console.error(`[write-queue] op ${row.id} (${row.op_type}) dead-lettered after ${attempts} attempts: ${message}`);
        } else {
          const nextAttempt = new Date(Date.now() + backoffMs(attempts)).toISOString();
          db.prepare(
            `UPDATE write_queue
                SET status = 'pending', attempts = ?, last_error = ?, next_attempt_at = ?, updated_at = ?
              WHERE id = ?`,
          ).run(attempts, message, nextAttempt, new Date().toISOString(), row.id);
        }
      }
    }
    return synced;
  } finally {
    releaseSyncLock(db, LOCK_HOLDER);
  }
}

/** Schedule the drainer on a cron cadence (every minute by default). */
export function startWriteQueueProcessor(
  db: Database,
  opts: { token?: string; schedule?: string; resolveUserToken?: TokenResolver } = {},
): void {
  // Recover any rows stranded 'syncing' by a prior crash before draining.
  reconcileInFlightWrites(db);

  const schedule = opts.schedule ?? "* * * * *";
  cron.schedule(schedule, () => {
    drainWriteQueue(db, { token: opts.token, resolveUserToken: opts.resolveUserToken }).catch((err) =>
      console.error("[write-queue] drain error:", err),
    );
  });
  console.log(`[write-queue] processor scheduled (${schedule}).`);
}
