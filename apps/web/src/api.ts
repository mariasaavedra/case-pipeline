// =============================================================================
// API Client — Typed fetch wrappers
// =============================================================================

import type { SearchResult, ClientCaseSummary, ProfileSummary, ClientUpdate, Detention, KpiCard, KpiCardDetail, TypedSearchResult, SearchType, BoardStatusOptions, BoardColumns } from "@case-pipeline/query/types";
import type { RelationshipWithDetails } from "@case-pipeline/query/relationships";
import type { AppointmentsResult } from "@case-pipeline/query/appointments";
import type { FilteredProfileResult, FilterOptions, ProfileFilterOptions } from "@case-pipeline/query/client";
import type { AlertsResult } from "@case-pipeline/query/types";
import type { ActiveCasesResult, ActiveCase, MyCasesData, PreschedulingResult, PendingContractsResult, ContractStep, CourtCasesResult, CalendarResult, CalendarCategory, CallLogEntry, CallLogIntakeMatch, CallLogListResult, MailScanResult, MailDocumentDetail, MatchedOpenForm, MailWriteBackPlan, FieldEdits } from "@case-pipeline/query";

export type { SearchResult, ClientCaseSummary, ProfileSummary, Detention, DetentionSource, ContractSummary, ContractLinkedCase, ContractTotals, ClientContracts, ContractStatusKey, StatusTone, BoardItemSummary, ClientUpdate, ClientUpdateAttachment, BoardStatusOptions, StatusColumnOption, BoardColumns, BoardColumn, KpiCard, KpiItem, KpiCardDetail, KpiDetailItem, KpiColumnOption, TypedSearchResult, SearchType } from "@case-pipeline/query/types";
export type { AlertsResult, AlertGroup, AlertItem, AlertSeverity } from "@case-pipeline/query/types";
export type { RelationshipWithDetails } from "@case-pipeline/query/relationships";
export type { AppointmentsResult, AppointmentEntry, AppointmentSnapshot } from "@case-pipeline/query/appointments";
export type { FilteredProfileResult, FilterOptions, ProfileFilterOptions } from "@case-pipeline/query/client";
export type { ActiveCasesResult, ActiveCasesAssignee, ActiveCase, Urgency } from "@case-pipeline/query";
export type { MyCasesData, MyOpenForm, MyPreschedulingCase } from "@case-pipeline/query";
export type { PreschedulingResult, PreschedulingCase, WaitLevel } from "@case-pipeline/query";
export type { PendingContractsResult, PendingContract, ContractStep } from "@case-pipeline/query";
export type { CourtCasesResult, CourtCase, CourtCaseFlag, Readiness, CaseMotion, CourtMotion, MotionFlag, MotionPhase } from "@case-pipeline/query";
import type { CaseTimeline } from "@case-pipeline/query";
import type { BoardColumn as QueryBoardColumn } from "@case-pipeline/query/types";
export type { CaseTimeline, TimelineEvent, TimelineEventStatus, TimelineFix, TimelineNote, TimelineTrack, TimelineKind } from "@case-pipeline/query";
export type { AddressChangesResult, AddressChange, AddressChangePhase, AddressChangeFlag } from "@case-pipeline/query";
export type { FoiasResult, Foia, FoiaPhase, FoiaFlag } from "@case-pipeline/query";
export type { EFilesToOpenResult, EFileToOpen, HirePlan, HirePath, MondayChange, LedgerRow } from "@case-pipeline/query";
export type { WorkloadResult, WorkloadPerson, WorkloadItem, WorkloadAssignment, WorkloadSource, WorkloadColumn, WorkloadLevel } from "@case-pipeline/query";
export type { CalendarResult, CalendarEvent, CalendarCategory } from "@case-pipeline/query";
export type { CallLogEntry, CallLogIntakeMatch, CallLogListResult } from "@case-pipeline/query";
export type { MailScanResult, MailScanDocument, NoticeMatch, MatchStatus, MatchedOpenForm, MatchedProfile, MailDocumentDetail, MailWriteBackPlan, StepOutcome, WriteBackState, NoticeFields, FieldEdits } from "@case-pipeline/query";

/** A saved notice as the API returns it: the server keeps the file path to itself. */
export type MailDocument = Omit<MailDocumentDetail, "pdfPath"> & { hasPdf: boolean };

let _tokenGetter: (() => Promise<string | null>) | null = null;

// A hard page refresh mounts the data providers immediately, while MSAL is
// still restoring the session — so the getter below isn't registered yet.
// Sending those requests anyway produced a bare 401 "Unauthorized" on refresh.
// Callers now wait for auth to settle instead of racing it. AuthProvider must
// call setTokenGetter on EVERY path (including "not signed in", with null), or
// requests would sit here until the timeout.
let _resolveAuthReady: () => void = () => {};
const _authReady = new Promise<void>((resolve) => {
  _resolveAuthReady = resolve;
});
const AUTH_READY_TIMEOUT_MS = 15_000;

export function setTokenGetter(fn: (() => Promise<string | null>) | null) {
  _tokenGetter = fn;
  _resolveAuthReady();
}

async function authHeaders(): Promise<Record<string, string>> {
  // Timeout guard: a wedged auth init degrades to the old behaviour (an honest
  // 401) rather than hanging every request forever.
  await Promise.race([
    _authReady,
    new Promise<void>((resolve) => setTimeout(resolve, AUTH_READY_TIMEOUT_MS)),
  ]);
  if (!_tokenGetter) return {};
  const token = await _tokenGetter();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = { ...(await authHeaders()), ...(init?.headers as Record<string, string> ?? {}) };
  const res = await fetch(url, { ...init, headers });

  let body: { data?: T; error?: string } | null = null;
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      body = (await res.json()) as { data?: T; error?: string };
    } catch {
      // JSON parse failed despite content-type header
    }
  }

  if (!res.ok) {
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }

  if (body?.error) throw new Error(body.error);
  return body?.data as T;
}

export async function listClients(limit = 50, offset = 0): Promise<SearchResult[]> {
  return apiFetch<SearchResult[]>(`/api/clients?limit=${limit}&offset=${offset}`);
}

export async function listClientsFiltered(
  opts: ProfileFilterOptions & { limit?: number; offset?: number }
): Promise<FilteredProfileResult> {
  const params = new URLSearchParams();
  if (opts.limit) params.set("limit", String(opts.limit));
  if (opts.offset) params.set("offset", String(opts.offset));
  if (opts.status) params.set("status", opts.status);
  if (opts.priority) params.set("priority", opts.priority);
  if (opts.attorney) params.set("attorney", opts.attorney);
  if (opts.boardType) params.set("board_type", opts.boardType);
  if (opts.dateFrom) params.set("date_from", opts.dateFrom);
  if (opts.dateTo) params.set("date_to", opts.dateTo);
  return apiFetch<FilteredProfileResult>(`/api/clients?${params.toString()}`);
}

