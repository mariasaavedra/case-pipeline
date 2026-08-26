// =============================================================================
// API Route Handlers
// =============================================================================

import type BetterSqlite3 from "better-sqlite3";
type Database = BetterSqlite3.Database;
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
  getAppointments,
  searchByType,
  getAlerts,
  getActiveCases,
  getCallLogEntries,
  getCallLogStaffOptions,
} from "@case-pipeline/query";
import type { SearchType, TimelineSourceType, TimelineCategory } from "@case-pipeline/query";

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

  // Optional ?types=email,note filter over the unified timeline. Unknown values
  // are dropped; an all-invalid list falls through to the unified view.
  const VALID_TYPES = new Set(["update", "reply", "email", "note", "activity", "custom"]);
  const typesParam = url.searchParams.get("types");
  const types = typesParam
    ? (typesParam
        .split(",")
        .map((t) => t.trim())
        .filter((t) => VALID_TYPES.has(t)) as TimelineSourceType[])
    : undefined;

  // Optional ?category=notes — the timeline chip filter, applied server-side so
  // a filtered view is complete, not just the newest page filtered down. Takes
  // precedence over ?types when both are present.
  const VALID_CATEGORIES = new Set(["all", "notes"]);
  const categoryParam = url.searchParams.get("category");
  const category =
    categoryParam && VALID_CATEGORIES.has(categoryParam)
      ? (categoryParam as TimelineCategory)
      : undefined;

  // Optional ?from=YYYY-MM-DD&to=YYYY-MM-DD — inclusive calendar-day bounds.
  // Anything not in that exact shape is ignored rather than rejected: a bad
  // date should widen the view, never 400 a client's whole timeline.
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const dateParam = (name: string): string | undefined => {
    const v = url.searchParams.get(name);
    return v && DATE_RE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? v : undefined;
  };
  const from = dateParam("from");
  const to = dateParam("to");

  const updates = getClientUpdates(
    db, localId, limit, offset,
    types && types.length ? types : undefined,
    category,
    from || to ? { from, to } : undefined,
  );
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

// NOTE: the dashboard has no handler here. Its per-card display column depends
// on the authenticated user, which these Fetch-style handlers don't carry, so
// /api/dashboard is defined inline in server.ts.

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

// NOTE: /api/active-cases is defined inline in server.ts — it folds in the
// firm's editable urgency config (thresholds + per-status urgency), which these
// Fetch-style handlers don't carry. Kept here only for reference/back-compat.
export function handleActiveCases(req: Request, db: Database): Response {
  const url = new URL(req.url);
  const includeSnoozed = url.searchParams.get("includeSnoozed") === "1";
  const result = getActiveCases(db, { includeSnoozed });
  return json(result);
}

export function handleFilterOptions(_req: Request, db: Database): Response {
  const options = getFilterOptions(db);
  return json(options);
}

export function handleCallLog(req: Request, db: Database): Response {
  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? undefined;
  const takenBy = url.searchParams.get("takenBy") ?? undefined;
  const dateFrom = url.searchParams.get("dateFrom") ?? undefined;
  const dateTo = url.searchParams.get("dateTo") ?? undefined;
  const unlinkedOnly = url.searchParams.get("unlinkedOnly") === "1";
  // `?? "50"` then `|| 50` treats an explicit limit=0 as unset (0 is falsy) —
  // check presence explicitly so limit=0 means "zero rows", not "default".
  const limitParam = url.searchParams.get("limit");
  const offsetParam = url.searchParams.get("offset");
  const limit = limitParam !== null ? Math.max(0, Math.min(parseInt(limitParam, 10) || 0, 200)) : 50;
  const offset = offsetParam !== null ? Math.max(0, parseInt(offsetParam, 10) || 0) : 0;

  const result = getCallLogEntries(db, { status, takenBy, dateFrom, dateTo, unlinkedOnly, limit, offset });
  const staffOptions = getCallLogStaffOptions(db);
  return json({ ...result, staffOptions });
}

// =============================================================================
// Param Extraction
// =============================================================================

/**
 * Extract a route parameter from the request.
 * Express attaches params to the request object.
 */
function extractParam(req: Request, name: string): string | undefined {
  return (req as any).params?.[name];
}
