// =============================================================================
// Query Layer — Public API
// =============================================================================

export { searchClients, getClientProfile, getClientByName, listProfiles } from "./client";
export { getClientContracts } from "./contracts";
export { getClientBoardItems, getBoardItemDetail } from "./board-items";
export { getClientCaseSummary } from "./case-summary";
export { getClientUpdates } from "./updates";
export { getClientRelationships } from "./relationships";
export type { RelationshipWithDetails } from "./relationships";
export { getDashboardKpis } from "./dashboard";
export type {
  ProfileSummary,
  ContractSummary,
  BoardItemSummary,
  ClientCaseSummary,
  ClientUpdate,
  SearchResult,
  KpiCard,
  KpiItem,
} from "./types";
export { BOARD_DISPLAY_NAMES, APPOINTMENT_BOARD_KEYS, PAID_CONTRACT_STATUSES } from "./types";