export async function searchClients(
  query: string,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  const url = `/api/clients/search?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: await authHeaders(), ...(signal ? { signal } : {}) });

  const contentType = res.headers.get("content-type") ?? "";
  let body: { data?: SearchResult[]; error?: string } | null = null;
  if (contentType.includes("application/json")) {
    try {
      body = (await res.json()) as { data?: SearchResult[]; error?: string };
    } catch {
      // parse failed
    }
  }

  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  if (body?.error) throw new Error(body.error);
  return body?.data as SearchResult[];
}

export async function typedSearch(
  query: string,
  type: SearchType,
  signal?: AbortSignal,
): Promise<TypedSearchResult[]> {
  const params = new URLSearchParams({ q: query, type });
  const url = `/api/search?${params.toString()}`;
  const res = await fetch(url, { headers: await authHeaders(), ...(signal ? { signal } : {}) });

  const contentType = res.headers.get("content-type") ?? "";
  let body: { data?: TypedSearchResult[]; error?: string } | null = null;
  if (contentType.includes("application/json")) {
    try {
      body = (await res.json()) as { data?: TypedSearchResult[]; error?: string };
    } catch {}
  }

  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  if (body?.error) throw new Error(body.error);
  return body?.data as TypedSearchResult[];
}

export async function fetchFilterOptions(): Promise<FilterOptions> {
  return apiFetch<FilterOptions>("/api/filter-options");
}

export async function getClient(localId: string): Promise<ClientCaseSummary> {
  return apiFetch<ClientCaseSummary>(`/api/clients/${encodeURIComponent(localId)}`);
}

export interface ClientUpdatesQuery {
  category?: string;
  from?: string;
  to?: string;
  /** Only notes written by an attorney (the staff roster's "attorney" role). */
  author?: "attorneys";
}

/** The server's largest /updates page (MAX_UPDATES_PAGE in handlers.ts). */
const UPDATES_PAGE = 1000;

/**
 * A client's WHOLE timeline for a filter: pages until one comes back short, so
 * nothing is cut off however busy the client is.
 */
export async function fetchAllClientUpdates(localId: string, query: ClientUpdatesQuery = {}): Promise<ClientUpdate[]> {
  const all: ClientUpdate[] = [];
  for (;;) {
    const page = await fetchClientUpdates(localId, { ...query, limit: UPDATES_PAGE, offset: all.length });
    all.push(...page);
    if (page.length < UPDATES_PAGE) return all;
  }
}

export async function fetchClientUpdates(
  localId: string,
  opts: ClientUpdatesQuery & { limit?: number; offset?: number } = {},
): Promise<ClientUpdate[]> {
  const { limit = 50, offset = 0, category, from, to, author } = opts;
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (category && category !== "all") params.set("category", category);
  if (author) params.set("author", author);
  // Date bounds are applied server-side — `limit` caps the newest rows, so an
  // older range filtered in the browser would come back empty on a busy client.
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  return apiFetch<ClientUpdate[]>(
    `/api/clients/${encodeURIComponent(localId)}/updates?${params.toString()}`,
  );
}

export async function fetchBoardStatusOptions(): Promise<BoardStatusOptions[]> {
  return apiFetch<BoardStatusOptions[]>("/api/boards/status-options");
}

/** Change a board item's status in Monday. Returns { status, pending } — pending
 * means Monday was unreachable and the write was queued for retry. */
export async function changeBoardItemStatus(
  localId: string,
  status: string,
): Promise<{ localId: string; status: string; pending: boolean }> {
  return apiFetch<{ localId: string; status: string; pending: boolean }>(
    `/api/board-items/${encodeURIComponent(localId)}/status`,
    { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) },
  );
}

export async function fetchBoardColumns(): Promise<BoardColumns[]> {
  return apiFetch<BoardColumns[]>("/api/boards/columns");
}

export async function fetchSyncHealth(): Promise<import("@case-pipeline/query").SyncHealth> {
  return apiFetch("/api/admin/sync-health");
}
export async function fetchArchivedRows(limit = 100): Promise<import("@case-pipeline/query").ArchivedRow[]> {
  return apiFetch(`/api/admin/archived?limit=${limit}`);
}
export async function restoreArchivedRow(id: number): Promise<{ restored: boolean }> {
  return apiFetch(`/api/admin/archived/${id}/restore`, { method: "POST" });
}
export async function clearFailedWrites(): Promise<{ removed: number }> {
  return apiFetch("/api/admin/write-queue/clear-failed", { method: "POST" });
}

/** Monday API usage: Monday's own report (platform_api) + our per-job counts. */
export interface MondayUsage {
  platform: {
    dailyLimit: number | null;
    lastUpdated: string | null;
    byDay: { day: string; usage: number }[];
    byApp: { appId: string; name: string | null; usage: number }[];
    byUser: { name: string | null; usage: number }[];
  } | null;
  platformError: string | null;
  jobs: { day: string; job: string; calls: number }[];
}
export async function fetchMondayUsage(refresh = false): Promise<MondayUsage> {
  return apiFetch(`/api/admin/monday-usage${refresh ? "?refresh=1" : ""}`);
}

/** Change any editable column on a board item. `value` is the label (choice
 * columns), YYYY-MM-DD (dates), or the raw text/number. pending=queued. */
export async function changeBoardItemColumn(
  localId: string,
  columnId: string,
  value: string,
): Promise<{ localId: string; columnId: string; value: string; pending: boolean }> {
  return apiFetch(`/api/board-items/${encodeURIComponent(localId)}/columns`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ columnId, value }),
  });
}

/** Create a Fee K (contract) for a client on Monday. pending=queued. */
export async function createContract(
  profileLocalId: string,
  input: {
    caseType: string; newCaseType?: boolean; af?: number | null; ff?: number | null; pf?: number | null; description?: string;
    attorney: string; email: string; address: string;
  },
): Promise<{ name: string; feeKItemId?: string; pending: boolean }> {
  return apiFetch(`/api/profiles/${encodeURIComponent(profileLocalId)}/contracts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

/**
 * Mark a detained client released: clears Det. Facility on their open court
 * case(s) in Monday and logs a Casenote in the profile's E&A. pending=queued.
 */
export async function releaseClient(
  profileLocalId: string,
  input: { note: string; releasedOn?: string },
): Promise<{ released: boolean; pending: boolean }> {
  return apiFetch(`/api/profiles/${encodeURIComponent(profileLocalId)}/release`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export interface BookableBoard {
  boardKey: string;
  /** The attorney's name when configured, otherwise their badge initials. */
  label: string;
  badge: string;
}

/** Which attorneys are currently taking consults (data/attorney-boards.json). */
export async function fetchBookableBoards(): Promise<BookableBoard[]> {
  return apiFetch("/api/settings/bookable-boards");
}

export async function createAppointment(
  profileLocalId: string,
  input: { boardKey: string; date: string; time?: string; description?: string },
): Promise<{ name: string; appointmentItemId?: string; pending: boolean }> {
  return apiFetch(`/api/profiles/${encodeURIComponent(profileLocalId)}/appointments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

// =============================================================================
// Jail Intakes
// =============================================================================
// Pre-profile leads: a detainee contact becomes a client only when they book a
// consult, which is what `convertedTo` reports.

export interface JailIntake {
  localId: string;
  mondayItemId: string | null;
  name: string;
  status: string | null;
  groupTitle: string | null;
  jail: string | null;
  alienNumber: string | null;
  language: string | null;
  pocName: string | null;
  pocPhone: string | null;
  pocEmail: string | null;
  intakeCreatedOn: string | null;
  lastInteractionDate: string | null;
  consultDate: string | null;
  consultTime: string | null;
  apptWith: string | null;
  convertedTo: {
    appointmentLocalId: string;
    appointmentName: string;
    consultDate: string | null;
    profileLocalId: string | null;
    profileName: string | null;
  } | null;
}

export interface JailIntakeListResult {
  intakes: JailIntake[];
  total: number;
  olderCount: number;
  statusOptions: string[];
}

/**
 * Post a note on a jail intake — a monday update, an E&A activity under the
 * firm's "Casenote" type, and an append to the board's own Description column.
 *
 * `descriptionFull` reports that the Description had no room left (monday caps
 * long text at 2,000 characters). The note still landed as an update and an
 * activity; only the column append was skipped, and the UI says so rather than
 * truncating a client note.
 */
export interface JailIntakeNote {
  localId: string;
  authorName: string;
  textBody: string;
  createdAtSource: string;
  sourceType: string;
}

/** An intake's note history, newest first. Empty until the next sync picks them up. */
export async function fetchJailIntakeNotes(localId: string): Promise<JailIntakeNote[]> {
  return apiFetch(`/api/jail-intakes/${encodeURIComponent(localId)}/notes`);
}

export async function addJailIntakeNote(
  localId: string,
  text: string,
): Promise<{ pending: boolean; descriptionUpdated: boolean; descriptionFull: boolean }> {
  return apiFetch(`/api/jail-intakes/${encodeURIComponent(localId)}/notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

/**
 * Book consult on a paid intake (M9): writes Consult Date + "Appt with:".
 * Staff then press Create Appt in Monday, whose automations do the rest.
 */
export async function bookJailIntakeConsult(
  localId: string,
  input: { date: string; time?: string; apptWith: string },
): Promise<{ pending: boolean; date: string; time: string | null; apptWith: string }> {
  return apiFetch(`/api/jail-intakes/${encodeURIComponent(localId)}/consult`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function createJailIntake(input: {
  firstName: string;
  lastName?: string;
  jail?: string;
  alienNumber?: string;
  language?: string;
  pocName?: string;
  pocPhone?: string;
  /** Optional — the board's "POC Email" column. */
  pocEmail?: string;
  /** "New Detainee" (default) or "Payment link sent. Waiting on payment". */
  status?: string;
  /** Fills the board's own "Description" long-text column. */
  description?: string;
  countryOfBirth?: string;
  /** Free text — the board stores "03/07/1980" and "05-27-95" alike. */
  dateOfBirth?: string;
  /** "No" | "Yes" | "Unknown". */
  priorRemoval?: string;
  /** YYYY-MM-DD — a real date column on the board. */
  pickedUpByIce?: string;
  /** The monday item id of the call this came out of, when it came from one. */
  callLogItemId?: string;
}): Promise<{ name: string; intakeItemId?: string; pending: boolean }> {
  return apiFetch("/api/jail-intakes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function fetchJailIntakes(params: {
  /** 0 means "no date limit" — the escape hatch behind the "N older" chip. */
  withinDays?: number;
  includeClosed?: boolean;
  status?: string;
  search?: string;
} = {}): Promise<JailIntakeListResult> {
  const qs = new URLSearchParams();
  if (params.withinDays != null) qs.set("withinDays", String(params.withinDays));
  if (params.includeClosed) qs.set("includeClosed", "1");
  if (params.status) qs.set("status", params.status);
  if (params.search) qs.set("search", params.search);
  const suffix = qs.toString() ? `?${qs}` : "";
  return apiFetch(`/api/jail-intakes${suffix}`);
}

// =============================================================================
// Call Log
// =============================================================================

export interface CallLogQuery {
  status?: string;
  takenBy?: string;
  dateFrom?: string;
  dateTo?: string;
  unlinkedOnly?: boolean;
  limit?: number;
  offset?: number;
}

export async function fetchCallLog(query: CallLogQuery = {}): Promise<CallLogListResult & { staffOptions: string[]; inactiveStaff?: string[] }> {
  const params = new URLSearchParams();
  if (query.status) params.set("status", query.status);
  if (query.takenBy) params.set("takenBy", query.takenBy);
  if (query.dateFrom) params.set("dateFrom", query.dateFrom);
  if (query.dateTo) params.set("dateTo", query.dateTo);
  if (query.unlinkedOnly) params.set("unlinkedOnly", "1");
  if (query.limit) params.set("limit", String(query.limit));
  if (query.offset) params.set("offset", String(query.offset));
  const qs = params.toString();
  return apiFetch(`/api/call-log${qs ? `?${qs}` : ""}`);
}

export interface MondayStaffUser {
  id: string;
  name: string;
  email: string;
}

export async function fetchCallLogStaffDirectory(): Promise<MondayStaffUser[]> {
  return apiFetch<MondayStaffUser[]>("/api/call-log/staff-directory");
}

/** A staff member @mentioned in a note — tagged in the compose box, notified
 * on the real Monday.com comment via mentions_list. */
export interface MentionedUser {
  id: string;
  name: string;
}

/** Removes the "@" prefix `MentionTextarea` shows while composing before the
 * note is sent to Monday — per Monday's own docs, the body should carry no
 * literal "@" mention syntax; mentions_list alone drives rendering/notifying. */
export function stripMentionMarkers(text: string, mentions: MentionedUser[]): string {
  let result = text;
  for (const m of mentions) {
    result = result.replace(`@${m.name}`, m.name);
  }
  return result;
}

export interface CreateCallLogInput {
  /** The caller's name — becomes the Monday item's name. */
  name: string;
  /** Optional note — posted as an update/comment on the entry, not the item's name. */
  note?: string;
  phone?: string;
  status?: string;
  language?: string;
  profileLocalId?: string | null;
  /** Linked instead of a profile when the caller has none (a detainee's family). */
  jailIntakeLocalId?: string | null;
  takenByUserId?: string | null;
  highlightedForUserId?: string | null;
  /** Monday user ids @mentioned in `note` — notified on the posted comment. */
  mentionedUserIds?: string[];
}

export interface CreateCallLogResult {
  localId: string;
  mondayItemId: string | null;
  name: string;
  status: string | null;
  profileLocalId: string | null;
  pending: boolean;
}

export async function createCallLogEntry(input: CreateCallLogInput): Promise<CreateCallLogResult> {
  return apiFetch("/api/call-log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

/** Jail intakes whose POC phone matches the caller's number — asked only when no profile matched. */
export async function searchCallLogIntakes(query: string, signal?: AbortSignal): Promise<CallLogIntakeMatch[]> {
  return apiFetch(`/api/call-log/intake-matches?q=${encodeURIComponent(query)}`, signal ? { signal } : undefined);
}

export interface UpdateCallLogInput {
  name?: string;
  phone?: string;
  profileLocalId?: string | null;
  /** Sent with profileLocalId: the two share one Monday column, a profile wins. */
  jailIntakeLocalId?: string | null;
  highlightedForUserId?: string | null;
  takenByUserId?: string | null;
  /** Empty string clears the label. */
  status?: string;
  /** Empty string clears the label. */
  language?: string;
}

/** Partial-update an existing call. Only the fields present in `input` are
 * touched (send `null` to clear profileLocalId/highlightedForUserId/
 * takenByUserId, or "" to clear status/language). */
export async function updateCallLogEntry(
  localId: string,
  input: UpdateCallLogInput,
): Promise<{ localId: string; pending: boolean }> {
  return apiFetch(`/api/call-log/${encodeURIComponent(localId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export interface NoteThreadEntry {
  id: string;
  body: string;
  createdAt: string;
  authorName: string | null;
  replies: NoteThreadEntry[];
}

/** A call's note thread — Monday's own comment thread on the item, fetched live. */
export async function fetchCallLogNotes(localId: string): Promise<{ updates: NoteThreadEntry[] }> {
  return apiFetch(`/api/call-log/${encodeURIComponent(localId)}/notes`);
}

/** Posts a threaded reply into the call's note thread (or a fresh top-level
 * update if it has none yet). pending=queued (Monday was unreachable). */
export async function addCallLogNote(
  localId: string,
  note: string,
  mentionedUserIds?: string[],
): Promise<{ pending: boolean }> {
  return apiFetch(`/api/call-log/${encodeURIComponent(localId)}/notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note, mentionedUserIds }),
  });
}

export async function fetchClientRelationships(localId: string): Promise<RelationshipWithDetails[]> {
  return apiFetch<RelationshipWithDetails[]>(`/api/clients/${encodeURIComponent(localId)}/relationships`);
}

/** P3.9 — the client's case as dated milestones + a short summary. */
/** One timeline event's Monday item for the event panel (M29); mirrors routes/case-timeline.ts. */
export interface TimelineItem {
  localId: string;
  boardKey: string;
  boardName: string;
  name: string;
  status: string | null;
  group: string | null;
  mondayBoardId: string | null;
  mondayItemId: string | null;
  fields: (Omit<QueryBoardColumn, "position"> & { key: string; value: string; primary: boolean })[];
  /** What changed on the item, newest first (item activity log). */
  history: { changedAt: string; what: string; from: string | null; to: string | null; by: string | null }[];
}

export async function fetchTimelineItem(localId: string): Promise<TimelineItem> {
  return apiFetch<TimelineItem>(`/api/timeline/items/${encodeURIComponent(localId)}`);
}

export async function fetchCaseTimeline(localId: string): Promise<CaseTimeline> {
  return apiFetch<CaseTimeline>(`/api/clients/${encodeURIComponent(localId)}/timeline`);
}

export async function fetchAppointments(
  attorney?: string,
  range?: "day" | "week" | "upcoming" | "all",
  date?: string,
): Promise<AppointmentsResult> {
  const params = new URLSearchParams();
  if (attorney) params.set("attorney", attorney);
  if (range) params.set("range", range);
  if (date) params.set("date", date);
  const qs = params.toString();
  return apiFetch<AppointmentsResult>(`/api/appointments${qs ? `?${qs}` : ""}`);
}

/** What Monday knows for M22's form — ContractPrefill in apps/api/src/routes/contract-document.ts. */
export interface ContractPrefill {
  clientName: string;
  email: string;
  address: string;
  /** `address` split for a letter; cityStateZip "" when it couldn't be split. */
  street: string;
  cityStateZip: string;
  attorneyName: string;
  /** From Settings → Documents; "" when the attorney isn't listed there. */
  attorneyEmail: string;
  contractFor: string[];
  /** The matter from the Fee K Type(s): clean English title + Spanish. */
  formName?: string;
  formNameEs?: string;
  attorneyFee: number | null;
  filingFee: number | null;
  processingFee: number | null;
  hearingType: string;
  hearingDate: string;
  /** Scope of services for the Fee K's type(s); "" each when none. */
  scope?: { services: string; servicesEs: string; excluded: string; excludedEs: string };
}

export async function fetchContractPrefill(localId: string): Promise<ContractPrefill> {
  return apiFetch(`/api/contracts/${encodeURIComponent(localId)}/document-form`);
}

/** Whether this server can send contracts to Adobe Sign (Zapier configured). */
export async function fetchEsignStatus(): Promise<{ enabled: boolean }> {
  return apiFetch("/api/esign/status");
}

/** Send the generated PDF to Adobe Sign via Zapier: attorney signs first, then the client. */
export async function sendContractForSignature(
  localId: string,
  pdf: Blob,
  opts: { attorneyEmail: string; clientEmail: string; documentName: string },
): Promise<{ id: number; stage: string | null; warning: string | null }> {
  const q = new URLSearchParams(opts);
  return apiFetch(`/api/contracts/${encodeURIComponent(localId)}/esign?${q}`, {
    method: "POST",
    headers: { "Content-Type": "application/pdf" },
    body: pdf,
  });
}

/**
 * Record the LawPay links M21 hands out (routes/lawpay.ts), so the payment
 * LawPay reports back finds its Fee K. Best-effort: never blocks staff.
 */
export async function recordPaymentLinks(
  localId: string,
  info: { channel: "email" | "text" | "copy" | "mark"; method: string | null; links: { fee: "AF" | "PF" | "FF"; amount: number; reference: string }[] },
): Promise<void> {
  if (info.links.length === 0) return;
  const headers = { ...(await authHeaders()), "Content-Type": "application/json" };
  await fetch(`/api/contracts/${encodeURIComponent(localId)}/payment-links`, {
    method: "POST", headers, body: JSON.stringify(info),
  }).catch(() => {});
}

/** Audit a generated contract (template name + fees only). Best-effort. */
export async function logContractGenerated(
  localId: string,
  info: { template: string; format: "pdf" | "docx"; attorneyFee: number | null; filingFee: number | null },
): Promise<void> {
  const headers = { ...(await authHeaders()), "Content-Type": "application/json" };
  await fetch(`/api/contracts/${encodeURIComponent(localId)}/document-generated`, {
    method: "POST", headers, body: JSON.stringify(info),
  }).catch(() => {});
}

// ---- Generated documents (M23) — apps/api/src/documents/g28.ts, routes/documents.ts ----

export type G28Agency = "uscis" | "ice" | "cbp";
export type G28ClientRole = "applicant" | "petitioner" | "requestor" | "beneficiary" | "respondent";
export type G28UnitType = "" | "apt" | "ste" | "flr";

export interface G28Address {
  street: string; unitType: G28UnitType; unit: string; city: string; state: string; zip: string;
  province: string; postalCode: string; country: string;
}

export interface G28Input {
  attorney: {
    id: string; familyName: string; givenName: string; middleName: string; uscisAccount: string;
    address: G28Address; phone: string; mobile: string; email: string; fax: string;
    licensingAuthority: string; barNumber: string; firmName: string; subjectToOrders: boolean;
  };
  matter: { agency: G28Agency; uscisForms: string; specificMatter: string; receiptNumber: string; clientRole: G28ClientRole };
  client: {
    familyName: string; givenName: string; middleName: string; aNumber: string; uscisAccount: string;
    phone: string; mobile: string; email: string; address: G28Address;
  };
  notices: { originalsToAttorney: boolean; cardsToAttorney: boolean; i94ToClient: boolean };
}

export interface FirmInfo { name: string; street: string; suite: string; city: string; state: string; zip: string; phone: string; fax: string }
export interface AttorneyInfo {
  id: string; givenName: string; familyName: string; email: string; mobile: string; uscisAccount: string;
  bars: { state: string; number: string }[]; defaultBar: string;
}
export interface FacilityInfo { label: string; name: string; street: string; city: string; state: string; zip: string }
export interface DocumentSettings { firm: FirmInfo; attorneys: AttorneyInfo[]; facilities: FacilityInfo[] }

export interface G28Form {
  input: G28Input;
  detainedAt: string | null;
  facilityMissing: boolean;
  profileContact: { phone: string; email: string };
  mondayAttorney: string;
  attorneys: AttorneyInfo[];
  firm: FirmInfo;
  /** Box sizes, keyed "client.address.street" etc. */
  limits: Record<string, number>;
}

export async function fetchG28Form(profileLocalId: string): Promise<G28Form> {
  return apiFetch(`/api/profiles/${encodeURIComponent(profileLocalId)}/documents/g28`);
}

/** The filled G-28. Throws with the server's list of problems on a 400. */
export async function generateG28(profileLocalId: string, input: G28Input): Promise<{ blob: Blob; filename: string }> {
  const headers = { ...(await authHeaders()), "Content-Type": "application/json" };
  const res = await fetch(`/api/profiles/${encodeURIComponent(profileLocalId)}/documents/g28`, {
    method: "POST", headers, body: JSON.stringify({ input }),
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // non-JSON error body — keep the HTTP status message
    }
    throw new Error(message);
  }
  const disposition = res.headers.get("content-disposition") ?? "";
  const utf8 = /filename\*=UTF-8''([^;]+)/.exec(disposition)?.[1];
  const plain = /filename="([^"]+)"/.exec(disposition)?.[1];
  return { blob: await res.blob(), filename: utf8 ? decodeURIComponent(utf8) : plain ?? "G-28.pdf" };
}

export function fetchDocumentSettings(): Promise<DocumentSettings> {
  return apiFetch<DocumentSettings>("/api/settings/documents");
}
export function updateDocumentSettings(s: DocumentSettings): Promise<DocumentSettings> {
  return apiFetch<DocumentSettings>("/api/settings/documents", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(s),
  });
}

// SMS (RingCentral) — routes/sms.ts
export interface SmsTemplate { key: string; label: string; en: string; es: string }
export type SmsMode = "off" | "dry-run" | "on";
export interface SmsConfig {
  mode: SmsMode;
  /** The number texts come from, formatted; null when not configured. */
  fromNumber: string | null;
  templates: SmsTemplate[];
  firm: { firmName: string; firmPhone: string };
}
export type SmsContext = "call_log" | "payment_links" | "client" | "upload_link";
export interface SendSmsInput {
  to: string;
  body: string;
  context: SmsContext;
  templateKey?: string | null;
  language?: "en" | "es" | null;
  profileLocalId?: string | null;
}
export interface SendSmsResult {
  mode: SmsMode;
  /** RingCentral's status ("Queued", "Sent"…) or "DryRun". */
  status: string;
  /** The E&A entry on the profile: written, queued (Monday down), or none (unlinked / dry run). */
  activity: "logged" | "queued" | "none";
  segments: number;
}

export function fetchSmsConfig(): Promise<SmsConfig> {
  return apiFetch<SmsConfig>("/api/sms/config");
}
export function sendSms(input: SendSmsInput): Promise<SendSmsResult> {
  return apiFetch<SendSmsResult>("/api/sms/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
/** Anyone: add a template (the key is made from the name). */
export function createSmsTemplate(t: Omit<SmsTemplate, "key">): Promise<SmsTemplate> {
  return apiFetch<SmsTemplate>("/api/sms/templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(t),
  });
}
/** Anyone: edit a template's name and texts. */
export function editSmsTemplate(key: string, t: Omit<SmsTemplate, "key">): Promise<SmsTemplate> {
  return apiFetch<SmsTemplate>(`/api/sms/templates/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(t),
  });
}
export function updateSmsTemplates(templates: SmsTemplate[]): Promise<SmsTemplate[]> {
  return apiFetch<SmsTemplate[]>("/api/settings/sms-templates", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(templates),
  });
}

// Settings → Firm → Fee K Types (P11.3.6) — routes/fee-k-types.ts
/** One Fee K Type: its Spanish name, the board once paid, the fee sheet job that prices it. */
export interface FeeKTypeRow {
  feeKType: string;
  spanish: string;
  /** An "It will go to…" label; "" = not set. */
  board: string;
  /** A fee sheet Job; "" = not set. */
  feeSheetJob: string;
  /** Scope of services the contract prints (EN + ES); "" = none. */
  services: string;
  servicesEs: string;
  excluded: string;
  excludedEs: string;
}
export interface FeeKTypesTable {
  rows: FeeKTypeRow[];
  /** Monday's Fee K Type labels (synced). */
  feeKTypes: string[];
  /** Monday's "It will go to…" labels (synced). */
  boards: string[];
  /** No admin has saved yet: rows are the starting draft, used for nothing until saved. */
  draft: boolean;
}
export function fetchFeeKTypes(): Promise<FeeKTypesTable> {
  return apiFetch<FeeKTypesTable>("/api/settings/fee-k-types");
}
export function updateFeeKTypes(rows: FeeKTypeRow[]): Promise<FeeKTypesTable> {
  return apiFetch<FeeKTypesTable>("/api/settings/fee-k-types", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rows }),
  });
}

// Settings → Integrations (P11.5) — routes/integrations.ts
export type SlackChannelKind = "events" | "ops" | "alerts";
export interface NotifyEventDef { key: string; kind: SlackChannelKind; label: string; description: string }
export interface NotifyEventSetting { enabled: boolean; channel: string | null }
export interface NotifySettings { events: Record<string, NotifyEventSetting>; opsRepeatMinutes: number }
export interface IntegrationsStatus {
  slack: {
    mode: "off" | "dry-run" | "on";
    tokenSet: boolean;
    bot: { name: string; team: string } | { error: string } | null;
    webhookSet: boolean;
    envChannels: Record<SlackChannelKind, string | null>;
    catalog: NotifyEventDef[];
    settings: NotifySettings;
    opsRepeatLimits: { min: number; max: number };
  };
  sms: { mode: SmsMode; configured: boolean; fromNumber: string | null; templates: number; tenDlcNote: string };
}
export interface SlackChannelInfo { id: string; name: string; isPrivate: boolean; isMember: boolean }
export interface CheckStep { ok: boolean; label: string; fix?: string }

export function fetchIntegrations(): Promise<IntegrationsStatus> {
  return apiFetch<IntegrationsStatus>("/api/settings/integrations");
}
export function fetchSlackChannels(refresh = false): Promise<SlackChannelInfo[]> {
  return apiFetch<SlackChannelInfo[]>(`/api/settings/integrations/slack/channels${refresh ? "?refresh=1" : ""}`);
}
export function updateNotifySettings(s: NotifySettings): Promise<NotifySettings> {
  return apiFetch<NotifySettings>("/api/settings/notify", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(s),
  });
}
export function sendSlackTest(channel: string): Promise<{ posted: boolean }> {
  return apiFetch<{ posted: boolean }>("/api/settings/integrations/slack/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channel }),
  });
}
export function checkSmsConnection(): Promise<{ ok: boolean; steps: CheckStep[] }> {
  return apiFetch<{ ok: boolean; steps: CheckStep[] }>("/api/settings/integrations/sms/check", { method: "POST" });
}

export async function fetchPendingContracts(): Promise<PendingContractsResult> {
  return apiFetch<PendingContractsResult>("/api/pending-contracts");
}

/** Record a signing / payment-link step on a contract (Acrobat Pro hand-off):
 * moves its Contract Stage and stamps the date that goes with it. `from` is the
 * stage the user saw — 409 if it changed since. pending = queued. */
export async function recordContractStep(
  localId: string,
  step: ContractStep,
  from: string | null,
): Promise<{ localId: string; step: ContractStep; stage: string; date: string; pending: boolean }> {
  return apiFetch(`/api/contracts/${encodeURIComponent(localId)}/step`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ step, from }),
  });
}

export type ContractFees = { af: number | null; ff: number | null; pf: number | null };

/** Change a Fee K's AF / FF / PF and/or its case type ("Fee K Type"; one
 * label, replacing what was there; `newCaseType` = add it to the dropdown).
 * Only what changed is written; a null fee clears. `from` is what the user
 * saw — 409 if Monday changed since. */
/** Pre-fill for a contract (M11, M2, M25): the client's e-mail / address / attorney
 * from their profile, and who can be picked as the attorney. */
export async function fetchContractInfo(profileLocalId?: string | null): Promise<{ attorneys: string[]; email: string; address: string; attorney: string }> {
  return apiFetch(`/api/contract-info${profileLocalId ? `?profile=${encodeURIComponent(profileLocalId)}` : ""}`);
}

/** M25 Edit contract: only what changed. Fees / case type / attorney on the Fee K,
 * e-mail / address on the client's profile. `from` = what the user saw (409 if changed since). */
export async function updateContract(
  localId: string,
  change: { fees?: Partial<ContractFees>; caseType?: string; newCaseType?: boolean; attorney?: string; email?: string; address?: string },
  from: Partial<ContractFees> & { caseType?: string[]; attorney?: string[]; email?: string; address?: string },
): Promise<{ localId: string; fees: Partial<ContractFees>; caseType?: string; attorney?: string; pending: boolean }> {
  return apiFetch(`/api/contracts/${encodeURIComponent(localId)}/fees`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...change, from }),
  });
}

export async function fetchCourtCases(): Promise<CourtCasesResult> {
  return apiFetch<CourtCasesResult>("/api/court-cases");
}

/** Move a court case to another Case Prep Status. `from` is the stage the user
 * saw — the server refuses (409) if the case moved since. pending = queued. */
export async function changeCourtCasePrepStage(
  localId: string,
  stage: string,
  from: string | null,
): Promise<{ localId: string; stage: string; pending: boolean }> {
  return apiFetch(`/api/court-cases/${encodeURIComponent(localId)}/prep-stage`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stage, from }),
  });
}

/** Change a motion's Status on Monday, with the date that goes with it (Filed →
 * MTN Filed on, Granted/Denied → Dec. Date; YYYY-MM-DD, default today). `from`
 * is the status the user saw — 409 if it changed since. pending = queued. */
export async function changeMotionStatus(
  localId: string,
  status: string,
  from: string | null,
  date?: string,
): Promise<{ localId: string; status: string; phase: string; filedOn?: string; decidedOn?: string; pending: boolean }> {
  return apiFetch(`/api/motions/${encodeURIComponent(localId)}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, from, ...(date ? { date } : {}) }),
  });
}

export async function fetchAddressChanges(): Promise<import("@case-pipeline/query").AddressChangesResult> {
  return apiFetch("/api/address-changes");
}

/** Open work per person (admin-only) — apps/api/src/server.ts, libs/query/src/workload.ts. */
export async function fetchWorkload(): Promise<import("@case-pipeline/query").WorkloadResult> {
  return apiFetch("/api/workload");
}

export async function fetchFoias(): Promise<import("@case-pipeline/query").FoiasResult> {
  return apiFetch("/api/foias");
}

export async function fetchEFilesToOpen(): Promise<import("@case-pipeline/query").EFilesToOpenResult> {
  return apiFetch("/api/efiles-to-open");
}

export async function fetchPrescheduling(): Promise<PreschedulingResult> {
  return apiFetch<PreschedulingResult>("/api/prescheduling");
}

export async function fetchActiveCases(includeSnoozed = false): Promise<ActiveCasesResult> {
  return apiFetch<ActiveCasesResult>(`/api/active-cases${includeSnoozed ? "?includeSnoozed=1" : ""}`);
}

export async function fetchAlerts(attorney?: string): Promise<AlertsResult> {
  const params = new URLSearchParams();
  if (attorney) params.set("attorney", attorney);
  const qs = params.toString();
  return apiFetch<AlertsResult>(`/api/alerts${qs ? `?${qs}` : ""}`);
}

export async function fetchCalendarEvents(
  from: string,
  to: string,
  categories?: CalendarCategory[],
  attorney?: string,
): Promise<CalendarResult> {
  const params = new URLSearchParams({ from, to });
  if (categories && categories.length > 0) params.set("categories", categories.join(","));
  if (attorney) params.set("attorney", attorney);
  return apiFetch<CalendarResult>(`/api/calendar?${params.toString()}`);
}

// =============================================================================
// Attorney Boards Settings
// =============================================================================

export interface AttorneyBoard {
  boardKey: string;
  mondayBoardId: string;
  displayName: string;
  /** The attorney's full name as Monday's Attorney column has it, when set. */
  attorneyName?: string;
  active: boolean;
}

export async function fetchAttorneyBoards(): Promise<AttorneyBoard[]> {
  return apiFetch<AttorneyBoard[]>("/api/settings/attorney-boards");
}

export async function addAttorneyBoard(
  board: Omit<AttorneyBoard, "active">,
): Promise<AttorneyBoard[]> {
  return apiFetch<AttorneyBoard[]>("/api/settings/attorney-boards", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(board),
  });
}

