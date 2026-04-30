// =============================================================================
// Query Layer — Public API
// =============================================================================

export { searchClients, getClientProfile, getClientByName, listProfiles, listProfilesFiltered, getFilterOptions } from "./client";
export type { ProfileFilterOptions, FilteredProfileResult, FilterOptions } from "./client";
export { getClientContracts } from "./contracts";
export { getClientBoardItems, getBoardItemDetail } from "./board-items";
export { getClientCaseSummary } from "./case-summary";
export { getClientUpdates } from "./updates";
export { getClientRelationships } from "./relationships";
export type { RelationshipWithDetails } from "./relationships";
export { getDashboardKpis } from "./dashboard";
export { getAppointments, getAttorneyList } from "./appointments";
export type { AppointmentEntry, AppointmentsResult, AppointmentSnapshot } from "./appointments";
export { searchByType } from "./search";
export { getAlerts, getAlertsTotalCount } from "./alerts";
export type {
  ProfileSummary,
  ContractSummary,
  BoardItemSummary,
  ClientCaseSummary,
  ClientUpdate,
  SearchResult,
  KpiCard,
  KpiItem,
  SearchType,
  TypedSearchResult,
} from "./types";
export { BOARD_DISPLAY_NAMES, APPOINTMENT_BOARD_KEYS, PAID_CONTRACT_STATUSES } from "./types";
export type { AlertItem, AlertGroup, AlertsResult, AlertSeverity } from "./types";
