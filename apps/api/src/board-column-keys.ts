// =============================================================================
// Board column keys — logical config key ↔ live Monday column
// =============================================================================
// board_items.column_values is keyed by the logical keys in config/boards.yaml
// (`hearing_date_calendaring`), while writes go to Monday column ids
// (`date_mkrjnbth`). The sync resolves one to the other while it runs and
// keeps no map, so this re-resolves it the same way (resolveAllColumns over
// the board's synced columns) for whoever needs both: the timeline's event
// panel (value per field) and the column write-back (local copy after a write).
//
// Also shapes a written value the way the sync stores it (scripts/sync/mapper.ts),
// so a local update reads exactly like the next sync will.
// =============================================================================

import type BetterSqlite3 from "better-sqlite3";
type DatabaseInstance = BetterSqlite3.Database;
import { resolveAllColumns, type MondayColumn } from "@case-pipeline/monday";
import { loadBoardsConfig, type BoardConfig } from "@case-pipeline/config";
import type { BoardColumn } from "@case-pipeline/query";

let boardsConfig: Promise<Record<string, BoardConfig>> | null = null;

/** config/boards.yaml, read once per process (it changes only with a deploy). */
export function getBoardsConfig(): Promise<Record<string, BoardConfig>> {
  boardsConfig ??= loadBoardsConfig().catch((err) => {
    boardsConfig = null; // a bad read is retried next time
    throw err;
  });
  return boardsConfig;
}

/** Logical key → the board's synced column it resolves to. Keys that don't resolve are left out. */
export function resolveColumnKeys(config: BoardConfig, columns: BoardColumn[]): Map<string, BoardColumn> {
  const byId = new Map(columns.map((c) => [c.columnId, c]));
  const monday: MondayColumn[] = columns.map((c) => ({ id: c.columnId, title: c.title, type: c.type, settings_str: "" }));
  const out = new Map<string, BoardColumn>();
  for (const [key, col] of Object.entries(resolveAllColumns(monday, config))) {
    const c = col && byId.get(col.id);
    if (c) out.set(key, c);
  }
  return out;
}

const STRATEGY_RANK: Record<string, number> = { by_id: 0, by_title: 1, by_type: 2 };

/**
 * Every logical key a Monday column id is stored under, the most specific
 * first (by_id, by_title, by_type). Usually one, but a loose `by_type: date`
 * key lands on the board's first date column, which another key may name by
 * id — the sync then stores the value under both.
 */
export function keysForColumn(config: BoardConfig, columns: BoardColumn[], columnId: string): string[] {
  return keysByColumn(config, columns).get(columnId) ?? [];
}

/** keysForColumn for every column at once: column id → its keys, most specific first. */
export function keysByColumn(config: BoardConfig, columns: BoardColumn[]): Map<string, string[]> {
  const rank = (key: string) => STRATEGY_RANK[config.columns[key]?.resolve ?? ""] ?? 3;
  const out = new Map<string, string[]>();
  for (const [key, col] of resolveColumnKeys(config, columns)) out.set(col.columnId, [...(out.get(col.columnId) ?? []), key]);
  for (const keys of out.values()) keys.sort((a, b) => rank(a) - rank(b));
  return out;
}

/** A written value in the shape the sync stores it; null = empty (the key is removed). */
export function shapeLocalValue(type: string, value: string): unknown {
  if (!value) return null;
  switch (type) {
    case "status":
    case "color":
      return { label: value };
    case "dropdown":
      return { labels: [value] };
    case "date":
      return { date: value.slice(0, 10) };
    default:
      return value;
  }
}

/**
 * Mirror a successful (or queued) column write into board_items, so the
 * timeline and every other page show it before the next sync, which then
 * reconciles authoritatively. A column the config doesn't name isn't stored
 * locally, so there is nothing to update.
 */
export function applyColumnLocally(
  db: DatabaseInstance,
  localId: string,
  key: string,
  type: string,
  value: string,
): void {
  const shaped = shapeLocalValue(type, value);
  const path = `$."${key.replace(/"/g, "")}"`;
  if (shaped === null) {
    db.prepare("UPDATE board_items SET column_values = json_remove(COALESCE(column_values, '{}'), ?) WHERE local_id = ?").run(path, localId);
  } else {
    db.prepare("UPDATE board_items SET column_values = json_set(COALESCE(column_values, '{}'), ?, json(?)) WHERE local_id = ?")
      .run(path, JSON.stringify(shaped), localId);
  }
  if (key === "status") db.prepare("UPDATE board_items SET status = ? WHERE local_id = ?").run(value || null, localId);
}