export async function deleteAttorneyBoard(boardKey: string): Promise<AttorneyBoard[]> {
  return apiFetch<AttorneyBoard[]>(`/api/settings/attorney-boards/${encodeURIComponent(boardKey)}`, {
    method: "DELETE",
  });
}

// =============================================================================
// Monday.com OAuth
// =============================================================================

export interface MondayConnectionStatus {
  /** False when the server has no Monday OAuth app credentials — Connect can't work. */
  oauthConfigured?: boolean;
  connected: boolean;
  mondayName?: string;
  /** Monday refused this token (revoked, or missing a scope granted later).
   * Writes still go through under the shared account — only attribution is
   * lost — so this is a nudge, not a blocker. Reconnecting clears it. */
  needsReconnect?: boolean;
  rejectedAt?: string;
  rejectionReason?: string;
}

export async function fetchMondayStatus(): Promise<MondayConnectionStatus> {
  return apiFetch<MondayConnectionStatus>("/api/auth/monday/status");
}

export async function getAzureToken(): Promise<string | null> {
  if (!_tokenGetter) return null;
  return _tokenGetter();
}

// =============================================================================
// Profile Write-Back
// =============================================================================

export async function postProfileUpdate(
  profileLocalId: string,
  text: string,
  mentionedUserIds?: string[],
): Promise<ClientUpdate> {
  return apiFetch<ClientUpdate>(`/api/profiles/${encodeURIComponent(profileLocalId)}/updates`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, mentionedUserIds }),
  });
}

