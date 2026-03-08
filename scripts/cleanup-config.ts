// =============================================================================
// One-off script: Fix ambiguous column resolutions in boards.yaml
// =============================================================================
// Converts ALL ambiguous `by_type` entries to `by_id` using exact Monday.com
// column IDs. Also fixes `by_title` entries that don't match.
//
// Usage: bun scripts/cleanup-config.ts [--dry-run]
//
// Strategy:
// 1. For each board, fetch ALL columns from Monday.com
// 2. For each config entry, find the best matching column by title similarity
//    (ignoring the differ's "claimed" logic — we match independently)
// 3. If a type has multiple columns, convert to `by_id`
// 4. Remove config entries that have no plausible match (truly deleted columns)
// =============================================================================

import { setApiToken, fetchBoardStructure } from "../lib/monday";
import { loadBoardsConfig } from "../lib/config";
import type { BoardConfig, ColumnResolution } from "../lib/config/types";
import type { MondayColumn } from "../lib/monday/types";
import {
  loadRawBoardsConfig,
  writeConfigToFile,
} from "./sync-config/lib/yaml-generator";

const BOARDS_PATH = "config/boards.yaml";

/**
 * Normalize a string for comparison: lowercase, strip non-alphanumeric
 */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "").trim();
}

/**
 * Convert config key to normalized form: "link_to_jail_intakes" → "linktojailintakes"
 */
function normalizeKey(key: string): string {
  return normalize(key.replace(/_/g, " "));
}

/**
 * Score how well a Monday.com column matches a config key + resolution.
 * Returns 0-100, higher = better.
 */
function matchScore(
  configKey: string,
  resolution: ColumnResolution,
  column: MondayColumn
): number {
  const normKey = normalizeKey(configKey);
  const normTitle = normalize(column.title);

  // Type filter: if resolution specifies a type, column must match
  if (resolution.type && column.type !== resolution.type) return 0;
  if (resolution.types && !resolution.types.includes(column.type)) return 0;

  // Exact normalized match on title
  if (normKey === normTitle) return 100;

  // Pattern match (for by_title entries)
  if (resolution.pattern) {
    try {
      const regex = new RegExp(resolution.pattern, "i");
      if (regex.test(column.title)) return 95;
    } catch {}
  }

  // Exact ID match (for by_id entries that already work)
  if (resolution.id && column.id === resolution.id) return 100;

  // Containment: one contains the other
  if (normTitle.includes(normKey) && normKey.length >= 3) return 80;
  if (normKey.includes(normTitle) && normTitle.length >= 3) return 75;

  // Word overlap
  const keyWords = configKey.toLowerCase().replace(/_/g, " ").split(/\s+/).filter(w => w.length > 1);
  const titleWords = column.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter(w => w.length > 1);

  if (keyWords.length === 0 || titleWords.length === 0) return 0;

  let overlap = 0;
  for (const w of keyWords) {
    if (titleWords.some(tw => tw === w || tw.includes(w) || w.includes(tw))) overlap++;
  }

  if (overlap === 0) return 0;
  const ratio = overlap / Math.max(keyWords.length, titleWords.length);
  return Math.round(ratio * 65);
}

/**
 * For a board, find the best Monday.com column for each config entry.
 * Returns a map: configKey → { column, score } or null if no match.
 */
function resolveAllEntries(
  boardConfig: BoardConfig,
  mondayColumns: MondayColumn[]
): Map<string, { column: MondayColumn; score: number } | null> {
  const results = new Map<string, { column: MondayColumn; score: number } | null>();
  // Track which Monday columns are claimed to avoid double-assignment
  const claimed = new Set<string>();

  // First pass: find all candidates with scores
  const candidates: Array<{
    configKey: string;
    resolution: ColumnResolution;
    column: MondayColumn;
    score: number;
  }> = [];

  for (const [configKey, resolution] of Object.entries(boardConfig.columns)) {
    // If it's already by_id, keep it as-is
    if (resolution.resolve === "by_id" && resolution.id) {
      const col = mondayColumns.find(c => c.id === resolution.id);
      if (col) {
        results.set(configKey, { column: col, score: 100 });
        claimed.add(col.id);
      } else {
        results.set(configKey, null); // Column was deleted
      }
      continue;
    }

    for (const col of mondayColumns) {
      if (col.id === "name") continue;
      const score = matchScore(configKey, resolution, col);
      if (score >= 40) {
        candidates.push({ configKey, resolution, column: col, score });
      }
    }
  }

  // Sort by score descending — best matches first
  candidates.sort((a, b) => b.score - a.score);

  // Greedy assignment: best scores first, no double-claiming
  for (const c of candidates) {
    if (results.has(c.configKey)) continue; // Already resolved
    if (claimed.has(c.column.id)) continue; // Column already taken

    results.set(c.configKey, { column: c.column, score: c.score });
    claimed.add(c.column.id);
  }

  // Mark unresolved entries as null
  for (const configKey of Object.keys(boardConfig.columns)) {
    if (!results.has(configKey)) {
      results.set(configKey, null);
    }
  }

  return results;
}

