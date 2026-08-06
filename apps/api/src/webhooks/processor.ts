// =============================================================================
// Webhook event processor — drains the webhook_events inbox
// =============================================================================
// Turns raw Monday webhook events into a fresh local mirror, three ways:
//
//   1. Deletions (item_deleted / item_archived): the event carries the exact
//      monday_item_id, so the row is archived into archived_rows and removed
//      directly — the one deletion path that doesn't have to wait for the
//      nightly --full sweep.
//   2. Notes (create_update / edit_update): re-fetch that single item's updates
//      and upsert them into client_updates (an edit updates the stored body).
//   3. Everything else (column changes, new items, renames, restores): the
//      board is marked dirty and ONE targeted incremental sync runs for all
//      dirty boards (`sync:live --skip-timeline --boards=…`). This reuses the
//      battle-tested sync pipeline — mapper, upsert, watermark — instead of
//      re-implementing per-table writes here.
//
// Events for boards not in config/boards.yaml (or attorney-boards.json) are
// marked 'skipped'. delete_update is also skipped: removals of notes are only
// reconciled by the nightly full sweep.
//
// Direct DB writes run under the sync advisory lock (same discipline as the
// write-queue) so they never interleave with a full sync mid-rebuild. The
// targeted sync is spawned AFTER the lock is released — the child process
// takes the lock itself.
// =============================================================================

import type BetterSqlite3 from "better-sqlite3";
type Database = BetterSqlite3.Database;
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import cron from "node-cron";
import { fetchItemUpdatesBatch } from "@case-pipeline/monday";
import type { MondayAsset } from "@case-pipeline/monday";
import { loadBoardsConfig } from "@case-pipeline/config";
import { acquireSyncLock, releaseSyncLock } from "@case-pipeline/seed/db/sync-lock";

const LOCK_HOLDER = "webhooks";
const MAX_ATTEMPTS = 5;
const BATCH_LIMIT = 500;
/** Processed/skipped rows older than this are pruned each drain. */
const RETENTION = "-30 days";

// Monday's delivered payload `type` sometimes differs from the subscription
// enum (create_item → "create_pulse", change_column_value →
// "update_column_value"), so both spellings are listed. Anything not matched
// here that carries a boardId falls through to the board-refresh path, which
// is the safe default: an unrecognized change type still refreshes the board.
const DELETE_EVENTS = new Set(["item_deleted", "delete_pulse", "item_archived", "archive_pulse"]);
const NOTE_EVENTS = new Set(["create_update", "edit_update"]);
const IGNORED_EVENTS = new Set(["delete_update"]);

export interface WebhookProcessorDeps {
  /** Resolve a Monday board id to its boards.yaml key (null = untracked). */
  boardKeyForId: (mondayBoardId: string) => string | null;
  /**
   * Run one incremental sync limited to these board keys. Resolves true when
   * the sync ran to completion, false when it was skipped because another sync
   * is in flight (events stay pending and retry next tick). Rejects on failure.
   */
  runTargetedSync: (boardKeys: string[]) => Promise<boolean>;
}

interface EventRow {
  id: number;
  event_type: string;
  monday_board_id: string | null;
  monday_item_id: string | null;
  attempts: number;
}

export interface DrainStats {
  processed: number;
  skipped: number;
  failed: number;
  syncedBoards: string[];
  syncSkippedBusy: boolean;
}

/** Exponential backoff for failed events: 1m, 2m, 4m … capped at 30m. */
function backoffMs(attempts: number): number {
  return Math.min(30 * 60_000, 60_000 * 2 ** (attempts - 1));
}

// =============================================================================
// Board id → board key resolution
// =============================================================================

/**
 * boards.yaml is loaded once (its ids only change with a deploy); active
 * attorney boards are re-read from data/attorney-boards.json on every call so
 * a board added in Settings starts resolving without an API restart.
 */
