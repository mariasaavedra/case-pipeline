// =============================================================================
// Board status column options (labels + native Monday colors)
// =============================================================================
// Read the per-board status column definitions the sync captured into
// `board_status_options`. Powers the status editor: it restricts writes to the
// labels that exist in Monday and renders each in its real color.

import type BetterSqlite3 from "better-sqlite3";
type Database = BetterSqlite3.Database;
import type { BoardStatusOptions, StatusColumnOption } from "./types";

interface Row {
  board_key: string;
  monday_board_id: string;
  status_column_id: string;
  options: string;
}

function parseOptions(raw: string): StatusColumnOption[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StatusColumnOption[]) : [];
  } catch {
    return [];
  }
}

/** All boards' status column definitions, keyed by board_key on the client. */
export function getBoardStatusOptions(db: Database): BoardStatusOptions[] {
  const rows = db
    .prepare(
      `SELECT board_key, monday_board_id, status_column_id, options
       FROM board_status_options
       ORDER BY board_key`
    )
    .all() as Row[];
  return rows.map((r) => ({
    boardKey: r.board_key,
    mondayBoardId: r.monday_board_id,
    statusColumnId: r.status_column_id,
    options: parseOptions(r.options),
  }));
}

/** One board's status column definition, or null if the sync hasn't seen it. */
export function getBoardStatusOptionsFor(db: Database, boardKey: string): BoardStatusOptions | null {
  const row = db
    .prepare(
      `SELECT board_key, monday_board_id, status_column_id, options
       FROM board_status_options WHERE board_key = ?`
    )
    .get(boardKey) as Row | undefined;
  if (!row) return null;
  return {
    boardKey: row.board_key,
    mondayBoardId: row.monday_board_id,
    statusColumnId: row.status_column_id,
    options: parseOptions(row.options),
  };
}