/**
 * Add a sub-note under a timeline entry. A Monday update gets a real reply; an
 * E&A entry gets a "Re: …" update on the same item (see routes/profile-write.ts).
 */
export async function postTimelineReply(
  parentLocalId: string,
  text: string,
  mentionedUserIds?: string[],
): Promise<ClientUpdate> {
  return apiFetch<ClientUpdate>(`/api/updates/${encodeURIComponent(parentLocalId)}/replies`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, mentionedUserIds }),
  });
}

export async function fetchDashboard(hearingRange?: string): Promise<KpiCard[]> {
  const params = hearingRange ? `?hearingRange=${encodeURIComponent(hearingRange)}` : "";
  const res = await fetch(`/api/dashboard${params}`, { headers: await authHeaders() });

  const contentType = res.headers.get("content-type") ?? "";
  let body: { data?: KpiCard[] } | null = null;
  if (contentType.includes("application/json")) {
    try {
      body = (await res.json()) as { data?: KpiCard[] };
    } catch {
      // parse failed
    }
  }

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return body?.data as KpiCard[];
}

/**
 * Every row behind one KPI card. `column` previews a display column without
 * saving it, so the picker in the modal can react before the user commits.
 */
export function fetchKpiCardItems(
  key: string,
  opts: { hearingRange?: string; column?: string } = {},
): Promise<KpiCardDetail> {
  const params = new URLSearchParams();
  if (opts.hearingRange) params.set("hearingRange", opts.hearingRange);
  if (opts.column) params.set("column", opts.column);
  const qs = params.toString();
  return apiFetch<KpiCardDetail>(
    `/api/dashboard/${encodeURIComponent(key)}/items${qs ? `?${qs}` : ""}`,
  );
}

