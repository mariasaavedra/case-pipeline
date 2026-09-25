// =============================================================================
// Jail Intake Queries
// =============================================================================
// Reads board_items rows for board_key='_fa_jail_intakes'. See config/boards.yaml
// for the column mapping.
//
// Intakes are PRE-PROFILE by design. A detained person's contact becomes a lead
// here first; they become a client only when they book a consult, at which point
// a profile is created and the intake's "X Appointments" column links to that
// appointment. So `board_items.profile_local_id` is empty for every intake (901
// of 901 on production) and that is correct, not a gap — the board's own
// "Profiles" column is a MIRROR reflecting through the appointment, which is why
// nothing resolves it locally.
//
// Following x_appointments to the appointment, and the appointment to its
// profile, is therefore the only way to tell a live lead from a converted one.
// =============================================================================

import type BetterSqlite3 from "better-sqlite3";
type Database = BetterSqlite3.Database;
import type { JailIntake, JailIntakeFilters, JailIntakeListResult } from "./types";

const BOARD_KEY = "_fa_jail_intakes";

/**
 * Statuses that mean the lead is no longer waiting on us.
 *
 * "Scheduled" has already converted and "Not Proceeding" is dead; both are
 * excluded by default so the board is a list of people who still need
 * something. The Scheduled GROUP is excluded alongside the status because the
 * two disagree on ~30 rows, and a row that is scheduled by either measure is
 * not triage work.
 */
const CLOSED_STATUSES = ["Not Proceeding", "Scheduled"];
const CLOSED_GROUP = "Scheduled";

interface RawRow {
  localId: string;
  mondayItemId: string | null;
  name: string;
  status: string | null;
  groupTitle: string | null;
  columnValues: string;
}

interface IntakeColumnValues {
  jail?: string;
  alien_number?: string;
  language?: { label?: string };
  poc_name_and_relationship_with_detained?: string;
  poc_phone?: string;
  intake_created_on?: { date?: string };
  last_interaction_date?: { date?: string };
  x_appointments?: { linked_item_ids?: string[] };
}

function parseColumns(json: string): IntakeColumnValues {
  try {
    return JSON.parse(json) as IntakeColumnValues;
  } catch {
    return {};
  }
}

