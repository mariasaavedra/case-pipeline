// =============================================================================
// Board Item Queries
// =============================================================================

import type BetterSqlite3 from "better-sqlite3";
type Database = BetterSqlite3.Database;
import type { BoardItemSummary } from "./types";
import { APPOINTMENT_BOARD_KEYS } from "./types";

interface RawBatchBoardItemRow extends RawBoardItemRow {
  profile_local_id: string;
}

interface RawBoardItemRow {
  localId: string;
  boardKey: string;
  name: string;
  status: string | null;
  nextDate: string | null;
  attorney: string | null;
  groupTitle: string | null;
  column_values: string;
}

/**
 * Batch-fetch board items for multiple profiles in one query.
 * Returns a Map keyed by profileLocalId; each entry mirrors the shape of
 * getClientBoardItems (byBoard grouped by board_key, appointments separate).
 */
export function batchGetClientBoardItems(
  db: Database,
  profileLocalIds: string[]
): Map<string, { byBoard: Record<string, BoardItemSummary[]>; appointments: BoardItemSummary[] }> {
  if (profileLocalIds.length === 0) return new Map();

  const placeholders = profileLocalIds.map(() => "?").join(",");
  const rows = db
    .prepare(`
      SELECT
        profile_local_id,
        local_id AS localId,
        board_key AS boardKey,
        name,
        status,
        next_date AS nextDate,
        attorney,
        group_title AS groupTitle,
        column_values
      FROM board_items
      WHERE profile_local_id IN (${placeholders})
      ORDER BY profile_local_id, board_key, next_date
    `)
    .all(...profileLocalIds) as RawBatchBoardItemRow[];

  const result = new Map<string, { byBoard: Record<string, BoardItemSummary[]>; appointments: BoardItemSummary[] }>();
  for (const row of rows) {
    let entry = result.get(row.profile_local_id);
    if (!entry) {
      entry = { byBoard: {}, appointments: [] };
      result.set(row.profile_local_id, entry);
    }
    const item: BoardItemSummary = {
      localId: row.localId,
      boardKey: row.boardKey,
      name: row.name,
      status: row.status,
      nextDate: row.nextDate,
      attorney: row.attorney,
      groupTitle: row.groupTitle,
      columnValues: safeParseJson(row.column_values),
    };
    if (APPOINTMENT_BOARD_KEYS.has(row.boardKey)) {
      entry.appointments.push(item);
    } else {
      (entry.byBoard[row.boardKey] ??= []).push(item);
    }
  }
  return result;
}

/**
 * Get all board items for a profile, grouped by board_key.
 * Appointments are returned separately.
 */
export function getClientBoardItems(
  db: Database,
  profileLocalId: string
): { byBoard: Record<string, BoardItemSummary[]>; appointments: BoardItemSummary[] } {
  const rows = db
    .prepare(`
      SELECT
        local_id AS localId,
        board_key AS boardKey,
        name,
        status,
        next_date AS nextDate,
        attorney,
        group_title AS groupTitle,
        column_values
      FROM board_items
      WHERE profile_local_id = ?
      ORDER BY board_key, next_date
    `)
    .all(profileLocalId) as RawBoardItemRow[];

  const byBoard: Record<string, BoardItemSummary[]> = {};
  const appointments: BoardItemSummary[] = [];

  for (const row of rows) {
    const item: BoardItemSummary = {
      localId: row.localId,
      boardKey: row.boardKey,
      name: row.name,
      status: row.status,
      nextDate: row.nextDate,
      attorney: row.attorney,
      groupTitle: row.groupTitle,
      columnValues: safeParseJson(row.column_values),
    };

    if (APPOINTMENT_BOARD_KEYS.has(row.boardKey)) {
      appointments.push(item);
    } else {
      const arr = (byBoard[row.boardKey] ??= []);
      arr.push(item);
    }
  }

  return { byBoard, appointments };
}

/**
 * Get a single board item with full detail
 */
export function getBoardItemDetail(
  db: Database,
  localId: string
): BoardItemSummary | null {
  const row = db
    .prepare(`
      SELECT
        local_id AS localId,
        board_key AS boardKey,
        name,
        status,
        next_date AS nextDate,
        attorney,
        group_title AS groupTitle,
        column_values
      FROM board_items
      WHERE local_id = ?
    `)
    .get(localId) as RawBoardItemRow ?? null;

  if (!row) return null;

  return {
    localId: row.localId,
    boardKey: row.boardKey,
    name: row.name,
    status: row.status,
    nextDate: row.nextDate,
    attorney: row.attorney,
    groupTitle: row.groupTitle,
    columnValues: safeParseJson(row.column_values),
  };
}

function safeParseJson(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}
