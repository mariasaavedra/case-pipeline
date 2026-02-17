// =============================================================================
// API Route Handlers
// =============================================================================

import type { Database } from "bun:sqlite";
import {
  searchClients,
  getClientCaseSummary,
  getClientContracts,
  getClientBoardItems,
  getBoardItemDetail,
} from "../query";

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

export function handleSearch(req: Request, db: Database): Response {
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();

  if (!q) {
    return error("Missing required query parameter: q", 400);
  }

  const results = searchClients(db, q);
  return json(results);
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
