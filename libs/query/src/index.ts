// =============================================================================
// Query Layer — Public API
// =============================================================================

export { searchClients, getClientProfile, getOpenDetentions, getClientByName, listProfiles, listProfilesFiltered, getFilterOptions } from "./client";
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
export { getPrescheduling } from "./prescheduling";
export { getPendingContracts } from "./pending-contracts";
export { getCourtCases, ACTIVE_COURT_CASE_GROUP, PREP_STAGE_COLUMN_TITLE } from "./court-cases";
export { getCallLogEntries, getCallLogStaffOptions } from "./call-log";
export { getJailIntakes, getJailIntakeNotes, cutoffDate } from "./jail-intakes";
export { scanMailPages, needsReview, extractNoticeFields, emptyFields, normalizeFields, parseNoticeDate, cleanName, compareNames, nameTokens, NAME_ROLES, splitIntoDocuments, analyzePage, repairOcrText, matchNotice, findFormsForProfile, normalizeANumber, normalizeFormType } from "./mail";
export { saveMailScan, setMailScanPdfPath, getMailDocument, getMailReviewAlertGroup, countMailToReview, resolveMailDocument, applyFieldEdits, updateMailDocumentFields } from "./mail-review";
export { planMailWriteBack, planForDocument, readOpenFormState, findWriteBackColumns, noticeFileName, recordWriteBack, settleQueuedMailStep, applyLocalColumn, overallState, OPEN_FORMS_BOARD_KEY } from "./mail-writeback";
export type { MailWriteBackPlan, WriteStep, WriteStepKind, SkippedStep, StepOutcome, WriteBackState, OpenFormState } from "./mail-writeback";
export type { MailDocumentDetail, MailReviewState, ResolveMailInput, SaveScanInput, FieldEdits, EditFieldsResult } from "./mail-review";
export { readLayout, wordsFromText } from "./mail-layout";
export type { Word, LayoutValues, LayoutKey } from "./mail-layout";
export type { MailPageInput, MailScanResult, MailScanDocument, NoticeMatch, NoticeFields, MatchStatus, AttentionReason, SplitReason, MatchedProfile, MatchedOpenForm } from "./mail";
export type { CallLogEntry, CallLogFilters, CallLogListResult } from "./types";
export type { ActiveCase, ActiveCasesAssignee, ActiveCasesResult, ActiveCasesOptions, Urgency } from "./active-cases";
export type { PreschedulingCase, PreschedulingResult, PreschedulingOptions, WaitLevel } from "./prescheduling";
export type { PendingContract, PendingContractsResult, PendingContractsOptions } from "./pending-contracts";
export type { CourtCase, CourtCasesResult, CourtCasesOptions, CourtCaseFlag, HearingKind, Readiness, ReadinessThresholds } from "./court-cases";
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
  EmailParticipants,
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
