// =============================================================================
// Case Summary — Aggregated 360 View
// =============================================================================

import type BetterSqlite3 from "better-sqlite3";
type Database = BetterSqlite3.Database;
import type { ClientCaseSummary, ClientUpdate, ProfileSummary } from "./types";
import { getClientProfile } from "./client";
import { getClientContracts, batchGetClientContracts } from "./contracts";
import { getClientBoardItems, batchGetClientBoardItems } from "./board-items";
import { getClientUpdates } from "./updates";

/**
 * Get IDs of board items that are linked to a court_cases board entry
 * via item_relationships (either as source or target).
 */
function getCourtLinkedItemIds(db: Database, profileLocalId: string): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT bi.local_id
       FROM board_items bi
       JOIN item_relationships ir
         ON (ir.source_local_id = bi.local_id OR ir.target_local_id = bi.local_id)
       WHERE bi.profile_local_id = ?
         AND bi.board_key != 'court_cases'
         AND (
           ir.source_local_id IN (SELECT local_id FROM board_items WHERE board_key = 'court_cases')
           OR ir.target_local_id IN (SELECT local_id FROM board_items WHERE board_key = 'court_cases')
         )`
    )
    .all(profileLocalId) as { local_id: string }[];

  return rows.map((r) => r.local_id);
}

/**
 * Batch-fetch court-linked item IDs for multiple profiles in one query.
 */
function batchGetCourtLinkedItemIds(
  db: Database,
  profileLocalIds: string[]
): Map<string, string[]> {
  if (profileLocalIds.length === 0) return new Map();

  const placeholders = profileLocalIds.map(() => "?").join(",");
  const rows = db
    .prepare(`
      SELECT DISTINCT bi.profile_local_id, bi.local_id
      FROM board_items bi
      JOIN item_relationships ir
        ON (ir.source_local_id = bi.local_id OR ir.target_local_id = bi.local_id)
      WHERE bi.profile_local_id IN (${placeholders})
        AND bi.board_key != 'court_cases'
        AND (
          ir.source_local_id IN (SELECT local_id FROM board_items WHERE board_key = 'court_cases')
          OR ir.target_local_id IN (SELECT local_id FROM board_items WHERE board_key = 'court_cases')
        )
    `)
    .all(...profileLocalIds) as { profile_local_id: string; local_id: string }[];

  const result = new Map<string, string[]>();
  for (const row of rows) {
    let list = result.get(row.profile_local_id);
    if (!list) {
      list = [];
      result.set(row.profile_local_id, list);
    }
    list.push(row.local_id);
  }
  return result;
}

/**
 * Batch-fetch full case summaries for multiple profiles.
 * Accepts a pre-built profileMap (from the caller's main SELECT) to avoid
 * re-fetching profile rows, and a pre-fetched updatesMap to reuse across callers.
 */
export function batchGetClientCaseSummaries(
  db: Database,
  profileLocalIds: string[],
  profileMap: Map<string, ProfileSummary>,
  updatesMap: Map<string, ClientUpdate[]>
): Map<string, ClientCaseSummary> {
  if (profileLocalIds.length === 0) return new Map();

  const contractsMap = batchGetClientContracts(db, profileLocalIds);
  const boardItemsMap = batchGetClientBoardItems(db, profileLocalIds);
  const courtLinkedMap = batchGetCourtLinkedItemIds(db, profileLocalIds);

  const result = new Map<string, ClientCaseSummary>();
  for (const id of profileLocalIds) {
    const profile = profileMap.get(id);
    if (!profile) continue;

    const contracts = contractsMap.get(id) ?? { active: [], closed: [] };
    const { byBoard, appointments } = boardItemsMap.get(id) ?? { byBoard: {}, appointments: [] };
    const updates = updatesMap.get(id) ?? [];
    const courtLinkedItemIds = courtLinkedMap.get(id) ?? [];

    result.set(id, { profile, contracts, boardItems: byBoard, appointments, updates, courtLinkedItemIds });
  }
  return result;
}

/**
 * Get the full 360-degree case summary for a client.
 * Returns null if the profile doesn't exist.
 */
export function getClientCaseSummary(
  db: Database,
  profileLocalId: string
): ClientCaseSummary | null {
  const profile = getClientProfile(db, profileLocalId);
  if (!profile) return null;

  const contracts = getClientContracts(db, profileLocalId);
  const { byBoard, appointments } = getClientBoardItems(db, profileLocalId);
  const updates = getClientUpdates(db, profileLocalId);
  const courtLinkedItemIds = getCourtLinkedItemIds(db, profileLocalId);

  return {
    profile,
    contracts,
    boardItems: byBoard,
    appointments,
    updates,
    courtLinkedItemIds,
  };
}
