// =============================================================================
// Client / Profile Queries
// =============================================================================

import type BetterSqlite3 from "better-sqlite3";
type Database = BetterSqlite3.Database;

type SQLQueryBindings = string | number | bigint | Buffer | null;
import type { ProfileSummary, SearchResult } from "./types";

/** FTS5 reserved words that must not appear as bare tokens in MATCH queries */
const FTS5_RESERVED = new Set(["AND", "OR", "NOT", "NEAR"]);

/**
 * Detect if the input looks like a phone number (mostly digits, ≥4 digits).
 */
function isPhoneLike(input: string): boolean {
  const digitsOnly = input.replace(/\D/g, "");
  if (digitsOnly.length < 4) return false;
  const nonSpace = input.replace(/\s/g, "");
  return digitsOnly.length / nonSpace.length > 0.5;
}

/**
 * SQL that strips the punctuation real phone numbers are written with, so a
 * caller ID's bare digits match a number stored as "+1 (816) 605-2200".
 *
 * Letters are deliberately left in — SQLite has no regex, and the numbers on
 * this board routinely carry a name ("Mac (817) 470-7700"). Leaving them alone
 * is harmless: the digits stay contiguous, so a digits-only LIKE still hits.
 */
function normalizedPhoneSql(expr: string): string {
  return `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(${expr}, '-', ''), ' ', ''), '(', ''), ')', ''), '+', ''), '.', '')`;
}

/**
 * The profile's second number. It has no column of its own — the sync writes
 * every Monday column into raw_column_values keyed by its config key, and
 * "Phone 2" on the Profiles board is `phone_2` there.
 */
const PHONE_2_SQL = "json_extract(p.raw_column_values, '$.phone_2')";

/** The SELECT list every strategy returns, so all three shapes match SearchResult. */
const SELECT_COLS = `p.local_id AS localId, p.name, p.email, p.phone, ${PHONE_2_SQL} AS phone2, p.address`;

/**
 * Search clients by name, email, phone, or address.
 *
 * Uses three strategies:
 * 1. Phone-like input (≥4 digits) → LIKE on the normalized phone AND phone 2
 * 2. Email-like input (contains @) → LIKE on email column
 * 3. General text → FTS5 prefix match on name, email, phone, address
 *
 * Strategy 1 covers BOTH numbers on purpose: a client calling from their second
 * number is still that client, and linking a call must not be limited to
 * whichever number happens to sit in the primary column.
 */
export function searchClients(db: Database, query: string): SearchResult[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  // Strategy 1: Phone-like query — partial match on digits, either number
  if (isPhoneLike(trimmed)) {
    const digitsOnly = trimmed.replace(/\D/g, "");
    const like = `%${digitsOnly}%`;
    return db
      .prepare(`
        SELECT ${SELECT_COLS}
        FROM profiles p
        WHERE ${normalizedPhoneSql("p.phone")} LIKE ?
           OR ${normalizedPhoneSql(PHONE_2_SQL)} LIKE ?
        ORDER BY p.name
        LIMIT 25
      `)
      .all(like, like) as SearchResult[];
  }

  // Strategy 2: Email-like query — partial match on email
  if (trimmed.includes("@")) {
    return db
      .prepare(`
        SELECT ${SELECT_COLS}
        FROM profiles p
        WHERE p.email LIKE ?
        ORDER BY p.name
        LIMIT 25
      `)
      .all(`%${trimmed}%`) as SearchResult[];
  }

  // Strategy 3: General FTS5 search (name, email, phone, address)
  const stripped = trimmed.replace(/[^\p{L}\p{N}\s]/gu, "").trim();
  if (!stripped) return [];

  const tokens = stripped.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  const ftsQuery = tokens
    .map((t) => (FTS5_RESERVED.has(t.toUpperCase()) ? `"${t}"` : t))
    .join(" ");

  return db
    .prepare(`
      SELECT ${SELECT_COLS}
      FROM profiles_fts fts
      JOIN profiles p ON p.id = fts.rowid
      WHERE profiles_fts MATCH ?
      ORDER BY rank
      LIMIT 25
    `)
    .all(`${ftsQuery}*`) as SearchResult[];
}

