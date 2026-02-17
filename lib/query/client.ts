// =============================================================================
// Client / Profile Queries
// =============================================================================

import type { Database } from "bun:sqlite";
import type { ProfileSummary, SearchResult } from "./types";

/**
 * Search clients by name, email, or phone using FTS5
 */
export function searchClients(db: Database, query: string): SearchResult[] {
  // Append * for prefix matching (e.g. "gar" matches "Garcia")
  const ftsQuery = query.replace(/[^\w\s]/g, "").trim();
  if (!ftsQuery) return [];

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
