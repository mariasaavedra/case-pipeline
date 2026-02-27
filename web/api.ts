// =============================================================================
// API Client — Typed fetch wrappers
// =============================================================================

import type { SearchResult, ClientCaseSummary, ClientUpdate, KpiCard } from "../lib/query/types";
import type { RelationshipWithDetails } from "../lib/query/relationships";

export type { SearchResult, ClientCaseSummary, ProfileSummary, ContractSummary, BoardItemSummary, ClientUpdate, KpiCard, KpiItem } from "../lib/query/types";
export type { RelationshipWithDetails } from "../lib/query/relationships";

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

export async function getClient(localId: string): Promise<ClientCaseSummary> {
  return apiFetch<ClientCaseSummary>(`/api/clients/${encodeURIComponent(localId)}`);
}

export async function fetchClientUpdates(localId: string, limit = 50, offset = 0): Promise<ClientUpdate[]> {
  return apiFetch<ClientUpdate[]>(`/api/clients/${encodeURIComponent(localId)}/updates?limit=${limit}&offset=${offset}`);
}

export async function fetchClientRelationships(localId: string): Promise<RelationshipWithDetails[]> {
  return apiFetch<RelationshipWithDetails[]>(`/api/clients/${encodeURIComponent(localId)}/relationships`);
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