interface FixAction {
  boardKey: string;
  configKey: string;
  action: "update_to_by_id" | "remove";
  oldResolution: ColumnResolution;
  newId?: string;
  columnTitle?: string;
  score?: number;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const token = process.env.MONDAY_API_TOKEN;
  if (!token) {
    console.error("Missing MONDAY_API_TOKEN");
    process.exit(1);
  }
  setApiToken(token);

  console.log("═".repeat(60));
  console.log("Config Cleanup: Convert all resolutions to by_id");
  console.log("═".repeat(60));
  if (dryRun) console.log("Mode: DRY RUN\n");

  const boardsConfig = await loadBoardsConfig(BOARDS_PATH);
  const rawConfig = await loadRawBoardsConfig(BOARDS_PATH);
  const fixes: FixAction[] = [];
  const removals: FixAction[] = [];

  for (const [boardKey, boardConfig] of Object.entries(boardsConfig)) {
    console.log(`\n${boardKey} (${boardConfig.id})...`);

    const board = await fetchBoardStructure(boardConfig.id);
    const resolutions = resolveAllEntries(boardConfig, board.columns);

    let fixCount = 0;
    let removeCount = 0;
    let keepCount = 0;

    for (const [configKey, match] of resolutions) {
      const resolution = boardConfig.columns[configKey];

      if (match) {
        // Already by_id with correct ID — skip
        if (resolution.resolve === "by_id" && resolution.id === match.column.id) {
          keepCount++;
          continue;
        }

        fixes.push({
          boardKey,
          configKey,
          action: "update_to_by_id",
          oldResolution: resolution,
          newId: match.column.id,
          columnTitle: match.column.title,
          score: match.score,
        });
        fixCount++;
        console.log(
          `  ✓ ${configKey} → "${match.column.title}" (${match.column.id}) [score=${match.score}]`
        );
      } else {
        removals.push({
          boardKey,
          configKey,
          action: "remove",
          oldResolution: resolution,
        });
        removeCount++;
        console.log(
          `  ✗ ${configKey} — no match, will remove`
        );
      }
    }

    if (fixCount === 0 && removeCount === 0) {
      console.log(`  ✓ All ${keepCount} entries already resolved by_id`);
    } else {
      console.log(`  → ${fixCount} to fix, ${removeCount} to remove, ${keepCount} already correct`);
    }
  }

  // Apply changes
  if (!dryRun) {
    // Apply fixes
    for (const fix of fixes) {
      const board = rawConfig.boards[fix.boardKey];
      if (board?.columns[fix.configKey]) {
        board.columns[fix.configKey] = { resolve: "by_id", id: fix.newId! };
      }
    }

    // Apply removals
    for (const rem of removals) {
      const board = rawConfig.boards[rem.boardKey];
      if (board?.columns[rem.configKey]) {
        delete board.columns[rem.configKey];
      }
    }

    await writeConfigToFile(BOARDS_PATH, rawConfig);
    console.log(`\nUpdated ${BOARDS_PATH}`);
  }

  // Summary
  console.log("\n" + "═".repeat(60));
  console.log("SUMMARY");
  console.log("═".repeat(60));
  console.log(`  Converted to by_id: ${fixes.length}`);
  console.log(`  Removed (no match): ${removals.length}`);

  if (removals.length > 0) {
    console.log("\n  Removed entries:");
    for (const r of removals) {
      console.log(`    ${r.boardKey}.${r.configKey}`);
    }
  }

  if (dryRun && (fixes.length > 0 || removals.length > 0)) {
    console.log("\nDRY RUN — run without --dry-run to apply changes");
  }

  console.log("");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
