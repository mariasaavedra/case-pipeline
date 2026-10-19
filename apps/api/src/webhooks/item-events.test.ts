import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initializeSchema } from "@case-pipeline/seed/db/schema";
import { activityLogTime, fromActivityLog, insertHistoryEvents, readableValue, recordItemEvents, type ActivityLogEntry } from "./item-events.js";
import { prune } from "./processor.js";

// Value shapes below are what Monday sends, sampled from the production inbox.

describe("readableValue", () => {
  it("reads each column type the way a person would", () => {
    expect(readableValue({ label: { index: 1, text: "ATTENDED", style: {} }, post_id: null }, "color")).toBe("ATTENDED");
    expect(readableValue({ date: "2026-10-17", icon: null, time: null }, "date")).toBe("2026-10-17");
    // A UTC time is shown in the firm's time, as the sync stores it (CDT = UTC-5).
    expect(readableValue({ date: "2026-10-17", time: "15:30:00" }, "date")).toBe("2026-10-17 10:30");
    expect(readableValue({ chosenValues: [{ id: 33, name: "I-589" }, { id: 29, name: "DV" }] }, "dropdown")).toBe("I-589, DV");
    expect(readableValue({ tags: [{ id: 1, name: "urgent" }] }, "tag")).toBe("urgent");
    expect(readableValue({ linkedPulseIds: [{ linkedPulseId: 13319508846 }] }, "board-relation")).toBe("13319508846");
    expect(readableValue({ personsAndTeams: [{ id: 32109235, kind: "person" }] }, "multiple-person")).toBe("32109235");
    expect(readableValue({ files: [{ name: "receipt.pdf" }] }, "file")).toBe("receipt.pdf");
    expect(readableValue({ checked: true }, "boolean")).toBe("checked");
    expect(readableValue({ value: 1000, unit: { symbol: "$" } }, "numeric")).toBe("1000");
    expect(readableValue({ value: "Room 4" }, "text")).toBe("Room 4");
    expect(readableValue({ text: "seen by IJ", changed_at: "x" }, "long-text")).toBe("seen by IJ");
    expect(readableValue({ email: "a@b.co", text: "a@b.co" }, "email")).toBe("a@b.co");
    expect(readableValue({ name: "Ana RIVERA" }, "name")).toBe("Ana RIVERA");
  });

  it("empty is null: Monday's {} or null, an empty list", () => {
    expect(readableValue(null, "text")).toBeNull();
    expect(readableValue({}, "file")).toBeNull();
    expect(readableValue({ changed_at: "2026-10-16" }, "multiple-person")).toBeNull();
    expect(readableValue({ linkedPulseIds: [] }, "board-relation")).toBeNull();
  });
});

