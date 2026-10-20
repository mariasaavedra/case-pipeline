// =============================================================================
// Call Log Queries
// =============================================================================
// Reads board_items rows for board_key='call_log'. See config/boards.yaml for
// the column mapping — "profile" is the board_relation key scripts/sync uses to
// resolve board_items.profile_local_id, so linked calls join straight to
// profiles with no call-log-specific sync code.

import type BetterSqlite3 from "better-sqlite3";
type Database = BetterSqlite3.Database;
import type { CallLogEntry, CallLogFilters, CallLogIntakeMatch, CallLogListResult } from "./types";
import { makeStaffNames, spellingsOf, type StaffNames, type StaffResolver } from "./staff-names";
import { isPhoneLike, normalizedPhoneSql } from "./client";

const INTAKE_BOARD_KEY = "_fa_jail_intakes";

/**
 * The jail intake a call's "link to Profiles" column points at, if any. That
 * column accepts Jail Intakes items as well as profiles, and the sync only
 * resolves profiles into profile_local_id — so an intake link survives only as
 * a Monday id in column_values. json_each(NULL) yields no rows, which is what
 * the json_valid guard turns a malformed row into.
 */
function linkedIntakeSql(column: "local_id" | "name" | "1"): string {
  return `
    SELECT ${column === "1" ? "1" : `x.${column}`}
    FROM json_each(CASE WHEN json_valid(bi.column_values)
                        THEN json_extract(bi.column_values, '$.profile.linked_item_ids') END) j
    JOIN board_items x ON x.monday_item_id = j.value AND x.board_key = '${INTAKE_BOARD_KEY}'
    LIMIT 1`;
}

interface RawRow {
  localId: string;
  mondayItemId: string | null;
  name: string;
  status: string | null;
  profileLocalId: string | null;
  profileName: string | null;
  intakeLocalId: string | null;
  intakeName: string | null;
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
    // A profile wins: a call is about the client once one exists.
    jailIntakeLocalId: r.profileLocalId ? null : r.intakeLocalId,
    jailIntakeName: r.profileLocalId ? null : r.intakeName,
    lastUpdatedAtSource: cv.last_updated ?? null,
  };
}

/**
 * List call log entries, newest first, with optional filters. Backs the Call
 * Log tab's table and its "unlinked calls" follow-up view.
 */
/** `resolveStaff`: a "taken by" picked by roster name matches every spelling of that person. */
export function getCallLogEntries(db: Database, filters: CallLogFilters = {}, resolveStaff?: StaffResolver): CallLogListResult {
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
    const spellings = resolveStaff ? spellingsOf(takenBy, rawTakenBy(db), resolveStaff) : [takenBy];
    where.push(`json_extract(bi.column_values, '$.taken_by.label') IN (${spellings.map(() => "?").join(",")})`);
    params.push(...spellings);
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
    // A call linked to a jail intake is linked: the detainee has no profile yet.
    where.push(`(bi.profile_local_id IS NULL OR bi.profile_local_id = '') AND NOT EXISTS (${linkedIntakeSql("1")})`);
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
        (${linkedIntakeSql("local_id")}) AS intakeLocalId,
        (${linkedIntakeSql("name")}) AS intakeName,
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

/** Distinct "Taken by" labels as spelled on the board. */
function rawTakenBy(db: Database): string[] {
  const rows = db
    .prepare(`
      SELECT DISTINCT json_extract(column_values, '$.taken_by.label') AS name
      FROM board_items
      WHERE board_key = 'call_log' AND group_title = 'Call Log'
        AND json_extract(column_values, '$.taken_by.label') IS NOT NULL
    `)
    .all() as { name: string | null }[];
  return rows.map((r) => r.name).filter((n): n is string => !!n);
}

/**
 * "Taken by" names for the staff filter dropdown: one per person when `names`
 * carries the roster (its inactive() then lists who to mark).
 */
export function getCallLogStaffOptions(db: Database, names: StaffNames = makeStaffNames()): string[] {
  return names.list(rawTakenBy(db)).sort((a, b) => a.localeCompare(b));
}

/**
 * Jail intakes whose POC phone matches a caller's number — the Call Log's
 * fallback when no profile has that number. The person calling about a
 * detainee is the intake's point of contact, and the detainee has no profile
 * until they book a consult.
 *
 * An intake that already became a client (its X Appointments link reaches an
 * appointment with a profile) is left out: that call belongs on the profile.
 */
export function searchJailIntakesByPocPhone(db: Database, query: string, limit = 5): CallLogIntakeMatch[] {
  const trimmed = query.trim();
  if (!isPhoneLike(trimmed)) return [];
  const like = `%${trimmed.replace(/\D/g, "")}%`;
  const rows = db
    .prepare(`
      SELECT
        bi.local_id AS localId,
        bi.monday_item_id AS mondayItemId,
        bi.name AS name,
        bi.status AS status,
        json_extract(bi.column_values, '$.poc_name_and_relationship_with_detained') AS pocName,
        json_extract(bi.column_values, '$.poc_phone') AS pocPhone,
        json_extract(bi.column_values, '$.intake_created_on.date') AS intakeCreatedOn
      FROM board_items bi
      WHERE bi.board_key = ?
        AND json_valid(bi.column_values)
        AND ${normalizedPhoneSql("json_extract(bi.column_values, '$.poc_phone')")} LIKE ?
        AND NOT EXISTS (
          SELECT 1
          FROM json_each(json_extract(bi.column_values, '$.x_appointments.linked_item_ids')) j
          JOIN board_items a ON a.monday_item_id = j.value
          WHERE a.profile_local_id IS NOT NULL AND a.profile_local_id != ''
        )
      ORDER BY json_extract(bi.column_values, '$.intake_created_on.date') DESC, bi.id DESC
      LIMIT ?
    `)
    .all(INTAKE_BOARD_KEY, like, limit) as CallLogIntakeMatch[];
  return rows;
}
