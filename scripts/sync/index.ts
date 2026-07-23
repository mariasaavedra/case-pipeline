// =============================================================================
// Live Data Sync — Monday.com → data/live.db
// =============================================================================
// Pulls every board in config/boards.yaml from Monday.com and writes it into a
// local SQLite database (data/live.db) using the same schema as the seeder, so
// the API can serve real data when run with DB_SOURCE=live.
//
// Strategy: non-destructive UPSERT (schema v15+). Rows are matched on the stable
// monday_item_id and updated in place, so local_id survives every run — which is
// what keeps watchlists, saved views and /clients/:id links resolving. Nothing is
// dropped up front, so an interrupted run leaves the previous data intact instead
// of an empty database. Rows Monday stopped returning are removed by the
// reconciliation pass at the end, and ONLY for boards that fetched cleanly.
//
// Still a full walk of every board each run; fetching only what changed (via the
// updated_at watermark) is the next optimization. Note that watermark can never
// cover Emails & Activities: Monday does not bump an item's updated_at when only
// its E&A timeline changes (see scripts/phase0-updated-at.ts), so E&A needs its
// own sweep.
//
// Usage:
//   MONDAY_API_TOKEN=... npm run sync:live
//   npm run sync:live -- --max-items=200   # cap items per board (debugging)
//   npm run sync:live -- --boards=profiles,fee_ks,court_cases
//
// Column reshaping is handled by ./mapper (unit-tested in mapper.test.ts).
// =============================================================================

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  setApiToken,
  fetchBoardStructure,
  fetchAllBoardItems,
  fetchItemUpdatesBatch,
  fetchTimelineBatch,
  fetchCustomActivities,
  resolveAllColumns,
} from "@case-pipeline/monday";
import type { MondayItem, MondayTimelineItem } from "@case-pipeline/monday";
import { loadBoardsConfig } from "@case-pipeline/config";
import { initializeSchema } from "@case-pipeline/seed/db/schema";
import { openDatabase } from "@case-pipeline/seed/db/connection";
import { backupDatabase } from "../backup-db.js";
import { acquireSyncLock, releaseSyncLock, recordSyncResult } from "@case-pipeline/seed/db/sync-lock";
import { normalizeANumber } from "@case-pipeline/core";
import {
  buildColumnValues,
  extractBoardItemFields,
  firstLinkedId,
  type ResolvedColumnMeta,
} from "./mapper";

// =============================================================================
// Board → table routing (mirrors the seeder's structure)
// =============================================================================

const PROFILE_BOARD = "profiles";
const CONTRACT_BOARD = "fee_ks";
// Config keys that, when present as a board_relation, link an item to a profile.
const PROFILE_RELATION_KEYS = ["profile", "profiles", "person"];

// How many pre-sync safety snapshots to retain (each is a full live.db copy,
// ~0.8 GB). Kept separate from the daily backup series; 3 covers the last few
// full syncs while capping the disk they hold.
const PRESYNC_BACKUPS_KEPT = 3;

/**
 * True when live.db already holds real client data worth snapshotting before a
 * destructive reset. A first-ever sync (no schema, or an empty profiles table)
 * has nothing to lose and skips the pre-sync backup.
 */
function liveDbHasData(db: ReturnType<typeof openDatabase>): boolean {
  const hasTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='profiles'")
    .get();
  if (!hasTable) return false;
  const row = db.prepare("SELECT COUNT(*) AS n FROM profiles").get() as { n: number };
  return row.n > 0;
}

// =============================================================================
// CLI args
// =============================================================================

