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

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  setApiToken,
  fetchBoardStructure,
  fetchAllBoardItems,
  resolveAllColumns,
} from "@case-pipeline/monday";
import type { MondayItem } from "@case-pipeline/monday";
import { loadBoardsConfig } from "@case-pipeline/config";
import { initializeSchema, resetDatabase } from "@case-pipeline/seed/db/schema";
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
  let onlyBoards: string[] | null = null;
  for (const arg of args) {
    if (arg.startsWith("--max-items=")) maxItems = parseInt(arg.split("=")[1] ?? "") || maxItems;
    else if (arg.startsWith("--boards=")) onlyBoards = (arg.split("=")[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  }
  return { maxItems, onlyBoards };
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

  const { maxItems, onlyBoards } = parseArgs();

  const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data");
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, "live.db");

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  initializeSchema(db);
  // Full replace: start from a clean, current-schema database every run.
  resetDatabase(db);

  const batchInfo = db
    .prepare("INSERT INTO seed_batches (batch_name, status, metadata) VALUES (?, 'running', ?)")
    .run(`live-sync ${new Date().toISOString()}`, JSON.stringify({ source: "monday", maxItems }));
  const batchId = Number(batchInfo.lastInsertRowid);

  const boardsConfig = await loadBoardsConfig();
  let boardKeys = Object.keys(boardsConfig);
  if (onlyBoards) boardKeys = boardKeys.filter((k) => onlyBoards.includes(k));

  console.log(`\nLive Data Sync → ${dbPath}`);
  console.log("=".repeat(60));
  console.log(`Batch ${batchId} · boards: ${boardKeys.length} · max items/board: ${maxItems}\n`);

  // monday_item_id → local profile id, built during the profiles pass.
  const profilesByMondayId = new Map<string, string>();
  const counts: Record<string, number> = {};

  // ---- Helper: resolve a board's columns once ----
  async function resolveBoard(key: string) {
    const config = boardsConfig[key]!;
    const structure = await fetchBoardStructure(config.id);
    const resolved = resolveAllColumns(structure.columns, config) as Record<string, ResolvedColumnMeta | undefined>;
    const items = await fetchAllBoardItems(config.id, {
      maxItems,
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

  // ---- Pass 1: profiles ----
  if (boardKeys.includes(PROFILE_BOARD)) {
    const { resolved, items } = await resolveBoard(PROFILE_BOARD);
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
  }

  // ---- Pass 2: contracts (fee_ks) ----
  if (boardKeys.includes(CONTRACT_BOARD)) {
    const { resolved, items } = await resolveBoard(CONTRACT_BOARD);
    const insert = db.prepare(`
      INSERT INTO contracts (
        batch_id, local_id, monday_item_id, profile_local_id, profile_monday_id,
        name, case_type, contract_id, status, raw_column_values, sync_status, synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced', datetime('now'))
    `);
    const tx = db.transaction((rows: MondayItem[]) => {
      for (const item of rows) {
        const cvs = buildColumnValues(item, resolved);
        const profileMondayId = firstLinkedId(cvs.profile);
        insert.run(
          batchId, randomUUID(), item.id,
          findProfileLocalId(cvs), profileMondayId,
          item.name,
          rawOf(cvs.contract_for) ?? labelOf(cvs.contract_for),
          rawOf(cvs.fee_k_id),
          labelOf(cvs.contract_stage) ?? labelOf(cvs.ps_stage),
          JSON.stringify(cvs),
        );
      }
    });
    tx(items);
    counts[CONTRACT_BOARD] = items.length;
  }

  // ---- Pass 3: all other boards → board_items ----
  for (const key of boardKeys) {
    if (key === PROFILE_BOARD || key === CONTRACT_BOARD) continue;
    const { resolved, items } = await resolveBoard(key);
    const insert = db.prepare(`
      INSERT INTO board_items (
        batch_id, local_id, monday_item_id, board_key, group_title, name,
        status, next_date, attorney, paralegals, profile_local_id,
        column_values, sync_status, synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced', datetime('now'))
    `);
    const tx = db.transaction((rows: MondayItem[]) => {
      for (const item of rows) {
        const cvs = buildColumnValues(item, resolved);
        const fields = extractBoardItemFields(key, cvs);
        insert.run(
          batchId, randomUUID(), item.id, key, item.group?.title ?? null, item.name,
          fields.status, fields.nextDate, fields.attorney, fields.paralegals,
          findProfileLocalId(cvs),
          JSON.stringify(cvs),
        );
      }
    });
    tx(items);
    counts[key] = items.length;
  }

  db.prepare("UPDATE seed_batches SET status = 'synced' WHERE id = ?").run(batchId);

  // ---- Summary ----
  console.log("\n" + "=".repeat(60));
  console.log("Sync complete");
  console.log("=".repeat(60));
  console.log(`  Profiles: ${counts[PROFILE_BOARD] ?? 0}`);
  console.log(`  Contracts: ${counts[CONTRACT_BOARD] ?? 0}`);
  const boardItemTotal = Object.entries(counts)
    .filter(([k]) => k !== PROFILE_BOARD && k !== CONTRACT_BOARD)
    .reduce((sum, [, n]) => sum + n, 0);
  console.log(`  Board items: ${boardItemTotal}`);
  console.log(`  → ${dbPath}`);
  console.log(`\nRun the API against it with: DB_SOURCE=live npm run dev:api`);

  db.close();
}

main().catch((err) => {
  console.error("\nFatal error during sync:", err);
  process.exit(1);
});
