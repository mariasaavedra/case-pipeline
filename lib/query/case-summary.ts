// =============================================================================
// Case Summary — Aggregated 360 View
// =============================================================================

import type { Database } from "bun:sqlite";
import type { ClientCaseSummary } from "./types";
import { getClientProfile } from "./client";
import { getClientContracts } from "./contracts";
import { getClientBoardItems } from "./board-items";
import { getClientUpdates } from "./updates";

/**
 * Get IDs of board items that are linked to a court_cases board entry
 * via item_relationships (either as source or target).
 */
function getCourtLinkedItemIds(db: Database, profileLocalId: string): string[] {
  const rows = db
    .query(
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
