// =============================================================================
// Cross-Entity Typed Search
// =============================================================================

import type { Database } from "bun:sqlite";
import type { SearchType, TypedSearchResult } from "./types";

/** Board keys that map to each SearchType */
const SEARCH_TYPE_BOARD_KEYS: Partial<Record<SearchType, string>> = {
  court_cases: "court_cases",
  open_forms: "_cd_open_forms",
  motions: "motions",
  appeals: "appeals",
  foias: "foias",
  litigation: "litigation",
  i918bs: "_lt_i918b_s",
  rfes: "rfes_all",
};

/**
 * Search across contracts or board items by type.
 * For profile search, use searchClients() directly — this handles non-profile types.
 */
export function searchByType(
  db: Database,
  query: string,
  type: SearchType
): TypedSearchResult[] {
  const trimmed = query.trim();
  if (!trimmed || type === "profiles") return [];

  const pattern = `%${trimmed}%`;

  if (type === "contracts") {
    return db
      .prepare(`
        SELECT
          'contracts' AS type,
          c.local_id AS localId,
          c.name,
          c.status,
          p.name AS clientName,
          p.local_id AS clientLocalId,
          NULL AS boardKey,
          c.case_type AS caseType
        FROM contracts c
        LEFT JOIN profiles p ON p.local_id = c.profile_local_id
        WHERE c.name LIKE ?
           OR c.case_type LIKE ?
           OR c.contract_id LIKE ?
           OR c.status LIKE ?
        ORDER BY c.name
        LIMIT 25
      `)
      .all(pattern, pattern, pattern, pattern) as TypedSearchResult[];
  }

  // Board item search — filtered by board_key
  const boardKey = SEARCH_TYPE_BOARD_KEYS[type];
  if (!boardKey) return [];

  return db
    .prepare(`
      SELECT
        ? AS type,
        bi.local_id AS localId,
        bi.name,
        bi.status,
        p.name AS clientName,
        p.local_id AS clientLocalId,
        bi.board_key AS boardKey,
        NULL AS caseType
      FROM board_items bi
      LEFT JOIN profiles p ON p.local_id = bi.profile_local_id
      WHERE bi.board_key = ?
        AND (bi.name LIKE ? OR bi.status LIKE ? OR bi.attorney LIKE ?)
      ORDER BY bi.name
      LIMIT 25
    `)
    .all(type, boardKey, pattern, pattern, pattern) as TypedSearchResult[];
}