// ---- KPI display columns: firm-wide default (admins write, everyone reads) ----

export function fetchGlobalKpiColumns(): Promise<Record<string, string>> {
  return apiFetch<Record<string, string>>("/api/settings/kpi-columns");
}

export function updateGlobalKpiColumns(
  columns: Record<string, string>,
): Promise<Record<string, string>> {
  return apiFetch<Record<string, string>>("/api/settings/kpi-columns", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ columns }),
  });
}

// ---- Status tag overrides (admin-editable label + color per Monday status) ----

import type { StatusRule } from "./config";
export type StatusOverrides = Record<string, StatusRule>;
export interface StatusCatalogEntry { status: string; count: number; }

export function fetchStatusOverrides(): Promise<StatusOverrides> {
  return apiFetch<StatusOverrides>("/api/settings/status-overrides");
}
export function updateStatusOverrides(overrides: StatusOverrides): Promise<StatusOverrides> {
  return apiFetch<StatusOverrides>("/api/settings/status-overrides", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(overrides),
  });
}
export function fetchStatusCatalog(): Promise<StatusCatalogEntry[]> {
  return apiFetch<StatusCatalogEntry[]>("/api/settings/status-catalog");
}

// ---- Urgency settings (date thresholds + status-urgency mode) ----

export interface UrgencySettings {
  criticalDays: number;
  soonDays: number;
  statusUrgencyAffectsBoard: boolean;
}
export function fetchUrgencySettings(): Promise<UrgencySettings> {
  return apiFetch<UrgencySettings>("/api/settings/urgency");
}
export function updateUrgencySettings(s: UrgencySettings): Promise<UrgencySettings> {
  return apiFetch<UrgencySettings>("/api/settings/urgency", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(s),
  });
}

// =============================================================================
// User customization — preferences, profile, my-cases, watchlist, saved views
// =============================================================================

export type ThemePref = "light" | "dark" | "system";
export type DateFormatPref = "MM/DD/YYYY" | "DD/MM/YYYY" | "YYYY-MM-DD" | "relative";

export interface ServerPreferences {
  theme: ThemePref;
  defaultPage: string;
  sidebarCollapsedDefault: boolean;
  dateFormat: DateFormatPref;
  density: "comfortable" | "compact";
  showScreenCodes: boolean;
  dashboardLayout: string[];
  columns: Record<string, string[]>;
  /** Per-card display column on the dashboard, overriding the firm-wide default. */
  kpiColumns: Record<string, string>;
  /** G1 sidebar: page ids in the user's order + the ones they hid. */
  sidebarNav: SidebarNavPref;
}

export interface SidebarNavPref {
  order: string[];
  hidden: string[];
  /** User-made folders: the folder id sits in `order`, its pages in `items`. */
  folders?: SidebarFolder[];
}

export interface SidebarFolder {
  id: string;
  name: string;
  items: string[];
}

