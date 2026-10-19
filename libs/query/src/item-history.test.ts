import { describe, test, expect } from "vitest";
import Database from "better-sqlite3";
import { initializeSchema } from "@case-pipeline/seed/db/schema";
import { batchGetItemHistory, dateMoves, statusChanges, type ItemChange } from "./item-history";

const STATUS = "color_mkrjc7n8";
const HEARING = "date_mkrjnbth";
const change = (changedAt: string, o: Partial<ItemChange>): ItemChange => ({
  changedAt, source: "activity_log", eventType: "update_column_value", columnId: STATUS, columnTitle: "Calendaring Status",
  columnType: "color", from: null, to: null, userId: "32138066", ...o,
});
const created = change("2026-07-11T02:52:00Z", { eventType: "create_pulse", columnId: null, columnTitle: null, columnType: null });

describe("statusChanges", () => {
  test("data entry in the first hour and the first value set are left out", () => {
    const out = statusChanges([
      created,
      change("2026-07-11T02:53:00Z", { from: null, to: "Check dates", userId: "-4" }),
      change("2026-07-11T02:58:00Z", { from: "Check dates", to: "Added on Cal" }), // still setup
      change("2026-08-04T14:00:00Z", { from: "Added on Cal", to: "MR Hearing Confirmed" }),
    ], STATUS);
    expect(out.map((c) => [c.day, c.from, c.to])).toEqual([["2026-08-04", "Added on Cal", "MR Hearing Confirmed"]]);
  });

  test("a day's changes collapse to first → last; a day that ends where it began drops out", () => {
    const out = statusChanges([
      created,
      change("2026-09-30T14:00:00Z", { from: "On Calendar", to: "PASSED" }),
      change("2026-09-30T19:00:00Z", { from: "PASSED", to: "ATTENDED" }),
      change("2026-10-01T14:00:00Z", { from: "ATTENDED", to: "Check dates" }),
      change("2026-10-01T14:05:00Z", { from: "Check dates", to: "ATTENDED" }),
    ], STATUS);
    expect(out.map((c) => [c.day, c.from, c.to])).toEqual([["2026-09-30", "On Calendar", "ATTENDED"]]);
  });

  test("group moves count; other columns don't", () => {
    const out = statusChanges([
      change("2026-09-01T14:00:00Z", { eventType: "move_pulse_from_group", columnId: null, columnTitle: "Group", columnType: "group", from: "UPCOMING", to: "COURT RESCHEDULED / CONTINUED" }),
      change("2026-09-02T14:00:00Z", { columnId: "color_type", columnTitle: "Type", from: "Master", to: "Trial" }),
    ], STATUS);
    expect(out.map((c) => [c.columnType, c.to])).toEqual([["group", "COURT RESCHEDULED / CONTINUED"]]);
  });

  test("automations are left out (they move every consult to Past Consults)", () => {
    const out = statusChanges([
      change("2026-09-01T14:00:00Z", { eventType: "move_pulse_from_group", columnId: null, columnTitle: "Group", columnType: "group", from: "Today's consults", to: "Past Consults", userId: "-4" }),
      change("2026-09-02T14:00:00Z", { from: "Check dates", to: "PASSED", userId: "-4" }),
      change("2026-09-02T18:00:00Z", { columnId: STATUS, from: "PASSED", to: "Check dates", userId: "-12" }), // another Monday system user
      change("2026-09-03T14:00:00Z", { from: "PASSED", to: "ATTENDED", userId: "32138066" }),
    ], STATUS);
    expect(out.map((c) => c.to)).toEqual(["ATTENDED"]);
  });

  test("the firm's day, not UTC's", () => {
    const out = statusChanges([change("2026-10-02T03:30:00Z", { from: "A", to: "B" })], STATUS, "America/Chicago");
    expect(out[0]?.day).toBe("2026-10-01");
  });
});

describe("dateMoves", () => {
  const hearing = (at: string, from: string | null, to: string | null) =>
    change(at, { columnId: HEARING, columnTitle: "Hearing Date - Calendaring", columnType: "date", from, to });

  test("a moved date: from one date to another, after the first day", () => {
    const out = dateMoves([
      created,
      hearing("2026-07-11T03:00:00Z", null, "2026-08-14"),
      hearing("2026-07-11T03:01:00Z", "2026-08-14", "2026-08-20"), // typo fixed while entering
      hearing("2026-08-04T15:00:00Z", "2026-08-20", "2026-09-30"),
      // Cleared and set again the same day = one move.
      hearing("2026-09-29T15:00:00Z", "2026-09-30", null),
      hearing("2026-09-29T15:02:00Z", null, "2026-11-20 09:00"),
    ], HEARING);
    expect(out.map((c) => [c.day, c.from, c.to])).toEqual([
      ["2026-08-04", "2026-08-20", "2026-09-30"],
      ["2026-09-29", "2026-09-30", "2026-11-20 09:00"],
    ]);
  });

  test("a new time on the same day is not a move", () => {
    expect(dateMoves([hearing("2026-08-04T15:00:00Z", "2026-11-20 09:00", "2026-11-20 13:30")], HEARING)).toEqual([]);
  });

  test("cleared for good is not a move", () => {
    expect(dateMoves([hearing("2026-08-04T15:00:00Z", "2026-08-20", null)], HEARING)).toEqual([]);
  });
});

describe("batchGetItemHistory", () => {
  test("oldest first, per item; link / subitem / people noise and no-op changes out", () => {
    const db = new Database(":memory:");
    initializeSchema(db);
    const ins = db.prepare(
      `INSERT INTO item_events (source, activity_log_id, event_type, monday_item_id, column_id, column_title, column_type, previous_text, value_text, monday_user_id, changed_at)
       VALUES ('activity_log', ?, ?, ?, ?, ?, ?, ?, ?, '1', ?)`,
    );
    ins.run("a", "update_column_value", "555", STATUS, "Calendaring Status", "color", "A", "B", "2026-09-02T00:00:00Z");
    ins.run("b", "create_pulse", "555", null, null, null, null, null, "2026-09-01T00:00:00Z");
    ins.run("c", "update_column_value", "555", "rel", "Profile", "board-relation", null, "123", "2026-09-03T00:00:00Z");
    ins.run("d", "update_column_value", "555", "ppl", "Paralegal", "multiple-person", null, "999", "2026-09-03T00:00:00Z");
    ins.run("e", "update_column_value", "555", STATUS, "Calendaring Status", "color", "B", "B", "2026-09-04T00:00:00Z");
    ins.run("f", "update_column_value", "777", STATUS, "Calendaring Status", "color", "X", "Y", "2026-09-05T00:00:00Z");
    const h = batchGetItemHistory(db, ["555", "777", "none"]);
    expect(h.get("555")?.map((c) => c.eventType + ":" + (c.to ?? ""))).toEqual(["create_pulse:", "update_column_value:B"]);
    expect(h.get("777")).toHaveLength(1);
    expect(h.has("none")).toBe(false);
  });
});