export async function createBoardKeyResolver(dataDir: string): Promise<(mondayBoardId: string) => string | null> {
  const boardsConfig = await loadBoardsConfig();
  const staticMap = new Map<string, string>();
  for (const [key, config] of Object.entries(boardsConfig)) {
    staticMap.set(String(config.id), key);
  }
  const attorneyBoardsPath = path.join(dataDir, "attorney-boards.json");

  return (mondayBoardId: string) => {
    const fromYaml = staticMap.get(mondayBoardId);
    if (fromYaml) return fromYaml;
    try {
      const boards = JSON.parse(fs.readFileSync(attorneyBoardsPath, "utf-8")) as Array<{
        boardKey: string;
        mondayBoardId: string;
        active: boolean;
      }>;
      return boards.find((b) => b.active && b.mondayBoardId === mondayBoardId)?.boardKey ?? null;
    } catch {
      return null;
    }
  };
}

// =============================================================================
// Deletion path — archive + remove the exact row the event names
// =============================================================================

const SOURCE_TABLES = ["profiles", "contracts", "board_items"] as const;

/**
 * Archive-then-delete a row by its Monday item id, mirroring the sync's
 * reconciliation (same archived_rows shape, run_id NULL = webhook-initiated).
 * Returns true if a row was found and removed.
 */
export function archiveItemByMondayId(db: Database, mondayItemId: string): boolean {
  for (const table of SOURCE_TABLES) {
    const row = db
      .prepare(`SELECT * FROM ${table} WHERE monday_item_id = ?`)
      .get(mondayItemId) as Record<string, unknown> | undefined;
    if (!row) continue;
    const remove = db.transaction(() => {
      db.prepare(
        `INSERT INTO archived_rows (source_table, board_key, monday_item_id, local_id, snapshot_json, run_id, archived_at)
         VALUES (?, ?, ?, ?, ?, NULL, datetime('now'))`,
      ).run(
        table,
        (row.board_key as string) ?? null,
        mondayItemId,
        (row.local_id as string) ?? null,
        JSON.stringify(row),
      );
      db.prepare(`DELETE FROM ${table} WHERE monday_item_id = ?`).run(mondayItemId);
    });
    remove();
    return true;
  }
  return false;
}

// =============================================================================
// Note path — re-fetch one item's updates and upsert them
// =============================================================================

// Matches the sync's stripHtml (scripts/sync/index.ts) so content shapes stay
// identical across both write paths.
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/﻿/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function serializeAssets(assets: MondayAsset[] | null | undefined): string | null {
  if (!assets || assets.length === 0) return null;
  return JSON.stringify(
    assets.map((a) => ({
      name: a.name,
      url: a.url,
      thumbnailUrl: a.url_thumbnail || null,
      fileExtension: a.file_extension || null,
      fileSize: a.file_size ?? null,
    })),
  );
}

interface ItemMeta {
  batch_id: number;
  profile_local_id: string;
  board_item_local_id: string | null;
  board_key: string | null;
}

/** Where an item's notes should attach: the profile itself, or a board item. */
function noteMetaFor(db: Database, mondayItemId: string): ItemMeta | null {
  const profile = db
    .prepare("SELECT local_id, batch_id FROM profiles WHERE monday_item_id = ?")
    .get(mondayItemId) as { local_id: string; batch_id: number } | undefined;
  if (profile) {
    return { batch_id: profile.batch_id, profile_local_id: profile.local_id, board_item_local_id: null, board_key: null };
  }
  const item = db
    .prepare(
      "SELECT local_id, batch_id, profile_local_id, board_key FROM board_items WHERE monday_item_id = ? AND profile_local_id != ''",
    )
    .get(mondayItemId) as
    | { local_id: string; batch_id: number; profile_local_id: string; board_key: string }
    | undefined;
  if (item) {
    return {
      batch_id: item.batch_id,
      profile_local_id: item.profile_local_id,
      board_item_local_id: item.local_id,
      board_key: item.board_key,
    };
  }
  return null;
}

/**
 * Fetch one item's updates from Monday and upsert them locally. Unlike the
 * sync's INSERT OR IGNORE, the conflict path UPDATEs body/attachments so an
 * edit_update event refreshes the stored note text.
 */
