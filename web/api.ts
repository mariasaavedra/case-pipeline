// =============================================================================
// API Client — Typed fetch wrappers
// =============================================================================

import type { SearchResult, ClientCaseSummary, ClientUpdate, KpiCard, TypedSearchResult, SearchType } from "../lib/query/types";
import type { RelationshipWithDetails } from "../lib/query/relationships";
import type { AppointmentsResult } from "../lib/query/appointments";
import type { FilteredProfileResult, FilterOptions, ProfileFilterOptions } from "../lib/query/client";
import type { AlertsResult } from "../lib/query/types";

export type { SearchResult, ClientCaseSummary, ProfileSummary, ContractSummary, BoardItemSummary, ClientUpdate, KpiCard, KpiItem, TypedSearchResult, SearchType } from "../lib/query/types";
export type { AlertsResult, AlertGroup, AlertItem, AlertSeverity } from "../lib/query/types";
export type { RelationshipWithDetails } from "../lib/query/relationships";
export type { AppointmentsResult, AppointmentEntry, AppointmentSnapshot } from "../lib/query/appointments";
export type { FilteredProfileResult, FilterOptions, ProfileFilterOptions } from "../lib/query/client";

async function apiFetch<T>(url: string): Promise<T> {
  const res = await fetch(url);

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
  const res = await fetch(url, signal ? { signal } : undefined);

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
  const res = await fetch(url, signal ? { signal } : undefined);

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

export async function fetchAlerts(attorney?: string): Promise<AlertsResult> {
  const params = new URLSearchParams();
  if (attorney) params.set("attorney", attorney);
  const qs = params.toString();
  return apiFetch<AlertsResult>(`/api/alerts${qs ? `?${qs}` : ""}`);
}

export async function fetchDashboard(hearingRange?: string): Promise<KpiCard[]> {
  const params = hearingRange ? `?hearingRange=${encodeURIComponent(hearingRange)}` : "";
  const res = await fetch(`/api/dashboard${params}`);

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
