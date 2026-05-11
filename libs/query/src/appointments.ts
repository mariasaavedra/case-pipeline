// =============================================================================
// Appointment Queries — Attorney Daily View
// =============================================================================
//
// TODO(monday-write): This module is read-only today. When editing is enabled,
// add functions here for:
//   - updateAppointmentStatus(db, localId, newStatus) → writes to Monday.com API
//   - createAppointmentNote(db, localId, text) → creates update via Monday.com API
//   - rescheduleAppointment(db, localId, newDate) → updates consult_date
// Architecture: local DB write → queue Monday.com API sync → confirm or rollback.
// =============================================================================

import type BetterSqlite3 from "better-sqlite3";
type Database = BetterSqlite3.Database;
import type {
  BoardItemSummary,
  ProfileSummary,
  ClientUpdate,
  ClientCaseSummary,
} from "./types";
import { APPOINTMENT_BOARD_KEYS, CLOSED_CONTRACT_STATUSES } from "./types";
import { batchGetClientCaseSummaries } from "./case-summary";
import { batchGetClientUpdates } from "./updates";

// =============================================================================
// Types
// =============================================================================

export interface AppointmentSnapshot {
  activeCaseCount: number;
  pendingContractCount: number;
  nextDeadline: string | null;
}

export interface AppointmentEntry {
  appointment: BoardItemSummary;
  profile: ProfileSummary | null;
  snapshot: AppointmentSnapshot;
  updates: ClientUpdate[];
  caseSummary: ClientCaseSummary | null;
}

export interface AppointmentsResult {
  entries: AppointmentEntry[];
  attorneys: string[];
}

interface AppointmentOptions {
  attorney?: string;
  date?: string;
  range?: "day" | "week" | "upcoming" | "all";
}

// =============================================================================
// Main Query
// =============================================================================

const BOARD_KEY_LIST = [...APPOINTMENT_BOARD_KEYS];
const BOARD_KEY_PLACEHOLDERS = BOARD_KEY_LIST.map(() => "?").join(",");

/**
 * Get appointments filtered by attorney and date range.
 * Returns enriched entries with client profile, snapshot, updates, and optional full case summary.
 */
export function getAppointments(
  db: Database,
  opts: AppointmentOptions = {},
): AppointmentsResult {
  const today = new Date();
  const dateStr = opts.date ?? formatDate(today);
  const range = opts.range ?? "day";

  // Build date filter clause based on range
  let dateClause: string;
  const dateParams: string[] = [];
  if (range === "all") {
    // No date filter — show everything
    dateClause = "AND bi.next_date IS NOT NULL";
  } else if (range === "upcoming") {
    // Today and forward
    dateClause = "AND bi.next_date >= ?";
    dateParams.push(dateStr);
  } else {
    // day or week — bounded range
    const endDate = range === "week" ? addDays(dateStr, 7) : dateStr;
    dateClause = "AND bi.next_date >= ? AND bi.next_date <= ?";
    dateParams.push(dateStr, endDate);
  }

  // Build query with optional attorney filter
  const hasAttorneyFilter = opts.attorney && opts.attorney !== "all";
  const sql = `
    SELECT
      bi.local_id AS localId,
      bi.board_key AS boardKey,
      bi.name,
      bi.status,
      bi.next_date AS nextDate,
      bi.attorney,
      bi.group_title AS groupTitle,
      bi.column_values,
      bi.profile_local_id AS profileLocalId,
      p.name AS profileName,
      p.email AS profileEmail,
      p.phone AS profilePhone,
      p.priority AS profilePriority,
      p.group_title AS profileGroupTitle,
      p.address AS profileAddress,
      p.date_of_birth AS profileDateOfBirth,
      p.place_of_birth AS profilePlaceOfBirth,
      p.a_number AS profileANumber
    FROM board_items bi
    LEFT JOIN profiles p ON p.local_id = bi.profile_local_id
    WHERE bi.board_key IN (${BOARD_KEY_PLACEHOLDERS})
      ${dateClause}
      ${hasAttorneyFilter ? "AND bi.attorney = ?" : ""}
    ORDER BY bi.next_date ASC, bi.name ASC
  `;

  const params: (string | number)[] = [
    ...BOARD_KEY_LIST,
    ...dateParams,
  ];
  if (hasAttorneyFilter) {
    params.push(opts.attorney!);
  }

  const rows = db.prepare(sql).all(...params) as RawAppointmentRow[];

  // Collect unique profile IDs for batch loading
  const profileIds = [
    ...new Set(rows.map((r) => r.profileLocalId).filter((id): id is string => !!id)),
  ];

  // Batch-prefetch all enrichment data — 9 queries total regardless of row count
  const snapshotMap = batchGetSnapshots(db, profileIds);
  // Fetch with limit 50 (larger budget); case summary reuses this map, appointment
  // entries get the first 20 via the mapping below.
  const updatesMap = batchGetClientUpdates(db, profileIds, 50);
  const profileMap = new Map<string, ProfileSummary>(
    rows
      .filter((r): r is RawAppointmentRow & { profileLocalId: string; profileName: string } =>
        !!r.profileLocalId && !!r.profileName
      )
      .map((r) => [r.profileLocalId, buildProfileSummary(r)])
  );
  const caseSummaryMap = batchGetClientCaseSummaries(db, profileIds, profileMap, updatesMap);

  const defaultSnapshot: AppointmentSnapshot = {
    activeCaseCount: 0,
    pendingContractCount: 0,
    nextDeadline: null,
  };

  const entries: AppointmentEntry[] = rows.map((row) => {
    const profileLocalId = row.profileLocalId;
    return {
      appointment: {
        localId: row.localId,
        boardKey: row.boardKey,
        name: row.name,
        status: row.status,
        nextDate: row.nextDate,
        attorney: row.attorney,
        groupTitle: row.groupTitle,
        columnValues: safeParseJson(row.column_values),
      },
      profile: row.profileName ? buildProfileSummary(row) : null,
      snapshot: profileLocalId
        ? (snapshotMap.get(profileLocalId) ?? defaultSnapshot)
        : defaultSnapshot,
      updates: profileLocalId
        ? (updatesMap.get(profileLocalId) ?? []).slice(0, 20)
        : [],
      caseSummary: profileLocalId ? (caseSummaryMap.get(profileLocalId) ?? null) : null,
    };
  });

  const attorneys = getAttorneyList(db);

  return { entries, attorneys };
}

