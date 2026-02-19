// =============================================================================
// Client / Profile Queries
// =============================================================================

import type { Database } from "bun:sqlite";
import type { ProfileSummary, SearchResult } from "./types";

/** FTS5 reserved words that must not appear as bare tokens in MATCH queries */
const FTS5_RESERVED = new Set(["AND", "OR", "NOT", "NEAR"]);

/**
 * Search clients by name, email, or phone using FTS5
 */
export function searchClients(db: Database, query: string): SearchResult[] {
  // Strip non-letter, non-number, non-whitespace (Unicode-aware)
  const stripped = query.replace(/[^\p{L}\p{N}\s]/gu, "").trim();
  if (!stripped) return [];

  // Quote each token so FTS5 reserved words (AND/OR/NOT/NEAR) are treated as literals
  const tokens = stripped.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  const ftsQuery = tokens
    .map((t) => (FTS5_RESERVED.has(t.toUpperCase()) ? `"${t}"` : t))
    .join(" ");

  return db
    .prepare(`
      SELECT p.local_id AS localId, p.name, p.email, p.phone
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
        address
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
      SELECT local_id AS localId, name, email, phone
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
        address
      FROM profiles
      WHERE name = ?
    `)
    .get(name) as ProfileSummary | null;
}