export async function refreshItemNotes(db: Database, mondayItemId: string): Promise<void> {
  const meta = noteMetaFor(db, mondayItemId);
  if (!meta) return; // item not mirrored (or not linked to a profile) — nothing to attach to

  const updatesMap = await fetchItemUpdatesBatch([mondayItemId], 100);
  const updates = updatesMap.get(mondayItemId) ?? [];

  const upsert = db.prepare(`
    INSERT INTO client_updates (
      batch_id, local_id, monday_update_id, profile_local_id,
      board_item_local_id, board_key, author_name, author_email,
      text_body, body_html, source_type, reply_to_update_id,
      attachments, created_at_source, raw_json, sync_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced')
    ON CONFLICT(profile_local_id, monday_update_id) WHERE monday_update_id IS NOT NULL
    DO UPDATE SET
      text_body = excluded.text_body,
      body_html = excluded.body_html,
      author_name = excluded.author_name,
      author_email = excluded.author_email,
      attachments = excluded.attachments,
      raw_json = excluded.raw_json
  `);

  const tx = db.transaction(() => {
    for (const update of updates) {
      upsert.run(
        meta.batch_id, randomUUID(), update.id,
        meta.profile_local_id, meta.board_item_local_id, meta.board_key,
        update.creator?.name ?? "Unknown", update.creator?.email ?? null,
        stripHtml(update.body), update.body,
        "update", null,
        serializeAssets(update.assets),
        update.created_at, JSON.stringify(update),
      );
      for (const reply of update.replies ?? []) {
        upsert.run(
          meta.batch_id, randomUUID(), reply.id,
          meta.profile_local_id, meta.board_item_local_id, meta.board_key,
          reply.creator?.name ?? "Unknown", reply.creator?.email ?? null,
          stripHtml(reply.body), reply.body,
          "reply", update.id,
          null,
          reply.created_at, JSON.stringify(reply),
        );
      }
    }
  });
  tx();
}

// =============================================================================
// Drain
// =============================================================================