// =============================================================================
// Attorney List
// =============================================================================

/**
 * Get distinct attorney identifiers from appointment boards.
 */
export function getAttorneyList(db: Database): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT attorney
       FROM board_items
       WHERE board_key IN (${BOARD_KEY_PLACEHOLDERS})
         AND attorney IS NOT NULL
       ORDER BY attorney`,
    )
    .all(...BOARD_KEY_LIST) as { attorney: string }[];

  return rows.map((r) => r.attorney);
}

// =============================================================================
// Batch Snapshot (lightweight counts for appointment cards)
// =============================================================================

function batchGetSnapshots(
  db: Database,
  profileLocalIds: string[],
): Map<string, AppointmentSnapshot> {
  if (profileLocalIds.length === 0) return new Map();

  const todayStr = formatDate(new Date());
  const idPlaceholders = profileLocalIds.map(() => "?").join(",");
  const closedStatuses = [...CLOSED_CONTRACT_STATUSES];
  const closedPlaceholders = closedStatuses.map(() => "?").join(",");

  // Active cases per profile
  const caseRows = db
    .prepare(
      `SELECT profile_local_id, COUNT(*) AS cnt FROM board_items
       WHERE profile_local_id IN (${idPlaceholders})
         AND board_key NOT IN (${BOARD_KEY_PLACEHOLDERS})
       GROUP BY profile_local_id`,
    )
    .all(...profileLocalIds, ...BOARD_KEY_LIST) as { profile_local_id: string; cnt: number }[];

  // Pending contract count per profile
  const contractRows = db
    .prepare(
      `SELECT profile_local_id, COUNT(*) AS cnt FROM contracts
       WHERE profile_local_id IN (${idPlaceholders})
         AND status NOT IN (${closedPlaceholders})
       GROUP BY profile_local_id`,
    )
    .all(...profileLocalIds, ...closedStatuses) as { profile_local_id: string; cnt: number }[];

  // Next deadline per profile
  const deadlineRows = db
    .prepare(
      `SELECT profile_local_id, MIN(next_date) AS nextDeadline FROM board_items
       WHERE profile_local_id IN (${idPlaceholders})
         AND board_key NOT IN (${BOARD_KEY_PLACEHOLDERS})
         AND next_date >= ?
       GROUP BY profile_local_id`,
    )
    .all(...profileLocalIds, ...BOARD_KEY_LIST, todayStr) as {
    profile_local_id: string;
    nextDeadline: string | null;
  }[];

  const caseCounts = new Map(caseRows.map((r) => [r.profile_local_id, r.cnt]));
  const contractCounts = new Map(contractRows.map((r) => [r.profile_local_id, r.cnt]));
  const deadlines = new Map(deadlineRows.map((r) => [r.profile_local_id, r.nextDeadline]));

  return new Map(
    profileLocalIds.map((id) => [
      id,
      {
        activeCaseCount: caseCounts.get(id) ?? 0,
        pendingContractCount: contractCounts.get(id) ?? 0,
        nextDeadline: deadlines.get(id) ?? null,
      },
    ])
  );
}

// =============================================================================
// Profile Builder
// =============================================================================

function buildProfileSummary(row: RawAppointmentRow): ProfileSummary {
  return {
    localId: row.profileLocalId ?? "",
    name: row.profileName!,
    email: row.profileEmail,
    phone: row.profilePhone,
    priority: row.profilePriority,
    groupTitle: row.profileGroupTitle,
    address: row.profileAddress,
    dateOfBirth: row.profileDateOfBirth,
    placeOfBirth: row.profilePlaceOfBirth,
    aNumber: row.profileANumber,
  };
}

// =============================================================================
// Helpers
// =============================================================================

interface RawAppointmentRow {
  localId: string;
  boardKey: string;
  name: string;
  status: string | null;
  nextDate: string | null;
  attorney: string | null;
  groupTitle: string | null;
  column_values: string;
  profileLocalId: string | null;
  profileName: string | null;
  profileEmail: string | null;
  profilePhone: string | null;
  profilePriority: string | null;
  profileGroupTitle: string | null;
  profileAddress: string | null;
  profileDateOfBirth: string | null;
  profilePlaceOfBirth: string | null;
  profileANumber: string | null;
}

function safeParseJson(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return formatDate(d);
}
