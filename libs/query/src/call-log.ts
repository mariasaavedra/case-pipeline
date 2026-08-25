// =============================================================================
// Call Log Queries
// =============================================================================
// Reads board_items rows for board_key='call_log'. See config/boards.yaml for
// the column mapping — "profile" is the board_relation key scripts/sync uses to
// resolve board_items.profile_local_id, so linked calls join straight to
// profiles with no call-log-specific sync code.

import type BetterSqlite3 from "better-sqlite3";
type Database = BetterSqlite3.Database;
import type { CallLogEntry, CallLogFilters, CallLogListResult } from "./types";

interface RawRow {
  localId: string;
  mondayItemId: string | null;
  name: string;
  status: string | null;
  profileLocalId: string | null;
  profileName: string | null;
  columnValues: string;
}

interface CallLogColumnValues {
  phone?: string;
  taken_by?: { label?: string };
  highlighted_for?: { label?: string };
  language?: { label?: string };
  date?: { date?: string };
  hour?: string;
  last_updated?: string;
}

function shapeRow(r: RawRow): CallLogEntry {
  let cv: CallLogColumnValues = {};
  try {
    cv = JSON.parse(r.columnValues) as CallLogColumnValues;
  } catch {
    // leave cv empty
  }
  return {
    localId: r.localId,
    mondayItemId: r.mondayItemId,
    name: r.name,
    status: r.status,
    phone: cv.phone ?? null,
    takenBy: cv.taken_by?.label ?? null,
    highlightedFor: cv.highlighted_for?.label ?? null,
    language: cv.language?.label ?? null,
    date: cv.date?.date ?? null,
    time: cv.hour ?? null,
    profileLocalId: r.profileLocalId,
    profileName: r.profileName,
    lastUpdatedAtSource: cv.last_updated ?? null,
  };
}

/**
 * List call log entries, newest first, with optional filters. Backs the Call
 * Log tab's table and its "unlinked calls" follow-up view.
 */
export function getCallLogEntries(db: Database, filters: CallLogFilters = {}): CallLogListResult {
  const { status, takenBy, dateFrom, dateTo, unlinkedOnly, limit = 50, offset = 0 } = filters;

  // Scoped to Monday group id "topics" (title "Call Log", verified via the
  // Monday API — group_title is all we persist locally, since it uniquely
  // identifies this group among the board's items today). The board's other
  // groups — "Pending Calls" (stale since 2026-06-30), "Voicemail Archive",
  // "Voicemails" — are a different flow, not the front desk's active log.
  const where: string[] = ["bi.board_key = 'call_log'", "bi.group_title = 'Call Log'"];
  const params: (string | number)[] = [];

  if (status) {
    where.push("bi.status = ?");
    params.push(status);
  }
  if (takenBy) {
    where.push("json_extract(bi.column_values, '$.taken_by.label') = ?");
    params.push(takenBy);
  }
  if (dateFrom) {
    where.push("json_extract(bi.column_values, '$.date.date') >= ?");
    params.push(dateFrom);
  }
  if (dateTo) {
    where.push("json_extract(bi.column_values, '$.date.date') <= ?");
    params.push(dateTo);
  }
  if (unlinkedOnly) {
    where.push("(bi.profile_local_id IS NULL OR bi.profile_local_id = '')");
  }

  const whereSql = where.join(" AND ");

  const total = (
    db.prepare(`SELECT COUNT(*) AS cnt FROM board_items bi WHERE ${whereSql}`).get(...params) as { cnt: number }
  ).cnt;

  const rows = db
    .prepare(`
      SELECT
        bi.local_id AS localId,
        bi.monday_item_id AS mondayItemId,
        bi.name AS name,
        bi.status AS status,
        bi.profile_local_id AS profileLocalId,
        p.name AS profileName,
        bi.column_values AS columnValues
      FROM board_items bi
      LEFT JOIN profiles p ON p.local_id = bi.profile_local_id
      WHERE ${whereSql}
      ORDER BY bi.updated_at_source DESC
      LIMIT ? OFFSET ?
    `)
    .all(...params, limit, offset) as RawRow[];

  return { entries: rows.map(shapeRow), total };
}

/** Distinct "Taken by" names seen on the board, for the staff filter dropdown. */
export function getCallLogStaffOptions(db: Database): string[] {
  const rows = db
    .prepare(`
      SELECT DISTINCT json_extract(column_values, '$.taken_by.label') AS name
      FROM board_items
      WHERE board_key = 'call_log' AND group_title = 'Call Log'
        AND json_extract(column_values, '$.taken_by.label') IS NOT NULL
      ORDER BY name
    `)
    .all() as { name: string | null }[];
  return rows.map((r) => r.name).filter((n): n is string => !!n);
}
