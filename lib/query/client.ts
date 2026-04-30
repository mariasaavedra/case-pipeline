// =============================================================================
// Client / Profile Queries
// =============================================================================

import type { Database, SQLQueryBindings } from "bun:sqlite";
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
 * Search clients by name, email, phone, or address.
 *
 * Uses three strategies:
 * 1. Phone-like input (≥4 digits) → LIKE on normalized phone column
 * 2. Email-like input (contains @) → LIKE on email column
 * 3. General text → FTS5 prefix match on name, email, phone, address
 */
export function searchClients(db: Database, query: string): SearchResult[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  // Strategy 1: Phone-like query — partial match on digits
  if (isPhoneLike(trimmed)) {
    const digitsOnly = trimmed.replace(/\D/g, "");
    return db
      .prepare(`
        SELECT local_id AS localId, name, email, phone, address
        FROM profiles
        WHERE REPLACE(REPLACE(REPLACE(REPLACE(phone, '-', ''), ' ', ''), '(', ''), ')', '') LIKE ?
        ORDER BY name
        LIMIT 25
      `)
      .all(`%${digitsOnly}%`) as SearchResult[];
  }

  // Strategy 2: Email-like query — partial match on email
  if (trimmed.includes("@")) {
    return db
      .prepare(`
        SELECT local_id AS localId, name, email, phone, address
        FROM profiles
        WHERE email LIKE ?
        ORDER BY name
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
      SELECT p.local_id AS localId, p.name, p.email, p.phone, p.address
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
  return db
    .prepare(`
      SELECT
        local_id AS localId,
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
      WHERE local_id = ?
    `)
    .get(localId) as ProfileSummary | null;
}

/**
 * List profiles, ordered by name, with pagination
 */
export function listProfiles(db: Database, limit = 50, offset = 0): SearchResult[] {
  return db
    .prepare(`
      SELECT local_id AS localId, name, email, phone, address
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
    .get(name) as ProfileSummary | null;
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
      SELECT p.local_id AS localId, p.name, p.email, p.phone, p.address
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
