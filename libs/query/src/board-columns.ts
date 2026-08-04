// =============================================================================
// Board column schema (all columns per board, with choice options)
// =============================================================================
// Read the full per-board column schema the sync captured into `board_columns`.
// Powers the all-columns expand/edit view: titles, types (which editor), and
// options+colors for status/dropdown/color columns.

import type BetterSqlite3 from "better-sqlite3";
type Database = BetterSqlite3.Database;
import type { BoardColumns, BoardColumn, StatusColumnOption } from "./types";

interface Row {
  board_key: string;
  monday_board_id: string;
  column_id: string;
  title: string;
  type: string;
  options: string | null;
  position: number;
}

function parseOptions(raw: string | null): StatusColumnOption[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StatusColumnOption[]) : [];
  } catch {
    return [];
  }
}

function toColumn(r: Row): BoardColumn {
  return { columnId: r.column_id, title: r.title, type: r.type, options: parseOptions(r.options), position: r.position };
}

/** Every board's full column schema, keyed by board_key on the client. */
export function getBoardColumns(db: Database): BoardColumns[] {
  const rows = db
    .prepare(
      `SELECT board_key, monday_board_id, column_id, title, type, options, position
       FROM board_columns ORDER BY board_key, position`
    )
    .all() as Row[];
  const byBoard = new Map<string, BoardColumns>();
  for (const r of rows) {
    let entry = byBoard.get(r.board_key);
    if (!entry) {
      entry = { boardKey: r.board_key, mondayBoardId: r.monday_board_id, columns: [] };
      byBoard.set(r.board_key, entry);
    }
    entry.columns.push(toColumn(r));
  }
  return [...byBoard.values()];
}

/** One board's column schema, or null if the sync hasn't captured it yet. */
export function getBoardColumnsFor(db: Database, boardKey: string): BoardColumns | null {
  const rows = db
    .prepare(
      `SELECT board_key, monday_board_id, column_id, title, type, options, position
       FROM board_columns WHERE board_key = ? ORDER BY position`
    )
    .all(boardKey) as Row[];
  if (rows.length === 0) return null;
  return { boardKey, mondayBoardId: rows[0]!.monday_board_id, columns: rows.map(toColumn) };
}
