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
import { createUpdate, changeSimpleColumnValue, changeColumnValue, createItem, createTimelineItem } from "@case-pipeline/monday";
import type { UpdateMention } from "@case-pipeline/monday";
import type { CreateTimelineItemInput } from "@case-pipeline/monday";
import { acquireSyncLock, releaseSyncLock } from "@case-pipeline/seed/db/sync-lock";
import { withTokenFallback } from "../write-auth.js";

const LOCK_HOLDER = "write-queue";
const BATCH_SIZE = 20;

export type WriteOpType =
  | "create_update"
  | "change_column"
  | "change_column_json"
  | "create_item"
  | "create_timeline_item"
  | "reschedule";

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

/** Flags a personal token Monday refused, so the UI can ask them to reconnect. */
export type TokenRejectionReporter = (authorOid: string, reason: string) => void;

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
  target_table: string | null;
  target_local_id: string | null;
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
 *
 * Returns the new Monday item id for `create_item`, so a caller that inserted
 * a placeholder local row (no monday_item_id yet, created while Monday was
 * down) can attach the real id once the retry succeeds — otherwise that row
 * stays orphaned forever and the next full sync inserts it again as a
 * "new" item, duplicating it locally.
 */
async function dispatch(row: QueueRow, token?: string): Promise<string | undefined> {
  const payload = JSON.parse(row.payload) as Record<string, unknown>;
  switch (row.op_type) {
    case "create_update": {
      if (!row.monday_item_id) throw new Error("create_update requires monday_item_id");
      const body = String(payload.body ?? payload.text ?? "");
      if (!body) throw new Error("create_update requires a non-empty body");
      const parentId = payload.parentId ? String(payload.parentId) : undefined;
      const mentions = Array.isArray(payload.mentions) ? (payload.mentions as UpdateMention[]) : undefined;
      await createUpdate(row.monday_item_id, body, token, parentId, mentions);
      return undefined;
    }
    case "change_column": {
      if (!row.monday_item_id) throw new Error("change_column requires monday_item_id");
      const boardId = String(payload.boardId ?? "");
      const columnId = String(payload.columnId ?? "");
      const value = String(payload.value ?? "");
      if (!boardId || !columnId) throw new Error("change_column requires boardId and columnId");
      await changeSimpleColumnValue(boardId, row.monday_item_id, columnId, value, token);
      return undefined;
    }
    case "change_column_json": {
      if (!row.monday_item_id) throw new Error("change_column_json requires monday_item_id");
      const boardId = String(payload.boardId ?? "");
      const columnId = String(payload.columnId ?? "");
      const value = (payload.value ?? {}) as Record<string, unknown>;
      if (!boardId || !columnId) throw new Error("change_column_json requires boardId and columnId");
      await changeColumnValue(boardId, row.monday_item_id, columnId, value, token);
      return undefined;
    }
    case "create_item": {
      const boardId = String(payload.boardId ?? "");
      const itemName = String(payload.itemName ?? "");
      const columnValues = (payload.columnValues ?? {}) as Record<string, unknown>;
      if (!boardId || !itemName) throw new Error("create_item requires boardId and itemName");
      const groupId = payload.groupId ? String(payload.groupId) : undefined;
      const newItemId = groupId
        ? await createItem(boardId, itemName, columnValues, token, groupId)
        : await createItem(boardId, itemName, columnValues, token);
      // An optional note (e.g. a Call Log entry's comment) can only be posted
      // once the item exists. Best-effort: the item itself is already created
      // by this point, so a failure here must not throw — that would retry
      // create_item and create a SECOND duplicate item.
      const note = payload.note ? String(payload.note) : "";
      if (note) {
        try {
          await createUpdate(newItemId, note, token);
        } catch (err) {
          console.error(`[write-queue] post-create note failed for new item ${newItemId}:`, err);
        }
      }
      return newItemId;
    }
    case "create_timeline_item": {
      const input = payload as unknown as CreateTimelineItemInput;
      if (!input.itemId || !input.title || !input.customActivityId) {
        throw new Error("create_timeline_item requires itemId, title, and customActivityId");
      }
      return await createTimelineItem(input, token);
    }
    // TODO(monday-write): case "reschedule" → change a date column value
    default:
      throw new Error(`Unsupported write_queue op_type: ${row.op_type}`);
  }
}

/** target_table values a queued write is allowed to reconcile back into. */
const RECONCILABLE_TABLES = new Set(["board_items", "profiles", "contracts"]);

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
  opts: {
    token?: string;
    resolveUserToken?: TokenResolver;
    reportTokenRejected?: TokenRejectionReporter;
  } = {},
): Promise<number> {
  if (!acquireSyncLock(db, LOCK_HOLDER)) return 0;
  try {
    const due = new Date().toISOString();
    const rows = db
      .prepare(
        `SELECT id, op_type, monday_item_id, author_oid, payload, attempts, max_attempts,
                target_table, target_local_id
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
        // fall back to the shared service token if they have none — or if Monday
        // refuses theirs. Without that second fallback an under-scoped token
        // (one issued before `boards:write` was requested) burned all five
        // attempts and dead-lettered a write the shared token could have made.
        const authorToken = row.author_oid ? opts.resolveUserToken?.(row.author_oid) : null;
        const outcome = await withTokenFallback((token) => dispatch(row, token), {
          userToken: authorToken,
          sharedToken: opts.token,
          onPersonalTokenRejected: (reason) =>
            row.author_oid && opts.reportTokenRejected?.(row.author_oid, reason),
        });
        db.prepare(`UPDATE write_queue SET status = 'synced', updated_at = ? WHERE id = ?`).run(
          new Date().toISOString(),
          row.id,
        );
        // A queued create_item placeholder row has no monday_item_id yet (Monday
        // was down when it was created) — attach the real one now, or the next
        // full sync sees an untracked item upstream and inserts it a second time.
        // The `monday_item_id IS NULL` guard is load-bearing: target_table/
        // target_local_id are also set on create_item ops (e.g. Fee K creation)
        // where they identify an unrelated *existing* row kept only for audit
        // context, not a placeholder awaiting this new item's id — reconciling
        // unconditionally would stomp that row's own monday_item_id.
        if (row.op_type === "create_item" && outcome.result && row.target_table && row.target_local_id) {
          if (RECONCILABLE_TABLES.has(row.target_table)) {
            const res = db
              .prepare(`UPDATE ${row.target_table} SET monday_item_id = ?, sync_status = 'synced' WHERE local_id = ? AND monday_item_id IS NULL`)
              .run(outcome.result, row.target_local_id);
            if (res.changes === 0) {
              console.warn(`[write-queue] op ${row.id}: target row already has a monday_item_id, skipped reconciliation`);
            }
          } else {
            console.warn(`[write-queue] op ${row.id}: unrecognized target_table "${row.target_table}", skipped reconciliation`);
          }
        }
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
  opts: {
    token?: string;
    schedule?: string;
    resolveUserToken?: TokenResolver;
    reportTokenRejected?: TokenRejectionReporter;
  } = {},
): void {
  // Recover any rows stranded 'syncing' by a prior crash before draining.
  reconcileInFlightWrites(db);

  const schedule = opts.schedule ?? "* * * * *";
  cron.schedule(schedule, () => {
    drainWriteQueue(db, {
      token: opts.token,
      resolveUserToken: opts.resolveUserToken,
      reportTokenRejected: opts.reportTokenRejected,
    }).catch((err) => console.error("[write-queue] drain error:", err));
  });
  console.log(`[write-queue] processor scheduled (${schedule}).`);
}
