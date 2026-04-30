// =============================================================================
// API Route Handlers
// =============================================================================

import type { Database } from "bun:sqlite";
import {
  searchClients,
  listProfilesFiltered,
  getFilterOptions,
  getClientCaseSummary,
  getClientContracts,
  getClientBoardItems,
  getBoardItemDetail,
  getClientUpdates,
  getClientRelationships,
  getDashboardKpis,
  getAppointments,
  searchByType,
  getAlerts,
} from "../query";
import type { SearchType } from "../query";

// =============================================================================
// Helpers
// =============================================================================

function json(data: unknown, status = 200): Response {
  return Response.json({ data }, { status });
}

function error(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

// =============================================================================
// Handlers
// =============================================================================

export function handleListClients(req: Request, db: Database): Response {
  const url = new URL(req.url);
  const limitParam = url.searchParams.get("limit");
  const offsetParam = url.searchParams.get("offset");

  const limit = limitParam
    ? Math.max(1, Math.min(parseInt(limitParam, 10) || 50, 200))
    : 50;
  const offset = offsetParam
    ? Math.max(0, parseInt(offsetParam, 10) || 0)
    : 0;

  // Check if any filters are present
  const status = url.searchParams.get("status") ?? undefined;
  const priority = url.searchParams.get("priority") ?? undefined;
  const attorney = url.searchParams.get("attorney") ?? undefined;
  const boardType = url.searchParams.get("board_type") ?? undefined;
  const dateFrom = url.searchParams.get("date_from") ?? undefined;
  const dateTo = url.searchParams.get("date_to") ?? undefined;

  const result = listProfilesFiltered(db, {
    limit, offset, status, priority, attorney, boardType, dateFrom, dateTo,
  });
  return json(result);
}

export function handleSearch(req: Request, db: Database): Response {
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();

  if (!q) {
    return error("Missing required query parameter: q", 400);
  }

  try {
    const results = searchClients(db, q);
    return json(results);
  } catch {
    return error("Invalid search query", 400);
  }
}

export function handleClientDetail(req: Request, db: Database): Response {
  const localId = extractParam(req, "localId");
  if (!localId) return error("Missing localId", 400);

  const summary = getClientCaseSummary(db, localId);
  if (!summary) return error("Client not found", 404);

  return json(summary);
}

export function handleClientContracts(req: Request, db: Database): Response {
  const localId = extractParam(req, "localId");
  if (!localId) return error("Missing localId", 400);

  const contracts = getClientContracts(db, localId);
  return json(contracts);
}

export function handleClientBoardItems(req: Request, db: Database): Response {
  const localId = extractParam(req, "localId");
  if (!localId) return error("Missing localId", 400);

  const items = getClientBoardItems(db, localId);
  return json(items);
}

export function handleBoardItemDetail(req: Request, db: Database): Response {
  const localId = extractParam(req, "localId");
  if (!localId) return error("Missing localId", 400);

  const item = getBoardItemDetail(db, localId);
  if (!item) return error("Board item not found", 404);

  return json(item);
}

export function handleClientUpdates(req: Request, db: Database): Response {
  const localId = extractParam(req, "localId");
  if (!localId) return error("Missing localId", 400);

  const url = new URL(req.url);
  const limitParam = url.searchParams.get("limit");
  const offsetParam = url.searchParams.get("offset");
  const limit = limitParam
    ? Math.max(1, Math.min(parseInt(limitParam, 10) || 50, 200))
    : 50;
  const offset = offsetParam
    ? Math.max(0, parseInt(offsetParam, 10) || 0)
    : 0;

  const updates = getClientUpdates(db, localId, limit, offset);
  return json(updates);
}

export function handleClientRelationships(req: Request, db: Database): Response {
  const localId = extractParam(req, "localId");
  if (!localId) return error("Missing localId", 400);

  const relationships = getClientRelationships(db, localId);
  return json(relationships);
}

export function handleAppointments(req: Request, db: Database): Response {
  const url = new URL(req.url);
  const attorney = url.searchParams.get("attorney") ?? undefined;
  const rangeParam = url.searchParams.get("range");
  const validRanges = ["day", "week", "upcoming", "all"] as const;
  const range = validRanges.includes(rangeParam as any) ? (rangeParam as typeof validRanges[number]) : "day";
  const date = url.searchParams.get("date") ?? undefined;

  const result = getAppointments(db, { attorney, range, date });
  return json(result);
}

export function handleDashboard(req: Request, db: Database): Response {
  const url = new URL(req.url);
  const rangeParam = url.searchParams.get("hearingRange");
  const range = rangeParam === "month" ? "month" : "7d";

  const cards = getDashboardKpis(db, { range });
  return json(cards);
}

export function handleTypedSearch(req: Request, db: Database): Response {
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();
  const type = (url.searchParams.get("type") ?? "profiles") as SearchType;

  if (!q) {
    return error("Missing required query parameter: q", 400);
  }

  try {
    if (type === "profiles") {
      const results = searchClients(db, q);
      return json(results);
    }
    const results = searchByType(db, q, type);
    return json(results);
  } catch {
    return error("Invalid search query", 400);
  }
}

export function handleAlerts(req: Request, db: Database): Response {
  const url = new URL(req.url);
  const attorney = url.searchParams.get("attorney") ?? undefined;
  const result = getAlerts(db, { attorney });
  return json(result);
}

export function handleFilterOptions(_req: Request, db: Database): Response {
  const options = getFilterOptions(db);
  return json(options);
}

// =============================================================================
// Param Extraction
// =============================================================================

/**
 * Extract a route parameter from the request.
 * Bun.serve() attaches params to the request object.
 */
function extractParam(req: Request, name: string): string | undefined {
  return (req as any).params?.[name];
}