/** YYYY-MM-DD, `days` before today in the given zone. */
export function cutoffDate(days: number, today: string): string {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * List jail intakes, newest first.
 *
 * The default is deliberately narrow — recent, still-open leads — because the
 * live funnel is ~292 rows and only a handful arrive in any given week. The
 * result carries `olderCount` so the rest is visible as a number rather than
 * silently filtered away.
 */
export function getJailIntakes(
  db: Database,
  filters: JailIntakeFilters = {},
  today: string = new Date().toISOString().slice(0, 10),
): JailIntakeListResult {
  const { withinDays, includeClosed = false, status, search, limit = 100, offset = 0 } = filters;

  const where: string[] = ["bi.board_key = ?"];
  const params: (string | number)[] = [BOARD_KEY];

  if (!includeClosed) {
    where.push(`(bi.status IS NULL OR bi.status NOT IN (${CLOSED_STATUSES.map(() => "?").join(", ")}))`);
    params.push(...CLOSED_STATUSES);
    where.push("(bi.group_title IS NULL OR bi.group_title != ?)");
    params.push(CLOSED_GROUP);
  }
  if (status) {
    where.push("bi.status = ?");
    params.push(status);
  }
  if (search) {
    // json_valid guards every json_extract in this file: SQLite THROWS on
    // malformed JSON rather than returning null, so one unparseable row would
    // take down the whole page. The JS-side parse is already defensive; the SQL
    // has to be too.
    where.push("(bi.name LIKE ? OR (json_valid(bi.column_values) AND json_extract(bi.column_values, '$.jail') LIKE ?))");
    params.push(`%${search}%`, `%${search}%`);
  }

  // The open set before any date limit — what `olderCount` is measured against.
  const openWhere = where.join(" AND ");
  const openTotal = (
    db.prepare(`SELECT COUNT(*) AS cnt FROM board_items bi WHERE ${openWhere}`).get(...params) as { cnt: number }
  ).cnt;

  const dated = [...where];
  const datedParams = [...params];
  if (withinDays != null) {
    dated.push("(json_valid(bi.column_values) AND json_extract(bi.column_values, '$.intake_created_on.date') >= ?)");
    datedParams.push(cutoffDate(withinDays, today));
  }
  const whereSql = dated.join(" AND ");

  const total = (
    db.prepare(`SELECT COUNT(*) AS cnt FROM board_items bi WHERE ${whereSql}`).get(...datedParams) as { cnt: number }
  ).cnt;

  const rows = db
    .prepare(`
      SELECT
        bi.local_id AS localId,
        bi.monday_item_id AS mondayItemId,
        bi.name AS name,
        bi.status AS status,
        bi.group_title AS groupTitle,
        bi.column_values AS columnValues
      FROM board_items bi
      WHERE ${whereSql}
      ORDER BY CASE WHEN json_valid(bi.column_values)
                    THEN json_extract(bi.column_values, '$.intake_created_on.date') END DESC,
               bi.id DESC
      LIMIT ? OFFSET ?
    `)
    .all(...datedParams, limit, offset) as RawRow[];

  // Resolve conversions in one pass rather than per row: an intake links to an
  // appointment by Monday item id, and the appointment is the only thing that
  // knows the profile.
  const apptIds = new Set<string>();
  const parsed = rows.map((r) => {
    const cv = parseColumns(r.columnValues);
    for (const id of cv.x_appointments?.linked_item_ids ?? []) apptIds.add(id);
    return { row: r, cv };
  });

  const apptById = new Map<string, {
    localId: string; name: string; nextDate: string | null;
    profileLocalId: string | null; profileName: string | null;
  }>();
  if (apptIds.size > 0) {
    const placeholders = [...apptIds].map(() => "?").join(", ");
    const appts = db
      .prepare(`
        SELECT bi.monday_item_id AS mondayItemId, bi.local_id AS localId, bi.name AS name,
               bi.next_date AS nextDate, bi.profile_local_id AS profileLocalId, p.name AS profileName
        FROM board_items bi
        LEFT JOIN profiles p ON p.local_id = bi.profile_local_id
        WHERE bi.monday_item_id IN (${placeholders})
      `)
      .all(...apptIds) as Array<{
        mondayItemId: string; localId: string; name: string;
        nextDate: string | null; profileLocalId: string | null; profileName: string | null;
      }>;
    for (const a of appts) {
      apptById.set(a.mondayItemId, {
        localId: a.localId, name: a.name, nextDate: a.nextDate,
        profileLocalId: a.profileLocalId || null, profileName: a.profileName ?? null,
      });
    }
  }

  const intakes: JailIntake[] = parsed.map(({ row, cv }) => {
    const linked = (cv.x_appointments?.linked_item_ids ?? [])
      .map((id) => apptById.get(id))
      .find((a) => a != null);
    return {
      localId: row.localId,
      mondayItemId: row.mondayItemId,
      name: row.name,
      status: row.status,
      groupTitle: row.groupTitle,
      jail: cv.jail ?? null,
      alienNumber: cv.alien_number ?? null,
      language: cv.language?.label ?? null,
      pocName: cv.poc_name_and_relationship_with_detained ?? null,
      pocPhone: cv.poc_phone ?? null,
      intakeCreatedOn: cv.intake_created_on?.date ?? null,
      lastInteractionDate: cv.last_interaction_date?.date ?? null,
      convertedTo: linked
        ? {
            appointmentLocalId: linked.localId,
            appointmentName: linked.name,
            consultDate: linked.nextDate,
            profileLocalId: linked.profileLocalId,
            profileName: linked.profileName,
          }
        : null,
    };
  });

  const statusOptions = (
    db
      .prepare(`SELECT DISTINCT status FROM board_items WHERE board_key = ? AND status IS NOT NULL ORDER BY status`)
      .all(BOARD_KEY) as Array<{ status: string }>
  ).map((r) => r.status);

  return { intakes, total, olderCount: Math.max(0, openTotal - total), statusOptions };
}
