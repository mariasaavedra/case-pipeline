// =============================================================================
// Query Layer — Public API
// =============================================================================

export { searchClients, getClientProfile, getClientByName } from "./client";
export { getClientContracts } from "./contracts";
export { getClientBoardItems, getBoardItemDetail } from "./board-items";
export { getClientCaseSummary } from "./case-summary";
export type {
  ProfileSummary,
  ContractSummary,
  BoardItemSummary,
  ClientCaseSummary,
  SearchResult,
} from "./types";
export { BOARD_DISPLAY_NAMES, APPOINTMENT_BOARD_KEYS } from "./types";