describe("recordItemEvents", () => {
  let db: Database.Database;
  const boardKeyForId = (id: string) => (id === "9287895872" ? "calendaring" : null);
  const inbox = (eventType: string, event: Record<string, unknown> | string, receivedAt = "2026-10-17 14:00:00", status = "processed") =>
    db
      .prepare(
        `INSERT INTO webhook_events (event_type, monday_board_id, monday_item_id, payload, status, received_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        eventType,
        typeof event === "string" ? null : String(event.boardId ?? ""),
        typeof event === "string" ? null : String(event.pulseId ?? ""),
        typeof event === "string" ? event : JSON.stringify({ event }),
        status,
        receivedAt,
      ).lastInsertRowid as number;
  const statusChange = (uuid: string, to: string, from: string) => ({
    type: "update_column_value", triggerTime: "2026-10-17T14:31:30.085Z", triggerUuid: uuid, userId: 32138050,
    boardId: 9287895872, pulseId: 555, pulseName: "[9/30/26] MASTER: Ana RIVERA",
    columnId: "color_mkrjc7n8", columnTitle: "Calendaring Status", columnType: "color",
    value: { label: { text: to } }, previousValue: { label: { text: from } },
  });
  const rows = () => db.prepare("SELECT * FROM item_events ORDER BY id").all() as Record<string, unknown>[];

  beforeEach(() => {
    db = new Database(":memory:");
    initializeSchema(db);
  });

  it("copies a column change with who, what, from → to and when", () => {
    inbox("update_column_value", statusChange("t1", "ATTENDED", "Added on Cal"));
    expect(recordItemEvents(db, boardKeyForId)).toBe(1);
    expect(rows()[0]).toMatchObject({
      event_type: "update_column_value", board_key: "calendaring", monday_board_id: "9287895872", monday_item_id: "555",
      item_name: "[9/30/26] MASTER: Ana RIVERA", column_id: "color_mkrjc7n8", column_title: "Calendaring Status",
      value_text: "ATTENDED", previous_text: "Added on Cal", monday_user_id: "32138050", changed_at: "2026-10-17T14:31:30.085Z",
    });
    expect(JSON.parse(rows()[0]!.value_json as string)).toEqual({ label: { text: "ATTENDED" } });
  });

  it("renames, new items and untracked boards are history too", () => {
    inbox("update_name", { triggerUuid: "t2", boardId: 9287895872, pulseId: 555, value: { name: "New name" }, previousValue: { name: "Old name" } });
    inbox("create_pulse", { triggerUuid: "t3", boardId: 111, pulseId: 777, pulseName: "Someone" });
    recordItemEvents(db, boardKeyForId);
    expect(rows().map((r) => [r.event_type, r.board_key, r.item_name, r.value_text, r.previous_text])).toEqual([
      ["update_name", "calendaring", "New name", "New name", "Old name"],
      ["create_pulse", null, "Someone", null, null],
    ]);
  });

  it("idempotent; a retried delivery is recorded once; a bad payload is skipped but passed", () => {
    inbox("update_column_value", statusChange("same", "ATTENDED", "Added on Cal"));
    inbox("update_column_value", statusChange("same", "ATTENDED", "Added on Cal")); // Monday retry
    const bad = inbox("update_column_value", "not json");
    expect(recordItemEvents(db, boardKeyForId)).toBe(1);
    expect(recordItemEvents(db, boardKeyForId)).toBe(0);
    expect(rows()).toHaveLength(1);
    expect((db.prepare("SELECT last_webhook_event_id AS id FROM item_events_cursor").get() as { id: number }).id).toBe(bad);
    inbox("update_column_value", statusChange("t9", "PASSED", "ATTENDED"));
    expect(recordItemEvents(db, boardKeyForId)).toBe(1);
  });

  it("prune never drops an event the log hasn't copied", () => {
    const old = "2026-08-01 10:00:00";
    const copied = inbox("update_column_value", statusChange("a", "ATTENDED", "Added on Cal"), old);
    recordItemEvents(db, boardKeyForId);
    const notYet = inbox("update_column_value", statusChange("b", "PASSED", "ATTENDED"), old);
    prune(db);
    const left = (db.prepare("SELECT id FROM webhook_events").all() as { id: number }[]).map((r) => r.id);
    expect(left).toEqual([notYet]);
    expect(left).not.toContain(copied);
    // …and the log still has the pruned one.
    expect(rows().map((r) => r.webhook_event_id)).toEqual([copied]);
  });
});

// Entries below follow what Monday's activity log returns (sampled from production).
describe("history from Monday's activity log", () => {
  const BOARD = "9287895872";
  const entry = (event: string, data: Record<string, unknown>, id = `log-${event}`): ActivityLogEntry => ({
    id, event, created_at: "17749886097067886", user_id: "79964547", data: JSON.stringify(data),
  });

  it("reads Monday's 100-ns timestamps", () => {
    expect(activityLogTime("17749886097067886")).toBe("2026-03-31T20:23:29.706Z");
    expect(activityLogTime("x")).toBeNull();
  });

  it("a column change: same shapes as the webhooks", () => {
    const e = fromActivityLog(entry("update_column_value", {
      pulse_id: 11639100887, pulse_name: "[3/31/26] MASTER: Ana RIVERA", board_id: 9287895872,
      column_id: "color_mkrjc7n8", column_title: "Calendaring Status", column_type: "color",
      value: { label: { text: "Added on Cal" } }, previous_value: { label: { text: "Check dates" } },
    }), "calendaring", BOARD);
    expect(e).toMatchObject({
      activityLogId: "log-update_column_value", eventType: "update_column_value", boardKey: "calendaring", mondayBoardId: BOARD,
      mondayItemId: "11639100887", itemName: "[3/31/26] MASTER: Ana RIVERA", columnId: "color_mkrjc7n8", columnTitle: "Calendaring Status",
      valueText: "Added on Cal", previousText: "Check dates", mondayUserId: "79964547", changedAt: "2026-03-31T20:23:29.706Z",
    });
  });

  it("a group move reads as Group: from → to", () => {
    const e = fromActivityLog(entry("move_pulse_from_group", {
      pulse: { name: "Ana RIVERA", id: 11639100887 }, pulse_id: 11639100887, board_id: 9287895872,
      source_group: { id: "g1", title: "UPCOMING" }, dest_group: { id: "g2", title: "COURT RESCHEDULED / CONTINUED" },
    }), "calendaring", BOARD);
    expect(e).toMatchObject({ itemName: "Ana RIVERA", columnTitle: "Group", columnType: "group", previousText: "UPCOMING", valueText: "COURT RESCHEDULED / CONTINUED" });
  });

  it("renames and new items; housekeeping and owner noise are left out", () => {
    expect(fromActivityLog(entry("update_name", { pulse_id: 1, value: { name: "New" }, previous_value: { name: "Old" }, column_type: "name" }), "calendaring", BOARD))
      .toMatchObject({ itemName: "New", valueText: "New", previousText: "Old", columnId: null });
    expect(fromActivityLog(entry("create_pulse", { pulse_id: 2, pulse_name: "Someone", group_name: "New" }), "calendaring", BOARD))
      .toMatchObject({ eventType: "create_pulse", mondayItemId: "2", itemName: "Someone" });
    for (const noise of ["subscribe", "add_owner", "unsubscribe", "board_view_changed", "change_column_settings", "create_column"]) {
      expect(fromActivityLog(entry(noise, { pulse_id: 1, board_id: 9287895872 }), "calendaring", BOARD)).toBeNull();
    }
  });

  it("stored once: re-running the backfill adds nothing", () => {
    const db = new Database(":memory:");
    initializeSchema(db);
    const e = fromActivityLog(entry("update_name", { pulse_id: 1, value: { name: "New" }, previous_value: { name: "Old" } }), "calendaring", BOARD)!;
    expect(insertHistoryEvents(db, [e])).toBe(1);
    expect(insertHistoryEvents(db, [e])).toBe(0);
    expect(db.prepare("SELECT source, webhook_event_id, activity_log_id FROM item_events").get())
      .toEqual({ source: "activity_log", webhook_event_id: null, activity_log_id: "log-update_name" });
  });
});
