// =============================================================================
// Calendar Query Tests
// =============================================================================

import { test, expect, describe } from "vitest";
import Database from "better-sqlite3";
type DatabaseInstance = InstanceType<typeof Database>;

function run(db: DatabaseInstance, sql: string, params: unknown[] = []): void {
  db.prepare(sql).run(...(params as any[]));
}
import { initializeSchema } from "@case-pipeline/seed/db/schema";
import { getCalendarEvents } from "./calendar";

// =============================================================================
// Helpers
// =============================================================================

function freshDb(): DatabaseInstance {
  const db = new Database(":memory:");
  initializeSchema(db);
  run(db, "INSERT INTO seed_batches (batch_name, seed_value, status) VALUES ('test', 1, 'complete')");
  return db;
}

function insertProfile(db: DatabaseInstance, opts: { localId: string; name: string }) {
  run(db, `INSERT INTO profiles (batch_id, local_id, name) VALUES (1, ?, ?)`, [
    opts.localId,
    opts.name,
  ]);
}

/** Insert a calendaring-board row with an arbitrary raw column_values JSON blob. */
function insertCalendaringItem(
  db: DatabaseInstance,
  opts: {
    localId: string;
    name: string;
    status?: string;
    attorney?: string;
    profileLocalId?: string;
    columnValues: Record<string, unknown>;
  },
) {
  run(
    db,
    `INSERT INTO board_items (batch_id, local_id, board_key, name, status, attorney, profile_local_id, group_title, column_values, created_at)
     VALUES (1, ?, 'calendaring', ?, ?, ?, ?, NULL, ?, ?)`,
    [
      opts.localId,
      opts.name,
      opts.status ?? null,
      opts.attorney ?? null,
      opts.profileLocalId ?? null,
      JSON.stringify(opts.columnValues),
      new Date().toISOString(),
    ],
  );
}

/** Insert a board_items row for a next_date-driven board (open forms, appeals, appointments, ...). */
function insertNextDateItem(
  db: DatabaseInstance,
  opts: {
    localId: string;
    boardKey: string;
    name: string;
    status?: string;
    nextDate: string;
    nextTime?: string;
    attorney?: string;
    profileLocalId?: string;
  },
) {
  run(
    db,
    `INSERT INTO board_items (batch_id, local_id, board_key, name, status, next_date, next_time, attorney, profile_local_id, group_title, column_values, created_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, NULL, '{}', ?)`,
    [
      opts.localId,
      opts.boardKey,
      opts.name,
      opts.status ?? null,
      opts.nextDate,
      opts.nextTime ?? null,
      opts.attorney ?? null,
      opts.profileLocalId ?? null,
      new Date().toISOString(),
    ],
  );
}

// =============================================================================
// Tests
// =============================================================================

