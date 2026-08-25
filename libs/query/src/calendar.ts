// =============================================================================
// Calendar Queries — Hearings, Deadlines, Interviews, Appointments
// =============================================================================
// Unifies several very different data shapes into one event list:
//
//   1. The Monday "Calendaring" board (board_key = 'calendaring'). Paralegals
//      escalate a matter onto this board once it needs active tracking; each
//      row is tagged by a `type` column and carries the date in a different
//      column depending on that type (see CALENDARING_CTE below). `next_date`
//      is NOT populated for this board (absent from NEXT_DATE_KEY in
//      scripts/sync/mapper.ts), so the relevant date has to be pulled out of
//      the raw `column_values` JSON per row.
//   2. Boards that already have `next_date` populated (via NEXT_DATE_KEY) but
//      aren't yet escalated to Calendaring — open forms, RFEs, appeals,
//      litigation, motions. These use the same `next_date`/`next_time`
//      columns every other query in this package already reads.
//   3. Appointment boards (consult_date), reusing the same board key set as
//      libs/query/src/appointments.ts.
//
// `court_cases.next_date` (x_next_hearing_date) is deliberately NOT included:
// it is a lookup mirror of the same hearing already captured — with more
// detail — via Calendaring's `hearing_date_calendaring`. Including both would
// double-list every court hearing.
// =============================================================================

import type BetterSqlite3 from "better-sqlite3";
type Database = BetterSqlite3.Database;
import { APPOINTMENT_BOARD_KEYS, BOARD_DISPLAY_NAMES } from "./types";

export type CalendarCategory =
  | "hearing"
  | "court_deadline"
  | "uscis_deadline"
  | "interview"
  | "appointment";

export interface CalendarEvent {
  localId: string;
  boardKey: string;
  category: CalendarCategory;
  /** Human label for a small badge — e.g. "Trial", "RFE", "Bond", "Open Forms". */
  subType: string | null;
  date: string;
  time: string | null;
  status: string | null;
  attorney: string | null;
  clientName: string | null;
  clientLocalId: string | null;
  name: string;
  /** True when this appointment absorbed a duplicate Jail Intake board row (same client, date, and time). */
  jailIntake?: boolean;
  detail: {
    judge: string | null;
    method: string | null;
    location: string | null;
    noticeUrl: string | null;
  };
}

export interface CalendarResult {
  events: CalendarEvent[];
  attorneys: string[];
}

export interface CalendarOptions {
  from: string;
  to: string;
  categories?: CalendarCategory[];
  attorney?: string;
}

// =============================================================================
// Board key → category maps
// =============================================================================

/** Boards with `next_date` already populated, not yet escalated to Calendaring. */
const SUPPLEMENTARY_BOARD_CATEGORY: Record<string, CalendarCategory> = {
  _cd_open_forms: "uscis_deadline",
  rfes_all: "uscis_deadline",
  _lt_i918b_s: "uscis_deadline",
  appeals: "court_deadline",
  litigation: "court_deadline",
  motions: "hearing",
};

const APPOINTMENT_BOARD_KEY_LIST = [...APPOINTMENT_BOARD_KEYS, "_fa_jail_intakes"];

const ALL_CALENDAR_BOARD_KEYS = [
  "calendaring",
  ...Object.keys(SUPPLEMENTARY_BOARD_CATEGORY),
  ...APPOINTMENT_BOARD_KEY_LIST,
];

// =============================================================================
// Attorney normalization
// =============================================================================
// `board_items.attorney` is a mess: the Calendaring board stores single-letter
// initials ("LB", "M", "R", "WH"), other boards store full names, and any
// board can carry a comma-joined multi-attorney value ("Michael
// Sharma-Crawford, Lucy Betteridge") when an item has more than one person
// on the people column. Left raw, the filter dropdown fills up with garbage
// combo entries instead of one option per attorney. "R"'s full name isn't
// consistently recorded anywhere in the data (it shows up as the malformed
// people-column label "Rekha@Sharma- com") so "Rekha" is the closest to a
// canonical display name available.
// =============================================================================

const ATTORNEY_ALIASES: Record<string, string> = {
  LB: "Lucy Betteridge",
  M: "Michael Sharma-Crawford",
  R: "Rekha",
  WH: "William Hanna",
};

/** Non-attorney values that occasionally land in the `attorney` column. */
const EXCLUDED_ATTORNEY_TOKENS = new Set(["CLINIC - NOT CLIENT"]);

function normalizeAttorneyToken(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed in ATTORNEY_ALIASES) return ATTORNEY_ALIASES[trimmed]!;
  if (trimmed.toLowerCase().startsWith("rekha@")) return "Rekha";
  return trimmed;
}

