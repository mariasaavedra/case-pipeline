// =============================================================================
// API Client — Typed fetch wrappers
// =============================================================================

import type { SearchResult, ClientCaseSummary } from "../lib/query/types";

export type { SearchResult, ClientCaseSummary, ProfileSummary, ContractSummary, BoardItemSummary } from "../lib/query/types";

async function apiFetch<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const body = await res.json();
  if (body.error) throw new Error(body.error);
  return body.data as T;
}

export async function searchClients(query: string): Promise<SearchResult[]> {
  return apiFetch<SearchResult[]>(`/api/clients/search?q=${encodeURIComponent(query)}`);
}

export async function getClient(localId: string): Promise<ClientCaseSummary> {
  return apiFetch<ClientCaseSummary>(`/api/clients/${encodeURIComponent(localId)}`);
}
