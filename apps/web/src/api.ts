// =============================================================================
// API Client — Typed fetch wrappers
// =============================================================================

import type { SearchResult, ClientCaseSummary, ClientUpdate, KpiCard, TypedSearchResult, SearchType } from "@case-pipeline/query/types";
import type { RelationshipWithDetails } from "@case-pipeline/query/relationships";
import type { AppointmentsResult } from "@case-pipeline/query/appointments";
import type { FilteredProfileResult, FilterOptions, ProfileFilterOptions } from "@case-pipeline/query/client";
import type { AlertsResult } from "@case-pipeline/query/types";
import type { ActiveCasesResult, ActiveCase } from "@case-pipeline/query";

export type { SearchResult, ClientCaseSummary, ProfileSummary, ContractSummary, BoardItemSummary, ClientUpdate, KpiCard, KpiItem, TypedSearchResult, SearchType } from "@case-pipeline/query/types";
export type { AlertsResult, AlertGroup, AlertItem, AlertSeverity } from "@case-pipeline/query/types";
export type { RelationshipWithDetails } from "@case-pipeline/query/relationships";
export type { AppointmentsResult, AppointmentEntry, AppointmentSnapshot } from "@case-pipeline/query/appointments";
export type { FilteredProfileResult, FilterOptions, ProfileFilterOptions } from "@case-pipeline/query/client";
export type { ActiveCasesResult, ActiveCasesAssignee, ActiveCase, Urgency } from "@case-pipeline/query";

let _tokenGetter: (() => Promise<string | null>) | null = null;

export function setTokenGetter(fn: () => Promise<string | null>) {
  _tokenGetter = fn;
}

async function authHeaders(): Promise<Record<string, string>> {
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

export async function fetchClientUpdates(localId: string, limit = 50, offset = 0): Promise<ClientUpdate[]> {
  return apiFetch<ClientUpdate[]>(`/api/clients/${encodeURIComponent(localId)}/updates?limit=${limit}&offset=${offset}`);
}

export async function fetchClientRelationships(localId: string): Promise<RelationshipWithDetails[]> {
  return apiFetch<RelationshipWithDetails[]>(`/api/clients/${encodeURIComponent(localId)}/relationships`);
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

export async function fetchActiveCases(): Promise<ActiveCasesResult> {
  return apiFetch<ActiveCasesResult>("/api/active-cases");
}

export async function fetchAlerts(attorney?: string): Promise<AlertsResult> {
  const params = new URLSearchParams();
  if (attorney) params.set("attorney", attorney);
  const qs = params.toString();
  return apiFetch<AlertsResult>(`/api/alerts${qs ? `?${qs}` : ""}`);
}

// =============================================================================
// Attorney Boards Settings
// =============================================================================

export interface AttorneyBoard {
  boardKey: string;
  mondayBoardId: string;
  displayName: string;
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

export async function fetchMondayStatus(): Promise<{ connected: boolean; mondayName?: string }> {
  return apiFetch<{ connected: boolean; mondayName?: string }>("/api/auth/monday/status");
}

export async function getAzureToken(): Promise<string | null> {
  if (!_tokenGetter) return null;
  return _tokenGetter();
}

// =============================================================================
// Profile Write-Back
// =============================================================================

export async function postProfileUpdate(profileLocalId: string, text: string): Promise<ClientUpdate> {
  return apiFetch<ClientUpdate>(`/api/profiles/${encodeURIComponent(profileLocalId)}/updates`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
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
  dashboardLayout: string[];
  columns: Record<string, string[]>;
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
  phone_ext: string | null;
  login_count: number;
  last_active_at: string | null;
  mondayConnected: boolean;
}

export interface MyCasesResult {
  needsLink: boolean;
  paralegalLink: string | null;
  cases: ActiveCase[];
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
  targetId: string | null;
  metadata: unknown;
  createdAt: string;
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
export function getMyCases(): Promise<MyCasesResult> {
  return apiFetch<MyCasesResult>("/api/my-cases");
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
export function updateAdminUser(
  id: number,
  patch: { job_title?: string | null; paralegal_link?: string | null; active?: boolean },
): Promise<PublicUser> {
  return apiFetch<PublicUser>(`/api/admin/users/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}
export function fetchAuditLog(limit = 100, offset = 0): Promise<AuditEntry[]> {
  return apiFetch<AuditEntry[]>(`/api/admin/audit?limit=${limit}&offset=${offset}`);
}
