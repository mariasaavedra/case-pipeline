// =============================================================================
// Audit query filters
// =============================================================================
// These are the queries the per-user activity view and the case history will be
// built on, so the clause has to be right before anything reads it.

import { describe, test, expect } from "vitest";
import { buildAuditQuery } from "./audit-query.js";

describe("buildAuditQuery", () => {
  test("no filters means no WHERE clause", () => {
    expect(buildAuditQuery({})).toEqual({ clause: "", params: [] });
  });

  test("filters by actor", () => {
    const q = buildAuditQuery({ actor: "7" });
    expect(q.clause).toBe(" WHERE actor_user_id = ?");
    expect(q.params).toEqual([7]);
  });

  test("ignores a non-numeric or non-positive actor rather than erroring", () => {
    expect(buildAuditQuery({ actor: "abc" }).params).toEqual([]);
    expect(buildAuditQuery({ actor: "0" }).params).toEqual([]);
    expect(buildAuditQuery({ actor: "-3" }).params).toEqual([]);
  });

  test("an action prefix matches the whole family", () => {
    // ?action=monday should return status_changed, update_posted, and the rest,
    // which is how "everything written to Monday yesterday" gets asked.
    const q = buildAuditQuery({ action: "monday" });
    expect(q.clause).toBe(" WHERE (action = ? OR action LIKE ?)");
    expect(q.params).toEqual(["monday", "monday.%"]);
  });

  test("an exact action still matches itself", () => {
    expect(buildAuditQuery({ action: "monday.status_changed" }).params).toEqual([
      "monday.status_changed",
      "monday.status_changed.%",
    ]);
  });

  test("filters by the stable Monday target id, not the local one", () => {
    const q = buildAuditQuery({ target: "123456" });
    expect(q.clause).toBe(" WHERE target_monday_id = ?");
    expect(q.params).toEqual(["123456"]);
  });

  test("a date range bounds both ends, with `to` inclusive of its own day", () => {
    const q = buildAuditQuery({ from: "2026-03-01", to: "2026-03-31" });
    expect(q.clause).toBe(" WHERE created_at >= ? AND created_at < ?");
    // Not '2026-03-31', which would drop everything logged that day.
    expect(q.params).toEqual(["2026-03-01", "2026-04-01"]);
  });

  test("the `to` rollover crosses a year boundary", () => {
    expect(buildAuditQuery({ to: "2026-12-31" }).params).toEqual(["2027-01-01"]);
  });

  test("malformed dates are dropped, not rejected", () => {
    expect(buildAuditQuery({ from: "yesterday", to: "31/03/2026" }).params).toEqual([]);
  });

  test("filters compose in a stable order", () => {
    const q = buildAuditQuery({ actor: "2", action: "monday", target: "999", from: "2026-01-01" });
    expect(q.clause).toBe(
      " WHERE actor_user_id = ? AND (action = ? OR action LIKE ?) AND target_monday_id = ? AND created_at >= ?",
    );
    expect(q.params).toEqual([2, "monday", "monday.%", "999", "2026-01-01"]);
  });

  test("every filter is parameterised — no value reaches the SQL string", () => {
    const q = buildAuditQuery({ action: "'; DROP TABLE audit_log; --", target: "x' OR '1'='1" });
    expect(q.clause).not.toContain("DROP");
    expect(q.clause).not.toContain("1'='1");
    expect(q.params).toContain("'; DROP TABLE audit_log; --");
  });
});
