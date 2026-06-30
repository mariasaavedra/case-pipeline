// =============================================================================
// Live Data Sync — Monday.com → data/live.db
// =============================================================================
// Pulls every board in config/boards.yaml from Monday.com and writes it into a
// local SQLite database (data/live.db) using the same schema as the seeder, so
// the API can serve real data when run with DB_SOURCE=live.
//
// Strategy: full replace. Each run rebuilds live.db from scratch (resetDatabase
// + one fresh batch). Incremental sync is a later optimization
// (see docs/features/live-data-sync.md "Open Questions").
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
  resolveAllColumns,
} from "@case-pipeline/monday";
import type { MondayItem } from "@case-pipeline/monday";
import { loadBoardsConfig } from "@case-pipeline/config";
import { initializeSchema, resetDatabase } from "@case-pipeline/seed/db/schema";
import { openDatabase } from "@case-pipeline/seed/db/connection";
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
  if (onlyBoards) {
    // Partial (--boards) run: keep the database, replace only targeted boards.
    initializeSchema(db);
  } else {
    // Full run: full replace from a clean, current-schema database.
    resetDatabase(db);
  }

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
      if (onlyBoards) db.prepare("DELETE FROM profiles").run();
      const insert = db.prepare(`
        INSERT INTO profiles (
          batch_id, local_id, monday_item_id, name, email, phone, address,
          date_of_birth, place_of_birth, a_number, priority, group_title,
          raw_column_values, sync_status, synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced', datetime('now'))
      `);
      const tx = db.transaction((rows: MondayItem[]) => {
        for (const item of rows) {
          const cvs = buildColumnValues(item, resolved);
          const localId = randomUUID();
          profilesByMondayId.set(item.id, localId);
          insert.run(
            batchId, localId, item.id, item.name,
            rawOf(cvs.email), rawOf(cvs.phone), rawOf(cvs.physical_address),
            rawOf(cvs.date_of_birth) ?? dateOf(cvs.date_of_birth),
            labelOf(cvs.country_of_birth) ?? rawOf(cvs.country_of_birth),
            normalizeANumber(rawOf(cvs.a_number)),
            labelOf(cvs.status),
            item.group?.title ?? null,
            JSON.stringify(cvs),
          );
        }
      });
      tx(items);
      counts[PROFILE_BOARD] = items.length;
    });
  }

  // ---- Pass 2: contracts (fee_ks) ----
  if (boardKeys.includes(CONTRACT_BOARD)) {
    await runPass(CONTRACT_BOARD, async () => {
      const { resolved, items } = await resolveBoard(CONTRACT_BOARD);
      if (onlyBoards) db.prepare("DELETE FROM contracts").run();
      const insert = db.prepare(`
        INSERT INTO contracts (
          batch_id, local_id, monday_item_id, profile_local_id, profile_monday_id,
          name, case_type, contract_id, status, group_title, raw_column_values, sync_status, synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced', datetime('now'))
      `);
      const tx = db.transaction((rows: MondayItem[]) => {
        for (const item of rows) {
          const cvs = buildColumnValues(item, resolved);
          const profileMondayId = firstLinkedId(cvs.profile);
          const profileLocalId = findProfileLocalId(cvs);
          if (!profileLocalId) orphanContracts++;
          insert.run(
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
          );
        }
      });
      tx(items);
      counts[CONTRACT_BOARD] = items.length;
    });
  }

  // ---- Pass 3: all other boards → board_items ----
  for (const key of boardKeys) {
    if (key === PROFILE_BOARD || key === CONTRACT_BOARD) continue;
    await runPass(key, async () => {
      const { resolved, items } = await resolveBoard(key);
      if (onlyBoards) db.prepare("DELETE FROM board_items WHERE board_key = ?").run(key);
      const insert = db.prepare(`
        INSERT INTO board_items (
          batch_id, local_id, monday_item_id, board_key, group_title, name,
          status, next_date, next_time, attorney, paralegals, profile_local_id,
          column_values, sync_status, synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced', datetime('now'))
      `);
      const tx = db.transaction((rows: MondayItem[]) => {
        for (const item of rows) {
          const cvs = buildColumnValues(item, resolved);
          const fields = extractBoardItemFields(key, cvs);
          insert.run(
            batchId, randomUUID(), item.id, key, item.group?.title ?? null, item.name,
            fields.status, fields.nextDate, fields.nextTime, fields.attorney, fields.paralegals,
            findProfileLocalId(cvs),
            JSON.stringify(cvs),
          );
        }
      });
      tx(items);
      counts[key] = items.length;
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
      const DELAY_MS = 300;
      let totalUpdates = 0;

      const insertUpdate = db.prepare(`
        INSERT INTO client_updates (
          batch_id, local_id, monday_update_id, profile_local_id,
          board_item_local_id, board_key, author_name, author_email,
          text_body, body_html, source_type, reply_to_update_id,
          created_at_source, raw_json, sync_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced')
      `);

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
    });
  }

  db.prepare("UPDATE seed_batches SET status = ? WHERE id = ?")
    .run(errors.length ? "partial" : "synced", batchId);

  // ---- Summary ----
  console.log("\n" + "=".repeat(60));
  console.log(errors.length ? "Sync finished with errors" : "Sync complete");
  console.log("=".repeat(60));
  console.log(`  Profiles: ${counts[PROFILE_BOARD] ?? 0}`);
  console.log(
    `  Contracts: ${counts[CONTRACT_BOARD] ?? 0}` +
      (orphanContracts ? ` (${orphanContracts} without a resolved profile)` : ""),
  );
  const boardItemTotal = Object.entries(counts)
    .filter(([k]) => k !== PROFILE_BOARD && k !== CONTRACT_BOARD && k !== "updates")
    .reduce((sum, [, n]) => sum + n, 0);
  console.log(`  Board items: ${boardItemTotal}`);
  console.log(`  Notes (updates + replies): ${counts["updates"] ?? 0}`);
  if (errors.length) {
    console.log(`\n  Failed boards (${errors.length}):`);
    for (const e of errors) console.log(`    - ${e.board}: ${e.error}`);
  }
  console.log(`  → ${dbPath}`);
  console.log(`\nRun the API against it with: DB_SOURCE=live npm run dev:api`);

  recordSyncResult(db, errors.length ? "partial" : "synced");
  releaseSyncLock(db, SYNC_HOLDER);
  db.close();
}

main().catch((err) => {
  console.error("\nFatal error during sync:", err);
  process.exit(1);
});