export async function processWebhookEvents(db: Database, deps: WebhookProcessorDeps): Promise<DrainStats> {
  const stats: DrainStats = { processed: 0, skipped: 0, failed: 0, syncedBoards: [], syncSkippedBusy: false };

  const now = new Date().toISOString();
  const rows = db
    .prepare(
      `SELECT id, event_type, monday_board_id, monday_item_id, attempts
         FROM webhook_events
        WHERE status = 'pending'
          AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
        ORDER BY id
        LIMIT ?`,
    )
    .all(now, BATCH_LIMIT) as EventRow[];

  if (rows.length === 0) {
    prune(db);
    return stats;
  }

  const stamp = () => new Date().toISOString();
  const markProcessed = db.prepare(
    `UPDATE webhook_events SET status = 'processed', processed_at = ?, last_error = NULL WHERE id = ?`,
  );
  const markSkipped = db.prepare(
    `UPDATE webhook_events SET status = 'skipped', processed_at = ?, last_error = ? WHERE id = ?`,
  );
  const markFailure = (row: EventRow, message: string) => {
    const attempts = row.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      db.prepare(`UPDATE webhook_events SET status = 'failed', attempts = ?, last_error = ?, processed_at = ? WHERE id = ?`)
        .run(attempts, message, stamp(), row.id);
      stats.failed++;
      console.error(`[webhooks] event ${row.id} (${row.event_type}) failed permanently: ${message}`);
    } else {
      const nextAttempt = new Date(Date.now() + backoffMs(attempts)).toISOString();
      db.prepare(`UPDATE webhook_events SET attempts = ?, last_error = ?, next_attempt_at = ? WHERE id = ?`)
        .run(attempts, message, nextAttempt, row.id);
    }
  };

  // Partition the batch.
  const deletions: EventRow[] = [];
  const notes: EventRow[] = [];
  const refreshByBoard = new Map<string, EventRow[]>(); // board key → events
  for (const row of rows) {
    if (DELETE_EVENTS.has(row.event_type) && row.monday_item_id) {
      deletions.push(row);
    } else if (NOTE_EVENTS.has(row.event_type) && row.monday_item_id) {
      notes.push(row);
    } else if (IGNORED_EVENTS.has(row.event_type)) {
      markSkipped.run(stamp(), "event type not mirrored (reconciled by the nightly full sync)", row.id);
      stats.skipped++;
    } else if (row.monday_board_id) {
      const key = deps.boardKeyForId(row.monday_board_id);
      if (!key) {
        markSkipped.run(stamp(), `board ${row.monday_board_id} not in boards.yaml/attorney-boards`, row.id);
        stats.skipped++;
      } else {
        const list = refreshByBoard.get(key) ?? [];
        list.push(row);
        refreshByBoard.set(key, list);
      }
    } else {
      markSkipped.run(stamp(), "event carried neither an item nor a board id", row.id);
      stats.skipped++;
    }
  }

  // Direct writes (deletions + notes) run under the sync advisory lock so they
  // never interleave with a full sync. If the lock is held, leave them pending.
  if (deletions.length > 0 || notes.length > 0) {
    if (acquireSyncLock(db, LOCK_HOLDER)) {
      try {
        for (const row of deletions) {
          try {
            const removed = archiveItemByMondayId(db, row.monday_item_id!);
            markProcessed.run(stamp(), row.id);
            stats.processed++;
            if (removed) console.log(`[webhooks] archived item ${row.monday_item_id} (${row.event_type})`);
          } catch (err) {
            markFailure(row, err instanceof Error ? err.message : String(err));
          }
        }
        for (const row of notes) {
          try {
            await refreshItemNotes(db, row.monday_item_id!);
            markProcessed.run(stamp(), row.id);
            stats.processed++;
          } catch (err) {
            markFailure(row, err instanceof Error ? err.message : String(err));
          }
        }
      } finally {
        releaseSyncLock(db, LOCK_HOLDER);
      }
    }
  }

  // Board refreshes: ONE targeted incremental sync covers every dirty board.
  // The child process takes the sync lock itself, so it runs after ours is
  // released. Events are only marked processed when the sync completes; a
  // skipped (busy) sync leaves them pending for the next tick, untouched.
  if (refreshByBoard.size > 0) {
    const boards = [...refreshByBoard.keys()];
    const affected = [...refreshByBoard.values()].flat();
    try {
      const ran = await deps.runTargetedSync(boards);
      if (ran) {
        for (const row of affected) {
          markProcessed.run(stamp(), row.id);
          stats.processed++;
        }
        stats.syncedBoards = boards;
      } else {
        stats.syncSkippedBusy = true;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      for (const row of affected) markFailure(row, message);
    }
  }

  prune(db);
  return stats;
}

/** Drop processed/skipped events past the retention window. */
function prune(db: Database): void {
  db.prepare(
    `DELETE FROM webhook_events WHERE status IN ('processed', 'skipped') AND received_at < datetime('now', ?)`,
  ).run(RETENTION);
}

// =============================================================================
// Scheduler
// =============================================================================

/** Drain the inbox once a minute (the cadence is also the debounce window: a
 *  burst of column changes on one board collapses into a single targeted sync). */
export function startWebhookProcessor(
  db: Database,
  deps: WebhookProcessorDeps,
  schedule = "* * * * *",
): void {
  let draining = false;
  cron.schedule(schedule, () => {
    if (draining) return; // a long targeted sync may outlive one tick
    draining = true;
    processWebhookEvents(db, deps)
      .then((s) => {
        if (s.processed || s.failed || s.syncedBoards.length) {
          console.log(
            `[webhooks] drained: ${s.processed} processed, ${s.skipped} skipped, ${s.failed} failed` +
              (s.syncedBoards.length ? ` — synced ${s.syncedBoards.join(", ")}` : "") +
              (s.syncSkippedBusy ? " (board refresh deferred — sync busy)" : ""),
          );
        }
      })
      .catch((err) => console.error("[webhooks] drain error:", err))
      .finally(() => {
        draining = false;
      });
  });
  console.log(`[webhooks] processor scheduled (${schedule}).`);
}