/**
 * Get a single profile by local_id
 */
export function getClientProfile(db: Database, localId: string): ProfileSummary | null {
  const row = db
    .prepare(`
      SELECT
        local_id AS localId,
        monday_item_id AS mondayItemId,
        name,
        email,
        phone,
        priority,
        group_title AS groupTitle,
        address,
        date_of_birth AS dateOfBirth,
        place_of_birth AS placeOfBirth,
        a_number AS aNumber,
        raw_column_values AS rawColumnValues
      FROM profiles
      WHERE local_id = ?
    `)
    .get(localId) as (ProfileSummary & { rawColumnValues: string | null }) | undefined;

  if (!row) return null;

  const { rawColumnValues, ...profile } = row;
  return { ...profile, ...readSharePointLinks(rawColumnValues) };
}

/**
 * Pull the SharePoint e_file / consult folder links out of a profile's raw
 * Monday column values. Shared so getClientProfile and the appointments query
 * populate them the same way.
 */
export function readSharePointLinks(rawColumnValues: string | null | undefined): {
  eFile: string | null;
  consultFile: string | null;
} {
  const cvs = safeParseJson(rawColumnValues);
  return { eFile: asNonEmptyString(cvs.e_file), consultFile: asNonEmptyString(cvs.consult) };
}