export interface PublicUser {
  id: number;
  azure_oid: string;
  email: string;
  name: string;
  role: "admin" | "user";
  created_at: string;
  last_login: string | null;
  monday_name: string | null;
  job_title: string | null;
  locale: string | null;
  timezone: string | null;
  active: number;
  paralegal_link: string | null;
  /** The attorney appointment board P4 My Day opens on (boardKey). */
  attorney_board: string | null;
  phone_ext: string | null;
  login_count: number;
  last_active_at: string | null;
  mondayConnected: boolean;
  /** The staff roster person this login belongs to (Settings → Staff). */
  staff_id: number | null;
}

export interface MyCasesResult extends MyCasesData {
  needsLink: boolean;
  paralegalLink: string | null;
  /** Whose cases these are; null = everyone. */
  selected: string | null;
}

export interface WatchlistItem {
  /** The profile's CURRENT local_id, resolved server-side for linking. */
  profileLocalId: string;
  /** Stable identity — what the watchlist is actually keyed on. */
  mondayItemId: string;
  name: string;
  note: string | null;
  createdAt: string;
}

export interface RecentlyViewedItem {
  /** The profile's CURRENT local_id, resolved server-side for linking. */
  profileLocalId: string;
  /** Stable identity — what the history is actually keyed on. */
  mondayItemId: string;
  name: string;
  viewedAt: string;
}

export interface SavedViewItem {
  id: number;
  name: string;
  kind: string;
  filters: unknown;
  createdAt: string;
}

export interface AuditEntry {
  id: number;
  actorUserId: number | null;
  actorEmail: string | null;
  action: string;
  targetType: string | null;
  /** Local row id — a per-sync surrogate; do not use it to resolve anything. */
  targetId: string | null;
  /** Stable Monday item id — what still resolves months later. */
  targetMondayId: string | null;
  metadata: unknown;
  /** What targetMondayId resolves to today; null when it doesn't (or there is none). */
  target: { name: string; boardKey: string | null; profileLocalId: string | null } | null;
  createdAt: string;
}

export interface AuditFilters {
  /** users.db user id. */
  actor?: number;
  /** Exact action, or a prefix like "monday" for the whole family. */
  action?: string;
  /** Stable Monday item id — the case-scoped history. */
  target?: string;
  from?: string; // YYYY-MM-DD
  to?: string;   // YYYY-MM-DD, inclusive
}

// ---- Preferences ----
export function getPreferences(): Promise<ServerPreferences> {
  return apiFetch<ServerPreferences>("/api/preferences");
}
export function updatePreferences(patch: Partial<ServerPreferences>): Promise<ServerPreferences> {
  return apiFetch<ServerPreferences>("/api/preferences", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

// ---- Self-service profile ----
export interface ProfilePatch {
  locale?: string;
  timezone?: string | null;
  phone_ext?: string | null;
  paralegal_link?: string | null;
}
export function updateMyProfile(patch: ProfilePatch): Promise<PublicUser> {
  return apiFetch<PublicUser>("/api/me/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}
export function getParalegals(): Promise<string[]> {
  return apiFetch<string[]>("/api/paralegals");
}

// ---- My cases ----
/** `paralegal`: a board name, "all" for everyone, or undefined for the caller's own. */
export function getMyCases(paralegal?: string, includeSnoozed = false): Promise<MyCasesResult> {
  const params = new URLSearchParams();
  if (paralegal) params.set("paralegal", paralegal);
  if (includeSnoozed) params.set("includeSnoozed", "1");
  const qs = params.toString();
  return apiFetch<MyCasesResult>(`/api/my-cases${qs ? `?${qs}` : ""}`);
}

export type CaseCardKind = "fee_k" | "open_form";

/** P6 case card (M27): one field on a Fee K or an Open Form. value "" clears a date. */
export function updateCaseField(
  kind: CaseCardKind,
  localId: string,
  field: string,
  value: string,
  from: string | null,
): Promise<{ localId: string; field: string; value: string | null; pending: boolean }> {
  const base = kind === "fee_k" ? "/api/contracts" : "/api/open-forms";
  return apiFetch(`${base}/${encodeURIComponent(localId)}/case-field`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ field, value, from }),
  });
}

/** Set the client's E-File link on Monday (only where none is, or replacing `replaces`). */
export function setProfileEFile(
  profileLocalId: string,
  url: string,
  replaces?: string | null,
): Promise<{ localId: string; eFile: string; pending: boolean }> {
  return apiFetch(`/api/profiles/${encodeURIComponent(profileLocalId)}/e-file`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, replaces: replaces ?? null }),
  });
}

// ---- Client upload links (M30, docs/features/client-uploads.md) ----

export interface ClientUpload {
  id: number;
  received_at: string;
  stored_name: string;
  size: number;
  content_type: string;
  kind: "id" | "notice" | "evidence" | "other";
  note: string | null;
  sharepoint_url: string | null;
  filed_where: string | null;
  filed_at: string | null;
  last_error: string | null;
}

export interface UploadLinkInfo {
  id: number;
  language: "es" | "en";
  active: boolean;
  createdAt: string;
  createdBy: string | null;
  expiresAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
  lastUsedAt: string | null;
  uploads: ClientUpload[];
}

export function fetchUploadLinks(profileLocalId: string): Promise<{ enabled: boolean; links: UploadLinkInfo[] }> {
  return apiFetch(`/api/profiles/${encodeURIComponent(profileLocalId)}/upload-links`);
}

