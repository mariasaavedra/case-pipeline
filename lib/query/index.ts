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
export type {
  ProfileSummary,
  ContractSummary,
  BoardItemSummary,
  ClientCaseSummary,
  ClientUpdate,
  SearchResult,
} from "./types";
export { BOARD_DISPLAY_NAMES, APPOINTMENT_BOARD_KEYS } from "./types";