/** Split a possibly comma-joined, possibly abbreviated attorney value into clean display names. */
function splitAttorneyTokens(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => normalizeAttorneyToken(s))
    .filter((s) => s.length > 0 && !EXCLUDED_ATTORNEY_TOKENS.has(s));
}

function normalizeAttorneyDisplay(raw: string | null): string | null {
  const tokens = splitAttorneyTokens(raw);
  return tokens.length > 0 ? tokens.join(", ") : null;
}

/**
 * SQL fragment + params matching any raw `attorney` value that resolves to
 * `canonicalName` — its abbreviation (exact match) or a full-name/combo
 * value containing it (substring match, since combos are comma-joined text).
 */
function attorneyMatchClause(canonicalName: string): { sql: string; params: string[] } {
  const aliases = Object.entries(ATTORNEY_ALIASES)
    .filter(([, full]) => full === canonicalName)
    .map(([abbr]) => abbr);
  const clauses = [...aliases.map(() => "bi.attorney = ?"), "bi.attorney LIKE ?"];
  const params = [...aliases, `%${canonicalName}%`];
  return { sql: `(${clauses.join(" OR ")})`, params };
}

function getCalendarAttorneyList(db: Database): string[] {
  const placeholders = ALL_CALENDAR_BOARD_KEYS.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT DISTINCT attorney FROM board_items WHERE board_key IN (${placeholders}) AND attorney IS NOT NULL`,
    )
    .all(...ALL_CALENDAR_BOARD_KEYS) as { attorney: string }[];

  const names = new Set<string>();
  for (const r of rows) {
    for (const name of splitAttorneyTokens(r.attorney)) names.add(name);
  }
  return [...names].sort();
}

// =============================================================================
// Main Query
// =============================================================================

export function getCalendarEvents(db: Database, opts: CalendarOptions): CalendarResult {
  const wantsCategory = (c: CalendarCategory) => !opts.categories || opts.categories.includes(c);

  const events: CalendarEvent[] = [
    ...getCalendaringEvents(db, opts),
    ...getSupplementaryEvents(db, opts, wantsCategory),
    ...dedupeJailIntakes(getAppointmentEvents(db, opts, wantsCategory)),
  ];

  events.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    const at = a.time ?? "99:99";
    const bt = b.time ?? "99:99";
    return at < bt ? -1 : at > bt ? 1 : 0;
  });

  return { events, attorneys: getCalendarAttorneyList(db) };
}

// =============================================================================
// Jail intake dedup — Jail Intakes ("[FA] Jail Intakes") can create a
// companion item on the assigned attorney's Appointments board for the same
// consult. Both then surface as separate "appointment" events for the same
// real-world slot. Keep the Appointments-board entry (it carries the correct
// attorney board/context) and drop the Jail Intake one, flagging the
// survivor so the UI can show it was originally a jail intake.
// =============================================================================

function dedupeJailIntakes(events: CalendarEvent[]): CalendarEvent[] {
  const jailIntakes = events.filter((e) => e.boardKey === "_fa_jail_intakes");
  if (jailIntakes.length === 0) return events;

  const matchedJailIntakeIds = new Set<string>();
  const others = events.filter((e) => e.boardKey !== "_fa_jail_intakes");

  for (const appt of others) {
    const match = jailIntakes.find(
      (ji) =>
        !matchedJailIntakeIds.has(ji.localId) &&
        ji.date === appt.date &&
        ji.time === appt.time &&
        (appt.name === ji.name || appt.name.startsWith(`${ji.name} (`)),
    );
    if (match) {
      matchedJailIntakeIds.add(match.localId);
      appt.jailIntake = true;
    }
  }

  const remainingJailIntakes = jailIntakes.filter((ji) => !matchedJailIntakeIds.has(ji.localId));
  return [...others, ...remainingJailIntakes];
}

// =============================================================================
// Group 1 — Calendaring board (type-driven categorization)
// =============================================================================

interface CalendaringRow {
  localId: string;
  boardKey: string;
  name: string;
  status: string | null;
  attorney: string | null;
  profileLocalId: string | null;
  category: CalendarCategory | null;
  eventDate: string | null;
  eventTime: string | null;
  typeLabel: string | null;
  noticeTypeLabelsJson: string | null;
  judge: string | null;
  method: string | null;
  location: string | null;
  noticeUrl: string | null;
  clientName: string | null;
  clientLocalId: string | null;
}

function getCalendaringEvents(db: Database, opts: CalendarOptions): CalendarEvent[] {
  if (opts.categories && !opts.categories.some((c) => c !== "appointment")) return [];

  const attorneyMatch = opts.attorney ? attorneyMatchClause(opts.attorney) : null;
  const attorneyClause = attorneyMatch ? `AND ${attorneyMatch.sql}` : "";

  const rows = db
    .prepare(
      `
      WITH categorized AS (
        SELECT
          bi.local_id AS localId,
          bi.board_key AS boardKey,
          bi.name,
          bi.status,
          bi.attorney,
          bi.profile_local_id AS profileLocalId,
          json_extract(bi.column_values, '$.type.label') AS typeLabel,
          json_extract(bi.column_values, '$.uscis_notice_type.labels') AS noticeTypeLabelsJson,
          json_extract(bi.column_values, '$.judge_calendaring') AS judge,
          json_extract(bi.column_values, '$.method') AS method,
          json_extract(bi.column_values, '$.interview_location.labels[0]') AS location,
          json_extract(bi.column_values, '$.notice') AS noticeUrl,
          p.name AS clientName,
          p.local_id AS clientLocalId,
          CASE
            WHEN json_extract(bi.column_values, '$.uscis_notice_type.labels') LIKE '%INTERVIEW%'
              THEN 'interview'
            WHEN json_extract(bi.column_values, '$.type.label') IN ('Master', 'Trial', 'Bond', 'Detained')
              THEN 'hearing'
            WHEN json_extract(bi.column_values, '$.type.label') = 'Court Deadline'
              THEN 'court_deadline'
            WHEN json_extract(bi.column_values, '$.type.label') IN ('USCIS', 'USCIS Deadline')
              THEN 'uscis_deadline'
            WHEN json_extract(bi.column_values, '$.type.label') IS NULL
              AND COALESCE(
                json_extract(bi.column_values, '$.master_fees_due_on_calendaring.date'),
                json_extract(bi.column_values, '$.trial_fees_due_on_calendaring.date'),
                json_extract(bi.column_values, '$.tp_fees_due_on_calendaring.date')
              ) IS NOT NULL
              THEN 'court_deadline'
            ELSE NULL
          END AS category,
          CASE
            WHEN json_extract(bi.column_values, '$.uscis_notice_type.labels') LIKE '%INTERVIEW%'
              THEN json_extract(bi.column_values, '$.interview_date.date')
            WHEN json_extract(bi.column_values, '$.type.label') IN ('Master', 'Trial', 'Bond', 'Detained')
              THEN json_extract(bi.column_values, '$.hearing_date_calendaring.date')
            WHEN json_extract(bi.column_values, '$.type.label') = 'Court Deadline'
              THEN json_extract(bi.column_values, '$.due_date.date')
            WHEN json_extract(bi.column_values, '$.type.label') IN ('USCIS', 'USCIS Deadline')
              THEN json_extract(bi.column_values, '$.due_date_uscis.date')
            ELSE COALESCE(
              json_extract(bi.column_values, '$.master_fees_due_on_calendaring.date'),
              json_extract(bi.column_values, '$.trial_fees_due_on_calendaring.date'),
              json_extract(bi.column_values, '$.tp_fees_due_on_calendaring.date')
            )
          END AS eventDate,
          CASE
            WHEN json_extract(bi.column_values, '$.uscis_notice_type.labels') LIKE '%INTERVIEW%'
              THEN json_extract(bi.column_values, '$.interview_date.time')
            WHEN json_extract(bi.column_values, '$.type.label') IN ('Master', 'Trial', 'Bond', 'Detained')
              THEN json_extract(bi.column_values, '$.hearing_date_calendaring.time')
            ELSE NULL
          END AS eventTime
        FROM board_items bi
        LEFT JOIN profiles p ON p.local_id = bi.profile_local_id
        WHERE bi.board_key = 'calendaring'
          ${attorneyClause}
      )
      SELECT * FROM categorized
      WHERE category IS NOT NULL
        AND eventDate IS NOT NULL
        AND eventDate >= ? AND eventDate <= ?
    `,
    )
    .all(...(attorneyMatch ? attorneyMatch.params : []), opts.from, opts.to) as CalendaringRow[];

  return rows
    .filter((r) => !opts.categories || opts.categories.includes(r.category!))
    .map((r) => ({
      localId: r.localId,
      boardKey: r.boardKey,
      category: r.category!,
      subType: subTypeForCalendaring(r),
      date: r.eventDate!,
      time: r.eventTime,
      status: r.status,
      attorney: normalizeAttorneyDisplay(r.attorney),
      clientName: r.clientName,
      clientLocalId: r.clientLocalId,
      name: r.name,
      detail: {
        judge: r.judge,
        method: r.method,
        location: r.location,
        noticeUrl: r.noticeUrl,
      },
    }));
}

function subTypeForCalendaring(r: CalendaringRow): string | null {
  // The notice type (RFE, NOID, USCIS DENIAL, INTERVIEW, ...) is more useful on a
  // badge than the generic "USCIS"/"USCIS Deadline" type label, so prefer it.
  if (r.noticeTypeLabelsJson) {
    try {
      const labels = JSON.parse(r.noticeTypeLabelsJson) as string[];
      if (labels.length > 0) return titleCase(labels[0]!);
    } catch {
      // fall through to type label
    }
  }
  return r.typeLabel ? titleCase(r.typeLabel) : null;
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(" ")
    .map((w) => (w.length > 0 ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

// =============================================================================
// Group 2 — Supplementary next_date boards
// =============================================================================

interface SupplementaryRow {
  localId: string;
  boardKey: string;
  name: string;
  status: string | null;
  attorney: string | null;
  eventDate: string;
  eventTime: string | null;
  clientName: string | null;
  clientLocalId: string | null;
}

function getSupplementaryEvents(
  db: Database,
  opts: CalendarOptions,
  wantsCategory: (c: CalendarCategory) => boolean,
): CalendarEvent[] {
  const boardKeys = Object.entries(SUPPLEMENTARY_BOARD_CATEGORY)
    .filter(([, category]) => wantsCategory(category))
    .map(([key]) => key);
  if (boardKeys.length === 0) return [];

  const boardPlaceholders = boardKeys.map(() => "?").join(",");
  const attorneyMatch = opts.attorney ? attorneyMatchClause(opts.attorney) : null;
  const attorneyClause = attorneyMatch ? `AND ${attorneyMatch.sql}` : "";
  const params: (string | number)[] = [...boardKeys, opts.from, opts.to];
  if (attorneyMatch) params.push(...attorneyMatch.params);

  const rows = db
    .prepare(
      `
      SELECT
        bi.local_id AS localId,
        bi.board_key AS boardKey,
        bi.name,
        bi.status,
        bi.attorney,
        bi.next_date AS eventDate,
        bi.next_time AS eventTime,
        p.name AS clientName,
        p.local_id AS clientLocalId
      FROM board_items bi
      LEFT JOIN profiles p ON p.local_id = bi.profile_local_id
      WHERE bi.board_key IN (${boardPlaceholders})
        AND bi.next_date >= ? AND bi.next_date <= ?
        ${attorneyClause}
    `,
    )
    .all(...params) as SupplementaryRow[];

  return rows.map((r) => ({
    localId: r.localId,
    boardKey: r.boardKey,
    category: SUPPLEMENTARY_BOARD_CATEGORY[r.boardKey]!,
    subType: BOARD_DISPLAY_NAMES[r.boardKey] ?? r.boardKey,
    date: r.eventDate,
    time: r.eventTime,
    status: r.status,
    attorney: normalizeAttorneyDisplay(r.attorney),
    clientName: r.clientName,
    clientLocalId: r.clientLocalId,
    name: r.name,
    detail: { judge: null, method: null, location: null, noticeUrl: null },
  }));
}

// =============================================================================
// Group 3 — Appointments
// =============================================================================

function getAppointmentEvents(
  db: Database,
  opts: CalendarOptions,
  wantsCategory: (c: CalendarCategory) => boolean,
): CalendarEvent[] {
  if (!wantsCategory("appointment")) return [];

  const boardPlaceholders = APPOINTMENT_BOARD_KEY_LIST.map(() => "?").join(",");
  const attorneyClause = opts.attorney ? "AND bi.attorney = ?" : "";
  const params: (string | number)[] = [...APPOINTMENT_BOARD_KEY_LIST, opts.from, opts.to];
  if (opts.attorney) params.push(opts.attorney);

  const rows = db
    .prepare(
      `
      SELECT
        bi.local_id AS localId,
        bi.board_key AS boardKey,
        bi.name,
        bi.status,
        bi.attorney,
        bi.next_date AS eventDate,
        bi.next_time AS eventTime,
        p.name AS clientName,
        p.local_id AS clientLocalId
      FROM board_items bi
      LEFT JOIN profiles p ON p.local_id = bi.profile_local_id
      WHERE bi.board_key IN (${boardPlaceholders})
        AND bi.next_date >= ? AND bi.next_date <= ?
        ${attorneyClause}
    `,
    )
    .all(...params) as SupplementaryRow[];

  return rows.map((r) => ({
    localId: r.localId,
    boardKey: r.boardKey,
    category: "appointment" as const,
    subType: BOARD_DISPLAY_NAMES[r.boardKey] ?? r.boardKey,
    date: r.eventDate,
    time: r.eventTime,
    status: r.status,
    attorney: r.attorney,
    clientName: r.clientName,
    clientLocalId: r.clientLocalId,
    name: r.name,
    detail: { judge: null, method: null, location: null, noticeUrl: null },
  }));
}