function safeParseJson(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/**
 * List profiles, ordered by name, with pagination
 */
export function listProfiles(db: Database, limit = 50, offset = 0): SearchResult[] {
  return db
    .prepare(`
      SELECT local_id AS localId, name, email, phone,
             json_extract(raw_column_values, '$.phone_2') AS phone2, address
      FROM profiles
      ORDER BY name
      LIMIT ? OFFSET ?
    `)
    .all(limit, offset) as SearchResult[];
}

/**
 * Get a profile by name (exact match)
 */
export function getClientByName(db: Database, name: string): ProfileSummary | null {
  return db
    .prepare(`
      SELECT
        local_id AS localId,
        monday_item_id AS mondayItemId,
        name,
        email,
        phone,
        priority,
        group_title AS groupTitle,
        address,
        date_of_birth AS dateOfBirth,
        place_of_birth AS placeOfBirth,
        a_number AS aNumber
      FROM profiles
      WHERE name = ?
    `)
    .get(name) as ProfileSummary ?? null;
}

// =============================================================================
// Filtered Profile Listing
// =============================================================================

export interface ProfileFilterOptions {
  limit?: number;
  offset?: number;
  status?: string;
  priority?: string;
  attorney?: string;
  boardType?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface FilteredProfileResult {
  profiles: SearchResult[];
  total: number;
}

/** Virtual status filters used by KPI click-through */
const PENDING_CONTRACT_STATUSES = [
  "Completed", "Cancelled", "Refunded", "Withdrawn",
  "Paid Needs Action", "E-File opened", "Create Project",
];
const PAID_CONTRACT_STATUSES = [
  "Paid Needs Action", "E-File opened", "Create Project",
];

/**
 * List profiles with cross-table filters.
 * Supports filtering by priority, contract status, attorney, board type, date range.
 */
export function listProfilesFiltered(
  db: Database,
  opts: ProfileFilterOptions = {}
): FilteredProfileResult {
  const { limit = 50, offset = 0 } = opts;
  const conditions: string[] = [];
  const params: SQLQueryBindings[] = [];

  // Direct profile filter
  if (opts.priority) {
    conditions.push("p.priority = ?");
    params.push(opts.priority);
  }

  // Contract status filters (virtual statuses for KPI click-through)
  if (opts.status === "pending_contracts") {
    const placeholders = PENDING_CONTRACT_STATUSES.map(() => "?").join(", ");
    conditions.push(`EXISTS (
      SELECT 1 FROM contracts c
      WHERE c.profile_local_id = p.local_id
      AND c.status NOT IN (${placeholders})
    )`);
    params.push(...PENDING_CONTRACT_STATUSES);
  } else if (opts.status === "paid_fee_ks") {
    const placeholders = PAID_CONTRACT_STATUSES.map(() => "?").join(", ");
    conditions.push(`EXISTS (
      SELECT 1 FROM contracts c
      WHERE c.profile_local_id = p.local_id
      AND c.status IN (${placeholders})
    )`);
    params.push(...PAID_CONTRACT_STATUSES);
  } else if (opts.status) {
    conditions.push(`EXISTS (
      SELECT 1 FROM contracts c
      WHERE c.profile_local_id = p.local_id
      AND c.status = ?
    )`);
    params.push(opts.status);
  }

  // Attorney filter (on board items)
  if (opts.attorney) {
    conditions.push(`EXISTS (
      SELECT 1 FROM board_items bi
      WHERE bi.profile_local_id = p.local_id
      AND bi.attorney = ?
    )`);
    params.push(opts.attorney);
  }

  // Board type filter
  if (opts.boardType) {
    conditions.push(`EXISTS (
      SELECT 1 FROM board_items bi
      WHERE bi.profile_local_id = p.local_id
      AND bi.board_key = ?
    )`);
    params.push(opts.boardType);
  }

  // Date range filter (on board items next_date)
  if (opts.dateFrom) {
    conditions.push(`EXISTS (
      SELECT 1 FROM board_items bi
      WHERE bi.profile_local_id = p.local_id
      AND bi.next_date >= ?
    )`);
    params.push(opts.dateFrom);
  }
  if (opts.dateTo) {
    conditions.push(`EXISTS (
      SELECT 1 FROM board_items bi
      WHERE bi.profile_local_id = p.local_id
      AND bi.next_date <= ?
    )`);
    params.push(opts.dateTo);
  }

  const whereClause = conditions.length > 0
    ? `WHERE ${conditions.join(" AND ")}`
    : "";

  const countRow = db
    .prepare(`SELECT COUNT(*) AS total FROM profiles p ${whereClause}`)
    .get(...params) as { total: number };

  const profiles = db
    .prepare(`
      SELECT ${SELECT_COLS}
      FROM profiles p
      ${whereClause}
      ORDER BY p.name
      LIMIT ? OFFSET ?
    `)
    .all(...params, limit, offset) as SearchResult[];

  return { profiles, total: countRow.total };
}

// =============================================================================
// Filter Options (for populating dropdowns)
// =============================================================================

export interface FilterOptions {
  priorities: string[];
  statuses: string[];
  attorneys: string[];
  boardTypes: { key: string; label: string }[];
}

/**
 * Get distinct filter values for populating filter dropdowns.
 */
export function getFilterOptions(db: Database): FilterOptions {
  const priorities = (
    db.prepare("SELECT DISTINCT priority FROM profiles WHERE priority IS NOT NULL ORDER BY priority").all() as { priority: string }[]
  ).map((r) => r.priority);

  const statuses = (
    db.prepare("SELECT DISTINCT status FROM contracts WHERE status IS NOT NULL ORDER BY status").all() as { status: string }[]
  ).map((r) => r.status);

  const attorneys = (
    db.prepare("SELECT DISTINCT attorney FROM board_items WHERE attorney IS NOT NULL AND attorney != '' ORDER BY attorney").all() as { attorney: string }[]
  ).map((r) => r.attorney);

  const boardTypes = (
    db.prepare("SELECT DISTINCT board_key FROM board_items ORDER BY board_key").all() as { board_key: string }[]
  ).map((r) => ({
    key: r.board_key,
    label: r.board_key, // Will be mapped to display name on the client side
  }));

  return { priorities, statuses, attorneys, boardTypes };
}