function parseArgs() {
  const args = process.argv.slice(2);
  let maxItems = 5000;
  let pageSize = 50;
  let onlyBoards: string[] | null = null;
  for (const arg of args) {
    if (arg.startsWith("--max-items=")) maxItems = parseInt(arg.split("=")[1] ?? "") || maxItems;
    else if (arg.startsWith("--page-size=")) pageSize = parseInt(arg.split("=")[1] ?? "") || pageSize;
    else if (arg.startsWith("--boards=")) onlyBoards = (arg.split("=")[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  }
  return { maxItems, pageSize, onlyBoards };
}

// =============================================================================
// Value accessors over shaped column_values
// =============================================================================

function labelOf(v: unknown): string | null {
  if (v && typeof v === "object" && "label" in v) return (v as { label?: string }).label ?? null;
  if (typeof v === "string") return v;
  return null;
}
function rawOf(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
function labelsOf(v: unknown): string | null {
  if (v && typeof v === "object" && "labels" in v) {
    const arr = (v as { labels?: unknown[] }).labels;
    if (Array.isArray(arr) && arr.length) return arr.join(", ");
  }
  return null;
}
function dateOf(v: unknown): string | null {
  if (v && typeof v === "object" && "date" in v) return (v as { date?: string }).date ?? null;
  return null;
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const token = process.env.MONDAY_API_TOKEN;
  if (!token) {
    console.error("Error: MONDAY_API_TOKEN is required for the live sync.");
    console.error("Set it in .env or pass it inline: MONDAY_API_TOKEN=... npm run sync:live");
    process.exit(1);
  }
  setApiToken(token);

  const { maxItems, pageSize, onlyBoards } = parseArgs();

  const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data");
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, "live.db");

  const db = openDatabase(dbPath);

  // The sync is UPSERT-based and non-destructive (schema v15+): rows are matched
  // on the stable monday_item_id and updated in place, so local_id survives every
  // run and an interrupted sync leaves the previous data intact rather than an
  // empty database. Rows Monday no longer returns are removed by the
  // reconciliation pass at the end — and only for boards that fetched cleanly.
  //
  // The pre-sync snapshot stays regardless: it is cheap next to a 3-hour run, and
  // it is the fallback if a bad run corrupts data rather than merely failing. If
  // there is real data and the snapshot fails, abort rather than write blind.
  if (liveDbHasData(db)) {
    try {
      const dest = await backupDatabase({
        existing: db,
        label: "live-presync",
        keep: PRESYNC_BACKUPS_KEPT,
        dataDir,
      });
      console.log(`[sync] Pre-sync safety backup written: ${dest}`);
    } catch (err) {
      // The sync lock is acquired below, after this block, so nothing to
      // release here — just close the handle and bail before writing anything.
      console.error("[sync] Pre-sync backup FAILED — aborting to avoid writing without a fallback.");
      console.error(err);
      db.close();
      process.exit(1);
    }
  }

  // Schema comes up to date only AFTER the snapshot, so the fallback captures
  // the database as it was before any migration touched it.
  initializeSchema(db);

  // Everything upserted by this run is stamped last_seen_at >= runStartedAt;
  // anything older is what Monday stopped returning (see reconcile()).
  const runStartedAt = new Date().toISOString();

  // Coordinate with the API's write-queue processor: take the sync advisory lock
  // so the two writers don't overlap. busy_timeout guarantees integrity even if
  // this is best-effort, so a contended lock is a warning, not a hard stop.
  const SYNC_HOLDER = `sync-${process.pid}`;
  if (!acquireSyncLock(db, SYNC_HOLDER)) {
    console.warn("[sync] Sync lock is held by another writer; proceeding (busy_timeout guards integrity).");
  }

  const batchInfo = db
    .prepare("INSERT INTO seed_batches (batch_name, status, metadata) VALUES (?, 'running', ?)")
    .run(`live-sync ${new Date().toISOString()}`, JSON.stringify({ source: "monday", maxItems }));
  const batchId = Number(batchInfo.lastInsertRowid);

  const boardsConfig = await loadBoardsConfig();

  // Merge attorney boards from data/attorney-boards.json into the boards config.
  // New boards added via Settings UI get their Monday.com ID here; they inherit
  // the column resolution of appointments_r (all appointment boards share the
  // same Monday board structure).
  const attorneyBoardsPath = path.join(dataDir, "attorney-boards.json");
  if (fs.existsSync(attorneyBoardsPath)) {
    try {
      const attorneyBoards = JSON.parse(fs.readFileSync(attorneyBoardsPath, "utf-8")) as Array<{
        boardKey: string;
        mondayBoardId: string;
        displayName: string;
        active: boolean;
      }>;
      const templateConfig = boardsConfig["appointments_r"];
      for (const ab of attorneyBoards) {
        if (ab.active && ab.mondayBoardId && !boardsConfig[ab.boardKey] && templateConfig) {
          boardsConfig[ab.boardKey] = { ...templateConfig, id: ab.mondayBoardId, name: ab.displayName };
        }
      }
    } catch {
      // Non-fatal — if the file is malformed, skip it.
    }
  }

  let boardKeys = Object.keys(boardsConfig);
  if (onlyBoards) boardKeys = boardKeys.filter((k) => onlyBoards.includes(k));

  console.log(`\nLive Data Sync → ${dbPath}`);
  console.log("=".repeat(60));
  console.log(`Batch ${batchId} · boards: ${boardKeys.length} · max items/board: ${maxItems}\n`);

  // monday_item_id → local profile id, used to resolve profile relations.
  const profilesByMondayId = new Map<string, string>();
  // Preload existing mappings so partial runs that skip the profiles board can
  // still resolve relations (harmless on a full run — table was just reset).
  for (const row of db
    .prepare("SELECT monday_item_id, local_id FROM profiles WHERE monday_item_id IS NOT NULL")
    .all() as Array<{ monday_item_id: string; local_id: string }>) {
    profilesByMondayId.set(row.monday_item_id, row.local_id);
  }
  const counts: Record<string, number> = {};
  const errors: Array<{ board: string; error: string }> = [];
  const truncations: Array<{ board: string; detail: string }> = [];
  // Boards whose fetch completed and whose rows were written. Only these are
  // eligible for reconciliation — a board that failed or came up short must
  // never have its "missing" rows deleted, because they were never fetched.
  const syncedBoards = new Set<string>();
  let orphanContracts = 0;

  // Run one board's sync in isolation: a failure logs and is skipped so one bad
  // board never aborts the rest of the sync.
  async function runPass(key: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`\n  ✗ ${key} failed: ${msg}`);
      errors.push({ board: key, error: msg });
    }
  }

  // ---- Helper: resolve a board's columns once ----
  async function resolveBoard(key: string) {
    const config = boardsConfig[key]!;
    const structure = await fetchBoardStructure(config.id);
    const resolved = resolveAllColumns(structure.columns, config) as Record<string, ResolvedColumnMeta | undefined>;
    const items = await fetchAllBoardItems(config.id, {
      maxItems,
      pageSize,
      onProgress: (n) => process.stdout.write(`\r  ${key}: ${n} items`),
      onTruncated: (t) => {
        const detail =
          t.reason === "max_items_cap"
            ? `hit max-items cap (${maxItems}); board has more items — raise --max-items to sync the full board`
            : `pagination ended early — fetched ${t.fetched} of ${t.expected} items Monday reports (likely a transient API truncation; re-run the sync)`;
        // Newline first so we don't clobber the in-progress progress line.
        console.warn(`\n  ⚠ ${key}: ${detail}`);
        truncations.push({ board: key, detail });
      },
    });
    process.stdout.write(`\r  ${key}: ${items.length} items ✓\n`);
    return { config, resolved, items };
  }

  function findProfileLocalId(columnValues: Record<string, unknown>): string | null {
    for (const k of PROFILE_RELATION_KEYS) {
      const mondayId = firstLinkedId(columnValues[k]);
      if (mondayId) return profilesByMondayId.get(mondayId) ?? null;
    }
    return null;
  }

  // ---- Pass 1: profiles (first, so later passes can resolve relations) ----
  if (boardKeys.includes(PROFILE_BOARD)) {
    await runPass(PROFILE_BOARD, async () => {
      const { resolved, items } = await resolveBoard(PROFILE_BOARD);
      // UPSERT on the stable monday_item_id. local_id is deliberately absent from
      // the DO UPDATE list: it is generated once, on first insert, and preserved
      // forever after — which is what lets watchlists, saved views and every
      // /clients/:id link keep resolving across syncs. RETURNING hands back the
      // effective local_id (existing row's or the freshly generated one).
      const upsert = db.prepare(`
        INSERT INTO profiles (
          batch_id, local_id, monday_item_id, name, email, phone, address,
          date_of_birth, place_of_birth, a_number, priority, group_title,
          raw_column_values, updated_at_source, sync_status, synced_at, last_seen_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced', datetime('now'), ?)
        ON CONFLICT(monday_item_id) DO UPDATE SET
          batch_id = excluded.batch_id,
          name = excluded.name,
          email = excluded.email,
          phone = excluded.phone,
          address = excluded.address,
          date_of_birth = excluded.date_of_birth,
          place_of_birth = excluded.place_of_birth,
          a_number = excluded.a_number,
          priority = excluded.priority,
          group_title = excluded.group_title,
          raw_column_values = excluded.raw_column_values,
          updated_at_source = excluded.updated_at_source,
          sync_status = 'synced',
          sync_error = NULL,
          synced_at = datetime('now'),
          last_seen_at = excluded.last_seen_at,
          deleted_at = NULL
        RETURNING local_id
      `);
      const tx = db.transaction((rows: MondayItem[]) => {
        for (const item of rows) {
          const cvs = buildColumnValues(item, resolved);
          const row = upsert.get(
            batchId, randomUUID(), item.id, item.name,
            rawOf(cvs.email), rawOf(cvs.phone), rawOf(cvs.physical_address),
            rawOf(cvs.date_of_birth) ?? dateOf(cvs.date_of_birth),
            labelOf(cvs.country_of_birth) ?? rawOf(cvs.country_of_birth),
            normalizeANumber(rawOf(cvs.a_number)),
            labelOf(cvs.status),
            item.group?.title ?? null,
            JSON.stringify(cvs),
            item.updated_at ?? null,
            runStartedAt,
          ) as { local_id: string };
          profilesByMondayId.set(item.id, row.local_id);
        }
      });
      tx(items);
      counts[PROFILE_BOARD] = items.length;
      syncedBoards.add(PROFILE_BOARD);
    });
  }

  // ---- Pass 2: contracts (fee_ks) ----
  if (boardKeys.includes(CONTRACT_BOARD)) {
    await runPass(CONTRACT_BOARD, async () => {
      const { resolved, items } = await resolveBoard(CONTRACT_BOARD);
      // UPSERT keyed on monday_item_id; local_id preserved (see the profiles pass).
      const upsert = db.prepare(`
        INSERT INTO contracts (
          batch_id, local_id, monday_item_id, profile_local_id, profile_monday_id,
          name, case_type, contract_id, status, group_title, raw_column_values,
          updated_at_source, sync_status, synced_at, last_seen_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced', datetime('now'), ?)
        ON CONFLICT(monday_item_id) DO UPDATE SET
          batch_id = excluded.batch_id,
          profile_local_id = excluded.profile_local_id,
          profile_monday_id = excluded.profile_monday_id,
          name = excluded.name,
          case_type = excluded.case_type,
          contract_id = excluded.contract_id,
          status = excluded.status,
          group_title = excluded.group_title,
          raw_column_values = excluded.raw_column_values,
          updated_at_source = excluded.updated_at_source,
          sync_status = 'synced',
          sync_error = NULL,
          synced_at = datetime('now'),
          last_seen_at = excluded.last_seen_at,
          deleted_at = NULL
      `);
      const tx = db.transaction((rows: MondayItem[]) => {
        for (const item of rows) {
          const cvs = buildColumnValues(item, resolved);
          const profileMondayId = firstLinkedId(cvs.profile);
          const profileLocalId = findProfileLocalId(cvs);
          if (!profileLocalId) orphanContracts++;
          upsert.run(
            batchId, randomUUID(), item.id,
            // contracts.profile_local_id is NOT NULL; orphans (no resolvable
            // profile link) get "" so they still sync without breaking joins.
            profileLocalId ?? "", profileMondayId,
            item.name,
            // case type: "contract_for" is a dropdown → { labels: [...] }
            labelsOf(cvs.contract_for) ?? labelOf(cvs.contract_for) ?? rawOf(cvs.contract_for),
            rawOf(cvs.fee_k_id),
            labelOf(cvs.contract_stage) ?? labelOf(cvs.ps_stage),
            item.group?.title ?? null,
            JSON.stringify(cvs),
            item.updated_at ?? null,
            runStartedAt,
          );
        }
      });
      tx(items);
      counts[CONTRACT_BOARD] = items.length;
      syncedBoards.add(CONTRACT_BOARD);
    });
  }

  // ---- Pass 3: all other boards → board_items ----
  for (const key of boardKeys) {
    if (key === PROFILE_BOARD || key === CONTRACT_BOARD) continue;
    await runPass(key, async () => {
      const { resolved, items } = await resolveBoard(key);
      // UPSERT keyed on monday_item_id; local_id preserved (see the profiles pass).
      const upsert = db.prepare(`
        INSERT INTO board_items (
          batch_id, local_id, monday_item_id, board_key, group_title, name,
          status, next_date, next_time, attorney, paralegals, profile_local_id,
          column_values, updated_at_source, sync_status, synced_at, last_seen_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced', datetime('now'), ?)
        ON CONFLICT(monday_item_id) DO UPDATE SET
          batch_id = excluded.batch_id,
          board_key = excluded.board_key,
          group_title = excluded.group_title,
          name = excluded.name,
          status = excluded.status,
          next_date = excluded.next_date,
          next_time = excluded.next_time,
          attorney = excluded.attorney,
          paralegals = excluded.paralegals,
          profile_local_id = excluded.profile_local_id,
          column_values = excluded.column_values,
          updated_at_source = excluded.updated_at_source,
          sync_status = 'synced',
          sync_error = NULL,
          synced_at = datetime('now'),
          last_seen_at = excluded.last_seen_at,
          deleted_at = NULL
      `);
      const tx = db.transaction((rows: MondayItem[]) => {
        for (const item of rows) {
          const cvs = buildColumnValues(item, resolved);
          const fields = extractBoardItemFields(key, cvs);
          upsert.run(
            batchId, randomUUID(), item.id, key, item.group?.title ?? null, item.name,
            fields.status, fields.nextDate, fields.nextTime, fields.attorney, fields.paralegals,
            findProfileLocalId(cvs),
            JSON.stringify(cvs),
            item.updated_at ?? null,
            runStartedAt,
          );
        }
      });
      tx(items);
      counts[key] = items.length;
      syncedBoards.add(key);
    });
  }

  // ---- Pass 4: updates (comments + replies on every profile and board item) ----
  if (!onlyBoards) {
    await runPass("updates", async () => {
      // Build a lookup: monday_item_id → { profile_local_id, board_item_local_id, board_key }
      type ItemMeta = { profile_local_id: string; board_item_local_id: string | null; board_key: string | null };
      const itemMeta = new Map<string, ItemMeta>();

      for (const row of db.prepare(
        "SELECT monday_item_id, local_id FROM profiles WHERE monday_item_id IS NOT NULL"
      ).all() as { monday_item_id: string; local_id: string }[]) {
        itemMeta.set(row.monday_item_id, {
          profile_local_id: row.local_id,
          board_item_local_id: null,
          board_key: null,
        });
      }

      for (const row of db.prepare(
        "SELECT monday_item_id, local_id, profile_local_id, board_key FROM board_items WHERE monday_item_id IS NOT NULL AND profile_local_id != ''"
      ).all() as { monday_item_id: string; local_id: string; profile_local_id: string; board_key: string }[]) {
        itemMeta.set(row.monday_item_id, {
          profile_local_id: row.profile_local_id,
          board_item_local_id: row.local_id,
          board_key: row.board_key,
        });
      }

      const allIds = [...itemMeta.keys()];
      const BATCH = 25;
      // E&A timeline queries are heavier than updates, so they get a smaller
      // per-request fan-out to stay under the API complexity budget.
      const TIMELINE_BATCH = 12;
      const DELAY_MS = 300;
      let totalUpdates = 0;
      let totalTimeline = 0;

      // custom_activity id → name, so E&A rows of type=custom get a readable label.
      const customActivityNames = await fetchCustomActivities();

      const insertUpdate = db.prepare(`
        INSERT INTO client_updates (
          batch_id, local_id, monday_update_id, profile_local_id,
          board_item_local_id, board_key, author_name, author_email,
          text_body, body_html, source_type, reply_to_update_id,
          created_at_source, raw_json, sync_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced')
      `);

      // E&A rows. INSERT OR IGNORE honors the content-signature unique index:
      // the same event surfaces on the profile AND its connected board items
      // (each with a different monday_timeline_id), so content_sig is what keeps
      // one row per logical event per profile.
      const insertTimelineItem = db.prepare(`
        INSERT OR IGNORE INTO client_updates (
          batch_id, local_id, monday_timeline_id, profile_local_id,
          board_item_local_id, board_key, author_name, author_email,
          title, text_body, body_html, source_type, activity_type_name, content_sig,
          created_at_source, raw_json, sync_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced')
      `);

      // Content signature (must match the SQL backfill in schema migration v14):
      // created_at + author + first 300 chars of the stripped body, \x1f-joined.
      const US = "\x1f";
      function contentSig(createdAt: string, author: string, strippedBody: string): string {
        return `${createdAt}${US}${author}${US}${strippedBody.slice(0, 300)}`;
      }

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

      for (let i = 0; i < allIds.length; i += BATCH) {
        const batch = allIds.slice(i, i + BATCH);
        const updatesMap = await fetchItemUpdatesBatch(batch, 100);

        const tx = db.transaction(() => {
          for (const [mondayItemId, updates] of updatesMap) {
            const meta = itemMeta.get(mondayItemId);
            if (!meta) continue;

            for (const update of updates) {
              insertUpdate.run(
                batchId, randomUUID(), update.id,
                meta.profile_local_id, meta.board_item_local_id, meta.board_key,
                update.creator?.name ?? "Unknown", update.creator?.email ?? null,
                stripHtml(update.body), update.body,
                "update", null,
                update.created_at, JSON.stringify(update),
              );
              totalUpdates++;

              for (const reply of update.replies ?? []) {
                insertUpdate.run(
                  batchId, randomUUID(), reply.id,
                  meta.profile_local_id, meta.board_item_local_id, meta.board_key,
                  reply.creator?.name ?? "Unknown", reply.creator?.email ?? null,
                  stripHtml(reply.body), reply.body,
                  "reply", update.id,
                  reply.created_at, JSON.stringify(reply),
                );
                totalUpdates++;
              }
            }
          }
        });
        tx();

        process.stdout.write(`\r  updates: ${Math.min(i + BATCH, allIds.length)}/${allIds.length} items (${totalUpdates} notes)`);
        if (i + BATCH < allIds.length) await new Promise((r) => setTimeout(r, DELAY_MS));
      }

      process.stdout.write(`\r  updates: ${allIds.length}/${allIds.length} items (${totalUpdates} notes) ✓\n`);
      counts["updates"] = totalUpdates;

      // ---- Emails & Activities (E&A) timeline → same client_updates table ----
      // Merged into the unified per-profile timeline alongside updates/replies.
      // Deduped by INSERT OR IGNORE on the content-signature index.
      let totalTimelineSkipped = 0;

      // Insert one item's timeline entries; returns rows actually written
      // (INSERT OR IGNORE returns 0 for a duplicate collapsed by content_sig).
      const insertTimelineFor = (timelineMap: Map<string, MondayTimelineItem[]>) => {
        const tx = db.transaction(() => {
          for (const [mondayItemId, items] of timelineMap) {
            const meta = itemMeta.get(mondayItemId);
            if (!meta) continue;
            for (const item of items) {
              const html = item.content ?? "";
              const author = item.user?.name ?? "Unknown";
              const stripped = stripHtml(html);
              const activityName =
                item.custom_activity_id ? customActivityNames.get(item.custom_activity_id) ?? null : null;
              const res = insertTimelineItem.run(
                batchId, randomUUID(), item.id,
                meta.profile_local_id, meta.board_item_local_id, meta.board_key,
                author, null,
                item.title ?? null, stripped, html || null,
                item.type, activityName, contentSig(item.created_at, author, stripped),
                item.created_at, JSON.stringify(item),
              );
              if (res.changes > 0) totalTimeline++;
            }
          }
        });
        tx();
      };

      for (let i = 0; i < allIds.length; i += TIMELINE_BATCH) {
        const batch = allIds.slice(i, i + TIMELINE_BATCH);
        try {
          insertTimelineFor(await fetchTimelineBatch(batch, 50));
        } catch (batchErr) {
          // A transient Monday CRM subgraph error must not abort the whole pass.
          // Retry the batch one item at a time; skip (and count) only the item(s)
          // that genuinely fail, so one bad item never loses its 11 neighbors.
          const msg = batchErr instanceof Error ? batchErr.message : String(batchErr);
          console.warn(`\n  [E&A] batch failed (${msg.slice(0, 120)}); falling back to per-item…`);
          for (const id of batch) {
            try {
              insertTimelineFor(await fetchTimelineBatch([id], 50));
            } catch (itemErr) {
              totalTimelineSkipped++;
              const im = itemErr instanceof Error ? itemErr.message : String(itemErr);
              console.warn(`  [E&A] skipped item ${id}: ${im.slice(0, 100)}`);
            }
          }
        }

        process.stdout.write(`\r  emails & activities: ${Math.min(i + TIMELINE_BATCH, allIds.length)}/${allIds.length} items (${totalTimeline} entries${totalTimelineSkipped ? `, ${totalTimelineSkipped} skipped` : ""})`);
        if (i + TIMELINE_BATCH < allIds.length) await new Promise((r) => setTimeout(r, DELAY_MS));
      }

      process.stdout.write(`\r  emails & activities: ${allIds.length}/${allIds.length} items (${totalTimeline} entries${totalTimelineSkipped ? `, ${totalTimelineSkipped} skipped` : ""}) ✓\n`);
      counts["emails_activities"] = totalTimeline;
      if (totalTimelineSkipped > 0) {
        counts["emails_activities_skipped"] = totalTimelineSkipped;
      }
    });
  }

  // ---- Reconciliation: drop rows Monday no longer returns ----
  //
  // The sync upserts rather than resetting, so items deleted or archived in
  // Monday would otherwise linger forever. Anything belonging to a board that
  // synced cleanly, yet carries a last_seen_at older than this run, is gone
  // upstream and is removed here.
  //
  // The gating is the whole point: a board is reconciled ONLY if its fetch both
  // succeeded AND was not truncated. That is what makes an interrupted or flaky
  // run safe — the old code DROPped everything up front, so a network timeout
  // wiped a board (as _cd_open_forms was on 2026-07-23); now a board that fails
  // simply keeps yesterday's rows untouched.
  const truncatedBoards = new Set(truncations.map((t) => t.board));
  const reconcilable = [...syncedBoards].filter((b) => !truncatedBoards.has(b));
  const removed: Record<string, number> = {};

  if (reconcilable.length > 0) {
    const reconcile = db.transaction(() => {
      for (const board of reconcilable) {
        if (board === PROFILE_BOARD) {
          const r = db
            .prepare("DELETE FROM profiles WHERE last_seen_at IS NULL OR last_seen_at < ?")
            .run(runStartedAt);
          if (r.changes > 0) removed[PROFILE_BOARD] = r.changes;
        } else if (board === CONTRACT_BOARD) {
          const r = db
            .prepare("DELETE FROM contracts WHERE last_seen_at IS NULL OR last_seen_at < ?")
            .run(runStartedAt);
          if (r.changes > 0) removed[CONTRACT_BOARD] = r.changes;
        } else {
          const r = db
            .prepare("DELETE FROM board_items WHERE board_key = ? AND (last_seen_at IS NULL OR last_seen_at < ?)")
            .run(board, runStartedAt);
          if (r.changes > 0) removed[board] = r.changes;
        }
      }
    });
    reconcile();
  }

  const totalRemoved = Object.values(removed).reduce((a, b) => a + b, 0);
  const skippedReconcile = [...truncatedBoards].filter((b) => syncedBoards.has(b));

  // A truncated board (silent short-read or a hit max-items cap) means the DB
  // is not a complete mirror of Monday, so the run is "partial" even when no
  // pass threw outright.
  const partial = errors.length > 0 || truncations.length > 0;

  db.prepare("UPDATE seed_batches SET status = ? WHERE id = ?")
    .run(partial ? "partial" : "synced", batchId);

  // ---- Summary ----
  console.log("\n" + "=".repeat(60));
  console.log(
    errors.length
      ? "Sync finished with errors"
      : truncations.length
        ? "Sync complete (with truncated boards)"
        : "Sync complete",
  );
  console.log("=".repeat(60));
  console.log(`  Profiles: ${counts[PROFILE_BOARD] ?? 0}`);
  console.log(
    `  Contracts: ${counts[CONTRACT_BOARD] ?? 0}` +
      (orphanContracts ? ` (${orphanContracts} without a resolved profile)` : ""),
  );
  const NON_BOARD_COUNT_KEYS = new Set([
    PROFILE_BOARD,
    CONTRACT_BOARD,
    "updates",
    "emails_activities",
    "emails_activities_skipped",
  ]);
  const boardItemTotal = Object.entries(counts)
    .filter(([k]) => !NON_BOARD_COUNT_KEYS.has(k))
    .reduce((sum, [, n]) => sum + n, 0);
  console.log(`  Board items: ${boardItemTotal}`);
  console.log(`  Notes (updates + replies): ${counts["updates"] ?? 0}`);
  const skippedEA = counts["emails_activities_skipped"] ?? 0;
  console.log(
    `  Emails & activities: ${counts["emails_activities"] ?? 0}` +
      (skippedEA ? ` (${skippedEA} item${skippedEA === 1 ? "" : "s"} skipped after fetch failures)` : ""),
  );
  if (totalRemoved > 0) {
    console.log(
      `  Removed (gone from Monday): ${totalRemoved} — ` +
        Object.entries(removed).map(([b, n]) => `${b}:${n}`).join(", "),
    );
  }
  if (skippedReconcile.length) {
    console.log(
      `\n  Reconciliation SKIPPED for ${skippedReconcile.length} truncated board(s): ${skippedReconcile.join(", ")}` +
        `\n    (their rows were kept — a short fetch must never be read as "deleted upstream")`,
    );
  }
  if (truncations.length) {
    console.log(`\n  Truncated boards (${truncations.length}):`);
    for (const t of truncations) console.log(`    - ${t.board}: ${t.detail}`);
  }
  if (errors.length) {
    console.log(`\n  Failed boards (${errors.length}):`);
    for (const e of errors) console.log(`    - ${e.board}: ${e.error}`);
  }
  console.log(`  → ${dbPath}`);
  console.log(`\nRun the API against it with: DB_SOURCE=live npm run dev:api`);

  recordSyncResult(db, partial ? "partial" : "synced");
  releaseSyncLock(db, SYNC_HOLDER);
  db.close();
}

main().catch((err) => {
  console.error("\nFatal error during sync:", err);
  process.exit(1);
});
