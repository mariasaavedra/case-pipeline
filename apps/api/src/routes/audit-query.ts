// =============================================================================
// Audit log query filters
// =============================================================================
// Kept in its own module, free of any database import, so the clause-building
// can be tested without opening users.db as a side effect (importing the db
// module creates and migrates the real file).
//
// Each filter maps onto an index added in users.db v11. Before those, "what did
// this person do yesterday" and "everything that happened to this case" meant
// fetching the newest page and filtering it by hand — which stops being true
// the moment the log outgrows that page, silently.
// =============================================================================

export interface AuditFilter {
  actor?: unknown;
  action?: unknown;
  target?: unknown;
  from?: unknown;
  to?: unknown;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Build a WHERE clause and its bound parameters.
 *
 * Unrecognised or malformed values are dropped rather than rejected: an audit
 * view that errors on a stray character is a view nobody consults. Every value
 * is parameterised — none is ever interpolated into the SQL.
 */
export function buildAuditQuery(q: AuditFilter): { clause: string; params: (string | number)[] } {
  const where: string[] = [];
  const params: (string | number)[] = [];

  const actor = Number(q.actor);
  if (Number.isInteger(actor) && actor > 0) {
    where.push("actor_user_id = ?");
    params.push(actor);
  }

  const action = typeof q.action === "string" ? q.action.trim() : "";
  if (action) {
    // Prefix match so ?action=monday returns the whole family.
    where.push("(action = ? OR action LIKE ?)");
    params.push(action, `${action}.%`);
  }

  const target = typeof q.target === "string" ? q.target.trim() : "";
  if (target) {
    where.push("target_monday_id = ?");
    params.push(target);
  }

  const from = typeof q.from === "string" && DATE_RE.test(q.from) ? q.from : "";
  if (from) {
    where.push("created_at >= ?");
    params.push(from);
  }

  const to = typeof q.to === "string" && DATE_RE.test(q.to) ? q.to : "";
  if (to) {
    // created_at is a 'YYYY-MM-DD HH:MM:SS' string, so an inclusive `to` has to
    // bound exclusively against the next day or it drops that day's entries.
    const next = new Date(`${to}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    where.push("created_at < ?");
    params.push(next.toISOString().slice(0, 10));
  }

  return { clause: where.length ? ` WHERE ${where.join(" AND ")}` : "", params };
}
