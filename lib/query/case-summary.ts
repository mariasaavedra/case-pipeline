// =============================================================================
// Case Summary — Aggregated 360 View
// =============================================================================

import type { Database } from "bun:sqlite";
import type { ClientCaseSummary } from "./types";
import { getClientProfile } from "./client";
import { getClientContracts } from "./contracts";
import { getClientBoardItems } from "./board-items";

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

  return {
    profile,
    contracts,
    boardItems: byBoard,
    appointments,
  };
}