describe("getCalendarEvents", () => {
  test("empty database returns no events", () => {
    const db = freshDb();
    const result = getCalendarEvents(db, { from: "2026-01-01", to: "2026-12-31" });
    expect(result.events).toHaveLength(0);
  });

  test("Master hearing on calendaring board categorizes as a hearing", () => {
    const db = freshDb();
    insertProfile(db, { localId: "p1", name: "Client A" });
    insertCalendaringItem(db, {
      localId: "c1",
      name: "Master Hearing",
      attorney: "LB",
      profileLocalId: "p1",
      columnValues: {
        type: { label: "Master" },
        hearing_date_calendaring: { date: "2026-03-10", time: "15:00" },
        judge_calendaring: "Jared Grimmer",
        method: "WEBEX TRIAL",
        notice: "https://example.com/notice.pdf",
      },
    });

    const result = getCalendarEvents(db, { from: "2026-01-01", to: "2026-12-31" });
    expect(result.events).toHaveLength(1);
    const event = result.events[0]!;
    expect(event.category).toBe("hearing");
    expect(event.date).toBe("2026-03-10");
    expect(event.time).toBe("15:00");
    expect(event.subType).toBe("Master");
    expect(event.clientName).toBe("Client A");
    expect(event.detail.judge).toBe("Jared Grimmer");
    expect(event.detail.method).toBe("WEBEX TRIAL");
    expect(event.detail.noticeUrl).toBe("https://example.com/notice.pdf");
  });

  test("Court Deadline type uses due_date", () => {
    const db = freshDb();
    insertCalendaringItem(db, {
      localId: "c2",
      name: "BIA Filing",
      columnValues: {
        type: { label: "Court Deadline" },
        due_date: { date: "2026-04-01" },
      },
    });

    const result = getCalendarEvents(db, { from: "2026-01-01", to: "2026-12-31" });
    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.category).toBe("court_deadline");
    expect(result.events[0]!.date).toBe("2026-04-01");
  });

  test("USCIS type uses due_date_uscis", () => {
    const db = freshDb();
    insertCalendaringItem(db, {
      localId: "c3",
      name: "RFE Response",
      columnValues: {
        type: { label: "USCIS" },
        uscis_notice_type: { labels: ["RFE"] },
        due_date_uscis: { date: "2026-05-15" },
      },
    });

    const result = getCalendarEvents(db, { from: "2026-01-01", to: "2026-12-31" });
    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.category).toBe("uscis_deadline");
    expect(result.events[0]!.subType).toBe("Rfe");
    expect(result.events[0]!.date).toBe("2026-05-15");
  });

  test("USCIS row flagged INTERVIEW overrides category to interview, using interview_date", () => {
    const db = freshDb();
    insertCalendaringItem(db, {
      localId: "c4",
      name: "N-400 Interview",
      columnValues: {
        type: { label: "USCIS" },
        uscis_notice_type: { labels: ["INTERVIEW"] },
        due_date_uscis: { date: "2026-06-01" }, // should be ignored in favor of interview_date
        interview_date: { date: "2026-02-12", time: "12:45" },
        interview_location: { labels: ["USCIS KCMO"] },
      },
    });

    const result = getCalendarEvents(db, { from: "2026-01-01", to: "2026-12-31" });
    expect(result.events).toHaveLength(1);
    const event = result.events[0]!;
    expect(event.category).toBe("interview");
    expect(event.date).toBe("2026-02-12");
    expect(event.time).toBe("12:45");
    expect(event.detail.location).toBe("USCIS KCMO");
  });

  test("OUT OF TOWN INTERVIEW label also triggers interview category", () => {
    const db = freshDb();
    insertCalendaringItem(db, {
      localId: "c5",
      name: "Out of Town Interview",
      columnValues: {
        type: { label: "USCIS" },
        uscis_notice_type: { labels: ["OUT OF TOWN INTERVIEW"] },
        interview_date: { date: "2026-07-04" },
      },
    });

    const result = getCalendarEvents(db, { from: "2026-01-01", to: "2026-12-31" });
    expect(result.events[0]!.category).toBe("interview");
  });

  test("fee-only row (no type) falls back to Court Deadline using a fee due date", () => {
    const db = freshDb();
    insertCalendaringItem(db, {
      localId: "c6",
      name: "Fee Due",
      columnValues: {
        master_fees_due_on_calendaring: { date: "2026-08-19" },
      },
    });

    const result = getCalendarEvents(db, { from: "2026-01-01", to: "2026-12-31" });
    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.category).toBe("court_deadline");
    expect(result.events[0]!.date).toBe("2026-08-19");
  });

  test("LOGGING type row is excluded (workflow noise)", () => {
    const db = freshDb();
    insertCalendaringItem(db, {
      localId: "c7",
      name: "Log entry",
      columnValues: {
        type: { label: "LOGGING" },
      },
    });

    const result = getCalendarEvents(db, { from: "2026-01-01", to: "2026-12-31" });
    expect(result.events).toHaveLength(0);
  });

  test("row with a type but no usable date is excluded", () => {
    const db = freshDb();
    insertCalendaringItem(db, {
      localId: "c8",
      name: "No date yet",
      columnValues: { type: { label: "Master" } }, // no hearing_date_calendaring
    });

    const result = getCalendarEvents(db, { from: "2026-01-01", to: "2026-12-31" });
    expect(result.events).toHaveLength(0);
  });

  test("supplementary boards map to the right category via next_date", () => {
    const db = freshDb();
    insertNextDateItem(db, {
      localId: "of1",
      boardKey: "_cd_open_forms",
      name: "I-485 Filing",
      nextDate: "2026-09-01",
    });
    insertNextDateItem(db, {
      localId: "ap1",
      boardKey: "appeals",
      name: "BIA Appeal",
      nextDate: "2026-09-02",
    });
    insertNextDateItem(db, {
      localId: "mo1",
      boardKey: "motions",
      name: "Motion to Continue",
      nextDate: "2026-09-03",
    });

    const result = getCalendarEvents(db, { from: "2026-01-01", to: "2026-12-31" });
    expect(result.events).toHaveLength(3);
    const byBoard = new Map(result.events.map((e) => [e.boardKey, e.category]));
    expect(byBoard.get("_cd_open_forms")).toBe("uscis_deadline");
    expect(byBoard.get("appeals")).toBe("court_deadline");
    expect(byBoard.get("motions")).toBe("hearing");
  });

  test("appointment boards map to the appointment category", () => {
    const db = freshDb();
    insertNextDateItem(db, {
      localId: "app1",
      boardKey: "appointments_lb",
      name: "Consult",
      nextDate: "2026-09-05",
      nextTime: "09:30",
    });

    const result = getCalendarEvents(db, { from: "2026-01-01", to: "2026-12-31" });
    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.category).toBe("appointment");
  });

  test("date range filters out-of-range events", () => {
    const db = freshDb();
    insertCalendaringItem(db, {
      localId: "c9",
      name: "Out of range hearing",
      columnValues: {
        type: { label: "Trial" },
        hearing_date_calendaring: { date: "2027-01-01" },
      },
    });

    const result = getCalendarEvents(db, { from: "2026-01-01", to: "2026-12-31" });
    expect(result.events).toHaveLength(0);
  });

  test("attorney filter narrows results across all groups", () => {
    const db = freshDb();
    insertCalendaringItem(db, {
      localId: "c10",
      name: "LB Hearing",
      attorney: "LB",
      columnValues: {
        type: { label: "Trial" },
        hearing_date_calendaring: { date: "2026-10-01" },
      },
    });
    insertCalendaringItem(db, {
      localId: "c11",
      name: "R Hearing",
      attorney: "R",
      columnValues: {
        type: { label: "Trial" },
        hearing_date_calendaring: { date: "2026-10-02" },
      },
    });

    const result = getCalendarEvents(db, { from: "2026-01-01", to: "2026-12-31", attorney: "LB" });
    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.name).toBe("LB Hearing");
  });

  test("categories filter narrows to the requested set", () => {
    const db = freshDb();
    insertCalendaringItem(db, {
      localId: "c12",
      name: "Hearing",
      columnValues: {
        type: { label: "Trial" },
        hearing_date_calendaring: { date: "2026-11-01" },
      },
    });
    insertNextDateItem(db, {
      localId: "app2",
      boardKey: "appointments_lb",
      name: "Consult",
      nextDate: "2026-11-02",
    });

    const result = getCalendarEvents(db, {
      from: "2026-01-01",
      to: "2026-12-31",
      categories: ["hearing"],
    });
    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.category).toBe("hearing");
  });
});
