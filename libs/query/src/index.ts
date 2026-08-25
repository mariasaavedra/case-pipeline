// =============================================================================
// Query Layer — Public API
// =============================================================================

export { searchClients, getClientProfile, getClientByName, listProfiles, listProfilesFiltered, getFilterOptions } from "./client";
export type { ProfileFilterOptions, FilteredProfileResult, FilterOptions } from "./client";
export { getClientContracts } from "./contracts";
export { getClientBoardItems, getBoardItemDetail } from "./board-items";
export { getClientCaseSummary } from "./case-summary";
export { getClientUpdates } from "./updates";
export { getBoardStatusOptions, getBoardStatusOptionsFor } from "./status-options";
export { getBoardColumns, getBoardColumnsFor } from "./board-columns";
export { getSyncHealth, getArchivedRows } from "./sync-health";
export type { SyncHealth, SyncBoardCoverage, ArchivedRow, WriteQueueFailure } from "./sync-health";
export { getClientRelationships } from "./relationships";
export type { RelationshipWithDetails } from "./relationships";
export { getDashboardKpis, getKpiCardDetail } from "./dashboard";
export { getAppointments, getAttorneyList } from "./appointments";
export type { AppointmentEntry, AppointmentsResult, AppointmentSnapshot } from "./appointments";
export { getCalendarEvents } from "./calendar";
export type { CalendarCategory, CalendarEvent, CalendarResult, CalendarOptions } from "./calendar";
export { searchByType } from "./search";
export { getAlerts, getAlertsTotalCount } from "./alerts";
export { getActiveCases } from "./active-cases";
export { getCallLogEntries, getCallLogStaffOptions } from "./call-log";
export type { CallLogEntry, CallLogFilters, CallLogListResult } from "./types";
export type { ActiveCase, ActiveCasesAssignee, ActiveCasesResult, ActiveCasesOptions, Urgency } from "./active-cases";
export type {
  ProfileSummary,
  ContractSummary,
  ContractStatusKey,
  ContractLinkedCase,
  ContractTotals,
  ClientContracts,
  StatusTone,
  BoardItemSummary,
  ClientCaseSummary,
  ClientUpdate,
  ClientUpdateAttachment,
  BoardStatusOptions,
  StatusColumnOption,
  BoardColumns,
  BoardColumn,
  TimelineSourceType,
  TimelineCategory,
  TimelineDateRange,
  SearchResult,
  KpiCard,
  KpiItem,
  KpiCardDetail,
  KpiDetailItem,
  KpiColumnOption,
  SearchType,
  TypedSearchResult,
} from "./types";
export { BOARD_DISPLAY_NAMES, APPOINTMENT_BOARD_KEYS, DOCUMENT_BOARD_KEYS, NOTICE_BOARD_KEYS, PAID_CONTRACT_STATUSES } from "./types";
export {
  normalizeContractStatus,
  contractStatusKey,
  isContractPaid,
  CONTRACT_STATUS_LABELS,
} from "./types";
export type { AlertItem, AlertGroup, AlertsResult, AlertSeverity } from "./types";