/** The only response that carries the link itself: it is never shown again. */
export function createUploadLink(
  profileLocalId: string,
  input: { language: "es" | "en"; days?: number },
): Promise<{ id: number; url: string; expiresAt: string; replaced: boolean }> {
  return apiFetch(`/api/profiles/${encodeURIComponent(profileLocalId)}/upload-links`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function extendUploadLink(id: number, days = 30): Promise<{ id: number; expiresAt: string }> {
  return apiFetch(`/api/upload-links/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ days }),
  });
}

export function revokeUploadLink(id: number): Promise<{ id: number; revoked: boolean }> {
  return apiFetch(`/api/upload-links/${id}`, { method: "DELETE" });
}

// ---- Watchlist ----
export function getWatchlist(): Promise<WatchlistItem[]> {
  return apiFetch<WatchlistItem[]>("/api/watchlist");
}
export function addWatchlist(mondayItemId: string, note?: string): Promise<{ mondayItemId: string; note: string | null }> {
  return apiFetch("/api/watchlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mondayItemId, note }),
  });
}
export function removeWatchlist(mondayItemId: string): Promise<{ removed: boolean }> {
  return apiFetch(`/api/watchlist/${encodeURIComponent(mondayItemId)}`, { method: "DELETE" });
}

// ---- Recently viewed ----
export function getRecentlyViewed(): Promise<RecentlyViewedItem[]> {
  return apiFetch<RecentlyViewedItem[]>("/api/me/recently-viewed");
}

// ---- Saved views ----
export function getSavedViews(kind?: string): Promise<SavedViewItem[]> {
  const q = kind ? `?kind=${encodeURIComponent(kind)}` : "";
  return apiFetch<SavedViewItem[]>(`/api/saved-views${q}`);
}
export function addSavedView(name: string, kind: string, filters: unknown): Promise<SavedViewItem> {
  return apiFetch<SavedViewItem>("/api/saved-views", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, kind, filters }),
  });
}
export function deleteSavedView(id: number): Promise<{ removed: boolean }> {
  return apiFetch(`/api/saved-views/${id}`, { method: "DELETE" });
}

// ---- Admin ----
export function fetchAdminUsers(): Promise<PublicUser[]> {
  return apiFetch<PublicUser[]>("/api/admin/users");
}
export type PresenceStatus = "online" | "idle" | "offline";
export interface UserPresence {
  id: number;
  name: string;
  email: string;
  lastActiveAt: string | null;
  secondsAgo: number | null;
  status: PresenceStatus;
}
export function fetchUserPresence(): Promise<UserPresence[]> {
  return apiFetch<UserPresence[]>("/api/admin/users/presence");
}
export function updateAdminUser(
  id: number,
  patch: { job_title?: string | null; paralegal_link?: string | null; attorney_board?: string | null; active?: boolean; staff_id?: number | null },
): Promise<PublicUser> {
  return apiFetch<PublicUser>(`/api/admin/users/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}
// =============================================================================
// Staff roster (Settings → Staff) — see apps/api/src/routes/staff.ts
// =============================================================================

export type StaffRole = "attorney" | "paralegal" | "court_paralegal" | "reception" | "billing" | "manager";

export const STAFF_ROLE_LABEL: Record<StaffRole, string> = {
  attorney: "Attorney",
  paralegal: "Paralegal",
  court_paralegal: "Court paralegal",
  reception: "Reception",
  billing: "Billing",
  manager: "Manager",
};

export interface StaffMember {
  id: number;
  name: string;
  email: string | null;
  mondayUserId: string | null;
  phoneExt: string | null;
  /** Slack member id (U…), for DMs. */
  slackUserId: string | null;
  attorneyBoard: string | null;
  active: boolean;
  startDate: string | null;
  endDate: string | null;
  /** monday = a Monday user; board_name = only seen on the boards; manual = added here. */
  source: "monday" | "board_name" | "manual";
  mondaySeenAt: string | null;
  rolesReviewed: boolean;
  roles: StaffRole[];
  aliases: string[];
  login: { userId: number; email: string; active: boolean } | null;
}

export interface StaffRefreshResult {
  mondayAdded: number;
  mondayUpdated: number;
  boardNamesAdded: number;
  rolesSuggested: number;
  loginsLinked: number;
  missingFromMonday: string[];
  mondaySkipped: string | null;
}

export type StaffPatch = Partial<{
  name: string;
  email: string | null;
  phoneExt: string | null;
  slackUserId: string | null;
  attorneyBoard: string | null;
  active: boolean;
  startDate: string | null;
  endDate: string | null;
}>;

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export function fetchStaff(): Promise<{ staff: StaffMember[]; roles: StaffRole[] }> {
  return apiFetch("/api/staff");
}
export function fetchUnmatchedStaffNames(): Promise<Array<{ name: string; items: number }>> {
  return apiFetch("/api/staff/unmatched");
}
export function createStaff(input: StaffPatch & { name: string; roles?: StaffRole[] }): Promise<StaffMember> {
  return apiFetch("/api/staff", jsonInit("POST", input));
}
export function updateStaff(id: number, patch: StaffPatch): Promise<StaffMember> {
  return apiFetch(`/api/staff/${id}`, jsonInit("PATCH", patch));
}
export function setStaffRoles(id: number, roles: StaffRole[]): Promise<StaffMember> {
  return apiFetch(`/api/staff/${id}/roles`, jsonInit("PUT", { roles }));
}
/** `move` = take the name from whoever holds it (else a 409 says who). */
export function addStaffAlias(id: number, alias: string, move = false): Promise<StaffMember> {
  return apiFetch(`/api/staff/${id}/aliases`, jsonInit("POST", { alias, move }));
}
export function removeStaffAlias(id: number, alias: string): Promise<StaffMember> {
  return apiFetch(`/api/staff/${id}/aliases?alias=${encodeURIComponent(alias)}`, { method: "DELETE" });
}
export function refreshStaff(): Promise<StaffRefreshResult> {
  return apiFetch("/api/staff/sync", { method: "POST" });
}

// ---- Offboarding (apps/api/src/routes/staff-offboarding.ts) ----------------

export type OffboardingStep = "monday_seat" | "microsoft_365" | "ringcentral" | "slack";

export interface OffboardingState {
  staff: StaffMember;
  items: import("@case-pipeline/query").WorkloadAssignment[];
  record: {
    startedAt: string;
    startedBy: number | null;
    completedAt: string | null;
    steps: Partial<Record<OffboardingStep, { at: string; by: string | null }>>;
  } | null;
  steps: OffboardingStep[];
  /** false = seed data / no token: only the local mirror changes. */
  liveWrites: boolean;
  candidates: Array<{ id: number; name: string; roles: StaffRole[]; hasMonday: boolean }>;
  done: boolean;
  canComplete: boolean;
}

export interface OffboardingItemResult {
  source: import("@case-pipeline/query").WorkloadSource;
  localId: string;
  column: import("@case-pipeline/query").WorkloadColumn;
  outcome: "written" | "queued" | "local_only" | "skipped";
  reason?: string;
}

export function fetchOffboarding(staffId: number): Promise<OffboardingState> {
  return apiFetch(`/api/staff/${staffId}/offboarding`);
}
export function reassignOffboarding(
  staffId: number,
  assignments: Array<{ source: string; localId: string; column: string; toStaffId: number | null }>,
): Promise<OffboardingState & { results: OffboardingItemResult[] }> {
  return apiFetch(`/api/staff/${staffId}/offboarding/reassign`, jsonInit("POST", { assignments }));
}
export function patchOffboarding(
  staffId: number,
  patch: { step: OffboardingStep; done: boolean } | { deactivate: true } | { complete: true },
): Promise<OffboardingState> {
  return apiFetch(`/api/staff/${staffId}/offboarding`, jsonInit("PATCH", patch));
}

export function fetchAuditLog(
  limit = 100,
  offset = 0,
  filters: AuditFilters = {},
): Promise<AuditEntry[]> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (filters.actor != null) params.set("actor", String(filters.actor));
  if (filters.action) params.set("action", filters.action);
  if (filters.target) params.set("target", filters.target);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  return apiFetch<AuditEntry[]>(`/api/admin/audit?${params.toString()}`);
}

// ---- Mail intake: one piece of mail per upload, read on the server, kept only in the browser ----
export function scanMail(pdf: Blob, opts: { name: string; sample?: boolean }): Promise<MailScanResult> {
  const params = new URLSearchParams({ name: opts.name });
  if (opts.sample) params.set("sample", "1");
  return apiFetch<MailScanResult>(`/api/mail/scan?${params.toString()}`, {
    method: "POST",
    headers: { "Content-Type": "application/pdf" },
    body: pdf,
  });
}

/** A fake multi-notice scan built from the loaded DB — for trying the page.
 *  `scanned` returns the image-only variant, which exercises OCR. */
export async function fetchSampleMailPdf(scanned = false): Promise<Blob> {
  const res = await fetch(`/api/mail/sample.pdf${scanned ? "?scanned=1" : ""}`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`Could not load the sample PDF (HTTP ${res.status})`);
  return res.blob();
}

export function fetchMailDocument(id: number): Promise<MailDocument> {
  return apiFetch<MailDocument>(`/api/mail/documents/${id}`);
}

/** Just this notice's pages. Fetched as a blob because an iframe can't send the auth header. */
export async function fetchMailDocumentPdf(id: number): Promise<Blob> {
  const res = await fetch(`/api/mail/documents/${id}/pdf`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`Could not load the notice (HTTP ${res.status})`);
  return res.blob();
}

export function fetchOpenFormsFor(profileLocalId: string): Promise<MatchedOpenForm[]> {
  return apiFetch<MatchedOpenForm[]>(`/api/mail/open-forms?profile=${encodeURIComponent(profileLocalId)}`);
}

export interface MailClient {
  localId: string;
  name: string;
  email: string | null;
  /** The profile's E-File link (its CC folder is where mail goes). */
  eFile: string | null;
  openForms: MatchedOpenForm[];
}

export function fetchMailClient(profileLocalId: string): Promise<MailClient> {
  return apiFetch<MailClient>(`/api/mail/clients/${encodeURIComponent(profileLocalId)}`);
}

/** M32 "File it": after the browser saved the PDF to E-File → CC (and e-mailed the client). */
export function fileMailDocument(
  id: number,
  body: {
    profileLocalId: string;
    openFormLocalId: string | null;
    savedTo: { url: string; fileName: string; folder: string };
    emailedTo: string | null;
    note: string | null;
  },
): Promise<MailDocument & { note: "posted" | "queued" | "skipped" }> {
  return apiFetch(`/api/mail/documents/${id}/file`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export type ResolveMailBody =
  | { action: "assign"; openFormLocalId?: string; profileLocalId?: string; note?: string }
  | { action: "dismiss"; note: string };

export function resolveMailDocument(id: number, body: ResolveMailBody): Promise<MailDocument> {
  return apiFetch<MailDocument>(`/api/mail/documents/${id}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Exactly what Assign would write to Monday for this notice and Open Form. */
export function fetchMailWriteBackPlan(id: number, openFormLocalId: string): Promise<MailWriteBackPlan> {
  return apiFetch<MailWriteBackPlan>(
    `/api/mail/documents/${id}/writeback-plan?openForm=${encodeURIComponent(openFormLocalId)}`,
  );
}

/** Retry a failed or partial write-back; steps that already landed aren't redone. */
export function retryMailWriteBack(id: number): Promise<MailDocument> {
  return apiFetch<MailDocument>(`/api/mail/documents/${id}/writeback`, { method: "POST" });
}

/**
 * Correct what was read off a notice; the server re-matches on the result.
 * Validation problems come back per field rather than as one error.
 */
export async function updateMailFields(
  id: number,
  edits: FieldEdits,
): Promise<{ doc: MailDocument } | { fieldErrors: Record<string, string>; error: string }> {
  const res = await fetch(`/api/mail/documents/${id}/fields`, {
    method: "PATCH",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify(edits),
  });
  const body = (await res.json().catch(() => ({}))) as { data?: MailDocument; error?: string; fieldErrors?: Record<string, string> };
  if (res.ok && body.data) return { doc: body.data };
  if (body.fieldErrors) return { fieldErrors: body.fieldErrors, error: body.error ?? "Some fields aren't valid" };
  throw new Error(body.error ?? `HTTP ${res.status}`);
}

// =============================================================================
// Reception (P17) — consult prep
// =============================================================================

export const APPT_TYPES = ["1st time", "Trial Prep", "Standard Follow up", "Initial Court follow up", "Detained appt", "Emergency consultation", "Other"] as const;
export type ApptType = (typeof APPT_TYPES)[number];
export const PREP_METHODS = ["Phone", "Zoom", "Other"] as const;
export type PrepMethod = (typeof PREP_METHODS)[number];
/** Spanish and Portuguese are interpreted by the office; any other language, the client brings their own. */
export const INTERPRETER_NEEDS = ["No", "Spanish", "Portuguese", "Other language"] as const;
export type InterpreterNeed = (typeof INTERPRETER_NEEDS)[number];

export interface ReceptionConsult {
  localId: string;
  mondayItemId: string | null;
  boardKey: string;
  /** The attorney's board badge (R, M, LB…). */
  board: string;
  name: string;
  status: string | null;
  date: string | null;
  time: string | null;
  attorney: string | null;
  language: string | null;
  fromCalendly: boolean;
  phone: string | null;
  description: string | null;
  description2: string | null;
  profile: {
    localId: string; name: string; phone: string | null; eFile: string | null; consultFile: string | null;
    /** Case No. ("21164") — builds the default DMS link. */
    caseNo: string | null;
    /** The profile's DMS URL column, as stored. */
    dmsUrl: string | null;
  } | null;
  lastPrep: {
    at: string; author: string | null; apptType: string; method: string; pending: boolean;
    /** Interpreter language from the prep, null when none was needed. */
    interpreter: string | null;
  } | null;
  /** The folder name the consult sweep would use, or why the row's names can't build one. */
  folderName: { ok: true; folder: string; initial: string } | { ok: false; detail: string };
  /** Where the client is held, when known (Det. Facility, else read off a name) — pre-fills "Detained appt". */
  detainedAt: string | null;
  /** Detained by the shared rule (libs/query detention.ts); null when not. */
  detention: Detention | null;
  /** The Google Drive folder the client was sent to upload documents to, if known. */
  driveFolder: string | null;
  /** Other consults for the same client on the same day (a likely double booking). */
  sameDayCount: number;
}

// ---- P4 My Day -------------------------------------------------------------

/** What reception prepared for a consult (M18), as P4 shows it. */
export interface MyDayPrep {
  at: string;
  author: string | null;
  pending: boolean;
  apptType: string;
  method: "Phone" | "Zoom" | "Other";
  /** The number, the Zoom link, or the "specify" text. */
  methodDetail: string | null;
  interpreter: string;
  interpreterNeeded: boolean;
  description: string;
  documents: Array<{ name: string; url: string }>;
}

export interface MyDayEntry {
  localId: string;
  mondayItemId: string | null;
  boardKey: string;
  name: string;
  status: string | null;
  date: string | null;
  time: string | null;
  language: string | null;
  phone: string | null;
  clientWrote: string | null;
  description: string | null;
  detainedAt: string | null;
  detention: Detention | null;
  sameDayCount: number;
  prep: MyDayPrep | null;
  profile: ProfileSummary | null;
  updates: ClientUpdate[];
  caseSummary: ClientCaseSummary | null;
}

export interface MyDayResult {
  date: string;
  today: string;
  boardKey: string | null;
  /** The caller's own board (linked in Settings → Users, else matched by name). */
  myBoard: string | null;
  boards: Array<{ boardKey: string; displayName: string; attorneyName: string | null }>;
  entries: MyDayEntry[];
}

export function fetchMyDay(board?: string, date?: string): Promise<MyDayResult> {
  const params = new URLSearchParams();
  if (board) params.set("board", board);
  if (date) params.set("date", date);
  const qs = params.toString();
  return apiFetch<MyDayResult>(`/api/my-day${qs ? `?${qs}` : ""}`);
}

/**
 * What became of the post-consult process (the Consultation Summary in the
 * client's SharePoint CONSULT folder) the note starts: "disabled" when the
 * server has consult folders switched off.
 */
export type ConsultSummaryStart = "started" | "already-running" | "disabled" | "failed";

/**
 * The attorney's consult note → a "Consult note" E&A entry on the client's
 * profile, which also starts the post-consult process.
 */
/** Case type + fees quoted with the consult note; the Fee K auto-fill copies them onto the client's Fee K. */
export interface ConsultFees {
  caseType: string;
  newCaseType?: boolean;
  af: number | null;
  ff: number | null;
  pf: number | null;
}

export function postConsultNote(
  appointmentLocalId: string,
  note: string,
  fees?: ConsultFees | null,
): Promise<{ posted: true; pending: boolean; summary: ConsultSummaryStart; quoted?: boolean }> {
  return apiFetch(`/api/appointments/${encodeURIComponent(appointmentLocalId)}/consult-note`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fees ? { note, fees } : { note }),
  });
}

export interface ReceptionConsultsResult {
  from: string;
  to: string;
  today: string;
  consults: ReceptionConsult[];
  /** Det. Facility labels on the Court Cases board — M18's detention-center dropdown. */
  detentionFacilities: string[];
}

export function fetchReceptionConsults(from?: string, to?: string): Promise<ReceptionConsultsResult> {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const qs = params.toString();
  return apiFetch<ReceptionConsultsResult>(`/api/reception/consults${qs ? `?${qs}` : ""}`);
}

export interface PrepInput {
  apptType: ApptType;
  apptTypeOther?: string;
  /** Where the client is detained — required for "Detained appt". */
  detainedAt?: string;
  method: PrepMethod;
  phone?: string;
  zoomLink?: string;
  methodOther?: string;
  interpreter: { need: InterpreterNeed; language?: string; contact?: string };
  description: string;
  /** A Calendly client's words as corrected by reception — sent only when edited. */
  clientWrote?: string;
  documents: Array<{ name: string; url: string }>;
  /**
   * A folder found, created or pasted in M18 — saved to the profile. `replaces`
   * is the link it changes (the API only overwrites while Monday still holds it).
   */
  folderLinks?: Array<{ kind: "e_file" | "consult_file"; url: string; replaces?: string }>;
  /** The client's DMS record, when "Has DMS?" is ticked. */
  dmsUrl?: string;
}

/** DMS — the old CRM (cases until 2024). Same base as the API's DMS_RECORD_BASE. */
export const DMS_RECORD_BASE = "https://sharmacrawford-cdb.innovationlawlab.org/records/";

export function prepConsult(
  appointmentLocalId: string,
  input: PrepInput,
): Promise<{ prepped: true; pending: boolean; wroteBack: string[] }> {
  return apiFetch(`/api/reception/consults/${encodeURIComponent(appointmentLocalId)}/prep`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

/** Copy a document picked or uploaded during prep into the appointment's Files column in Monday. */
export function attachConsultFile(appointmentLocalId: string, file: Blob, name: string): Promise<{ attached: true }> {
  const params = new URLSearchParams({ name });
  if (file.type) params.set("type", file.type);
  return apiFetch(`/api/reception/consults/${encodeURIComponent(appointmentLocalId)}/files?${params.toString()}`, {
    method: "POST",
    // Always octet-stream: the real type rides in ?type= (see routes/reception.ts).
    headers: { "Content-Type": "application/octet-stream" },
    body: file,
  });
}

// -----------------------------------------------------------------------------
// Slack queue — M18 step 2 + P17's Slack Queue tab (routes/slack-queue.ts)
// -----------------------------------------------------------------------------

/** Whether the "Consult ready" Slack event would post right now, and where. */
export interface SlackEventStatus {
  mode: "off" | "dry-run" | "on";
  enabled: boolean;
  channel: string | null;
}

export interface SlackQueued {
  id: number;
  kind: "consult_ready";
  appointmentMondayId: string | null;
  boardKey: string | null;
  /** Slack mrkdwn: *bold*, <url|label>, <@U…>. */
  text: string;
  sendAt: string;
  /** Firm time, for the edit fields. */
  sendDate: string;
  sendTime: string;
  status: "queued" | "sending" | "sent" | "failed";
  dryRun: boolean;
  error: string | null;
  sentAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface SlackDraft {
  draft: { text: string; sendDate: string; sendTime: string };
  /** The message already waiting for this consult (queueing again replaces it). */
  existing: SlackQueued | null;
  attorney: string | null;
  attorneyHasSlack: boolean;
  slack: SlackEventStatus;
}

export function fetchSlackDraft(appointmentLocalId: string): Promise<SlackDraft> {
  return apiFetch<SlackDraft>(`/api/reception/consults/${encodeURIComponent(appointmentLocalId)}/slack-draft`);
}

export interface SlackQueueInput {
  text: string;
  sendDate: string;
  sendTime: string;
}

export function queueConsultSlack(
  appointmentLocalId: string,
  input: SlackQueueInput,
): Promise<{ queued: SlackQueued; replaced: boolean; slack: SlackEventStatus }> {
  return apiFetch(`/api/reception/consults/${encodeURIComponent(appointmentLocalId)}/slack`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export interface SlackQueueMessage extends SlackQueued {
  badge: string | null;
  /** The consult as it is now — null when it was deleted in Monday. */
  appointment: { localId: string; client: string; date: string | null; time: string | null; attorney: string | null } | null;
}

export function fetchSlackQueue(): Promise<{ today: string; slack: SlackEventStatus; messages: SlackQueueMessage[] }> {
  return apiFetch("/api/reception/slack-queue");
}

/** Edit words / time. A failed message goes back in the queue (Retry). */
export function editSlackQueued(id: number, patch: Partial<SlackQueueInput>): Promise<SlackQueued> {
  return apiFetch(`/api/reception/slack-queue/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export function deleteSlackQueued(id: number): Promise<{ deleted: true }> {
  return apiFetch(`/api/reception/slack-queue/${id}`, { method: "DELETE" });
}

/** An attorney M20 can move a consult to — one per active appointment board. */
export interface ReceptionAttorney {
  boardKey: string;
  /** The board badge (R, M, LB…). */
  badge: string;
  attorney: string | null;
}

export function fetchReceptionAttorneys(): Promise<ReceptionAttorney[]> {
  return apiFetch<ReceptionAttorney[]>("/api/reception/attorneys");
}

/** Connect an unlinked consult to a client's profile (writes the appointment's Profiles column). */
export function linkConsultProfile(
  appointmentLocalId: string,
  profileLocalId: string,
): Promise<{ profileLocalId: string; profileName: string; pending: boolean }> {
  return apiFetch(`/api/reception/consults/${encodeURIComponent(appointmentLocalId)}/profile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profileLocalId }),
  });
}

/** Change a consult's date, time and/or attorney (a new attorney moves it to their board). */
export function rescheduleConsult(
  appointmentLocalId: string,
  input: { date: string; time: string; boardKey: string },
): Promise<{ boardKey: string; date: string; time: string | null; attorney: string | null; moved: boolean; pending: boolean }> {
  return apiFetch(`/api/reception/consults/${encodeURIComponent(appointmentLocalId)}/schedule`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
