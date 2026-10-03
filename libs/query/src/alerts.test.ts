// =============================================================================
// Alerts Query Tests
// =============================================================================

import { test, expect, describe } from "vitest";
import Database from "better-sqlite3";
type DatabaseInstance = InstanceType<typeof Database>;

function run(db: DatabaseInstance, sql: string, params: unknown[] = []): void {
  db.prepare(sql).run(...(params as any[]));
}
import { initializeSchema } from "@case-pipeline/seed/db/schema";
import { getAlerts, getAlertsTotalCount } from "./alerts";
import type { AlertsResult, AlertGroup } from "./types";

const group = (r: AlertsResult, label: string): AlertGroup => r.groups.find((g) => g.label === label)!;

// =============================================================================
// Helpers
// =============================================================================

function freshDb(): DatabaseInstance {
  const db = new Database(":memory:");
  initializeSchema(db);
  run(db, 
    "INSERT INTO seed_batches (batch_name, seed_value, status) VALUES ('test', 1, 'complete')",
  );
  return db;
}

function insertProfile(
  db: DatabaseInstance,
  opts: { localId: string; name: string; priority?: string },
) {
  run(db, 
    `INSERT INTO profiles (batch_id, local_id, name, priority) VALUES (1, ?, ?, ?)`,
    [opts.localId, opts.name, opts.priority ?? null],
  );
}

function insertBoardItem(
  db: DatabaseInstance,
  opts: {
    localId: string;
    boardKey: string;
    name: string;
    status?: string;
    nextDate?: string;
    attorney?: string;
    profileLocalId?: string;
    createdAt?: string;
  },
) {
  run(db, 
    `INSERT INTO board_items (batch_id, local_id, board_key, name, status, next_date, attorney, profile_local_id, group_title, column_values, created_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, NULL, '{}', ?)`,
    [
      opts.localId,
      opts.boardKey,
      opts.name,
      opts.status ?? null,
      opts.nextDate ?? null,
      opts.attorney ?? null,
      opts.profileLocalId ?? null,
      opts.createdAt ?? new Date().toISOString(),
    ],
  );
}

function insertContract(
  db: DatabaseInstance,
  opts: {
    localId: string;
    profileLocalId: string;
    caseType: string;
    status: string;
  },
) {
  run(db, 
    `INSERT INTO contracts (batch_id, local_id, profile_local_id, name, case_type, status, value, contract_id)
     VALUES (1, ?, ?, ?, ?, ?, 1000, ?)`,
    [
      opts.localId,
      opts.profileLocalId,
      opts.caseType,
      opts.caseType,
      opts.status,
      `CT-${opts.localId}`,
    ],
  );
}

function insertUpdate(
  db: DatabaseInstance,
  opts: {
    localId: string;
    profileLocalId: string;
    createdAtSource: string;
  },
) {
  run(db, 
    `INSERT INTO client_updates (batch_id, local_id, profile_local_id, author_name, text_body, source_type, created_at_source)
     VALUES (1, ?, ?, 'Test Author', 'update text', 'update', ?)`,
    [opts.localId, opts.profileLocalId, opts.createdAtSource],
  );
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// =============================================================================
// Tests
// =============================================================================

describe("getAlerts", () => {
  test("empty database returns zero alerts in all groups", () => {
    const db = freshDb();
    const result = getAlerts(db);
    expect(result.totalCount).toBe(0);
    expect(result.groups.map((g) => g.label)).toEqual([
      "Appeal & Federal Deadlines",
      "I-918B Expiring",
      "I-918B Requests Pending",
      "Overdue Deadlines",
      "Stale Cases",
      "Mail to review",
    ]);
    expect(result.groups.every((g) => g.count === 0)).toBe(true);
  });

  test("overdue deadline detected — past next_date with active status", () => {
    const db = freshDb();
    insertProfile(db, { localId: "p1", name: "Alice" });
    insertBoardItem(db, {
      localId: "bi1",
      boardKey: "court_cases",
      name: "Overdue Case",
      status: "In Progress",
      nextDate: addDays(todayStr(), -5),
      profileLocalId: "p1",
      attorney: "R",
    });

    const result = getAlerts(db);
    const overdue = group(result, "Overdue Deadlines");
    expect(overdue.severity).toBe("critical");
    expect(overdue.count).toBe(1);
    expect(overdue.items[0]!.name).toBe("Overdue Case");
    expect(overdue.items[0]!.daysOverdue).toBeGreaterThanOrEqual(4);
    expect(overdue.items[0]!.clientName).toBe("Alice");
  });

  test("future next_date is NOT flagged as overdue", () => {
    const db = freshDb();
    insertProfile(db, { localId: "p1", name: "Bob" });
    insertBoardItem(db, {
      localId: "bi1",
      boardKey: "court_cases",
      name: "Future Case",
      status: "In Progress",
      nextDate: addDays(todayStr(), 10),
      profileLocalId: "p1",
    });

    const result = getAlerts(db);
    expect(group(result, "Overdue Deadlines").count).toBe(0);
  });

  test("closed-status items are excluded from overdue", () => {
    const db = freshDb();
    insertProfile(db, { localId: "p1", name: "Carol" });
    insertBoardItem(db, {
      localId: "bi1",
      boardKey: "court_cases",
      name: "Done Case",
      status: "Done",
      nextDate: addDays(todayStr(), -3),
      profileLocalId: "p1",
    });

    const result = getAlerts(db);
    expect(group(result, "Overdue Deadlines").count).toBe(0);
  });

  test("appointment board items are excluded", () => {
    const db = freshDb();
    insertProfile(db, { localId: "p1", name: "Dave" });
    insertBoardItem(db, {
      localId: "bi1",
      boardKey: "appointments_r",
      name: "Past Appointment",
      status: "In Progress",
      nextDate: addDays(todayStr(), -2),
      profileLocalId: "p1",
    });

    const result = getAlerts(db);
    expect(group(result, "Overdue Deadlines").count).toBe(0);
  });

  test("stale case detected — no updates in 30+ days", () => {
    const db = freshDb();
    insertProfile(db, { localId: "p1", name: "Eve" });
    insertBoardItem(db, {
      localId: "bi1",
      boardKey: "court_cases",
      name: "Stale Case",
      status: "In Progress",
      nextDate: addDays(todayStr(), 10),
      profileLocalId: "p1",
      createdAt: addDays(todayStr(), -60) + "T00:00:00Z",
    });
    // Old update — 45 days ago
    insertUpdate(db, {
      localId: "u1",
      profileLocalId: "p1",
      createdAtSource: addDays(todayStr(), -45) + "T00:00:00Z",
    });

    const result = getAlerts(db);
    const stale = group(result, "Stale Cases");
    expect(stale.severity).toBe("warning");
    expect(stale.count).toBe(1);
    expect(stale.items[0]!.name).toBe("Stale Case");
    expect(stale.items[0]!.daysSinceUpdate).toBeGreaterThanOrEqual(44);
  });

  test("recent update excludes from stale", () => {
    const db = freshDb();
    insertProfile(db, { localId: "p1", name: "Frank" });
    insertBoardItem(db, {
      localId: "bi1",
      boardKey: "court_cases",
      name: "Active Case",
      status: "In Progress",
      nextDate: addDays(todayStr(), 10),
      profileLocalId: "p1",
    });
    // Recent update — 5 days ago
    insertUpdate(db, {
      localId: "u1",
      profileLocalId: "p1",
      createdAtSource: addDays(todayStr(), -5) + "T00:00:00Z",
    });

    const result = getAlerts(db);
    expect(group(result, "Stale Cases").count).toBe(0);
  });

  test("paid contracts are not an alert group (P13 Prescheduling owns them)", () => {
    const db = freshDb();
    insertProfile(db, { localId: "p1", name: "Grace" });
    insertContract(db, {
      localId: "c1",
      profileLocalId: "p1",
      caseType: "Asylum",
      status: "Paid Needs Action",
    });

    const result = getAlerts(db);
    expect(result.totalCount).toBe(0);
    expect(getAlertsTotalCount(db)).toBe(0);
  });

  test("board-specific finished statuses are excluded, case-insensitively", () => {
    const db = freshDb();
    insertProfile(db, { localId: "p1", name: "Hank" });
    const past = addDays(todayStr(), -10);
    const rows: [string, string][] = [
      ["_cd_open_forms", "Sent Out"],
      ["_cd_open_forms", "SENT OUT"],
      ["_cd_open_forms", "Interview done"],
      ["_cd_open_forms", "Send to North Pole"],
      ["_cd_open_forms", "To close"],
      ["rfes_all", "Sent out"],
      ["appeals", "Submitted"],
    ];
    rows.forEach(([boardKey, status], i) =>
      insertBoardItem(db, { localId: `done${i}`, boardKey, name: `${boardKey} ${status}`, status, nextDate: past, profileLocalId: "p1" }),
    );
    // Still open: an RFE the client hasn't answered is exactly what to chase.
    insertBoardItem(db, { localId: "open1", boardKey: "rfes_all", name: "RFE open", status: "Not Responding", nextDate: past, profileLocalId: "p1" });

    const overdue = group(getAlerts(db), "Overdue Deadlines");
    expect(overdue.items.map((i) => i.name)).toEqual(["RFE open"]);
    expect(overdue.count).toBe(1);
  });

  test("boards whose date is history, not a deadline, never alert", () => {
    const db = freshDb();
    insertProfile(db, { localId: "p1", name: "Iris" });
    const past = addDays(todayStr(), -10);
    // I-918B: its date is the hire due date; the I-918B groups alert on expiry instead.
    for (const boardKey of ["_na_originals_cards_notices", "address_changes", "_fa_jail_intakes", "appointments_cr", "_lt_i918b_s"]) {
      insertBoardItem(db, { localId: boardKey, boardKey, name: boardKey, status: "Scheduled", nextDate: past, profileLocalId: "p1" });
    }

    expect(getAlerts(db).totalCount).toBe(0);
    expect(getAlertsTotalCount(db)).toBe(0);
  });

  test("overdue lists the most recently missed deadline first", () => {
    const db = freshDb();
    insertProfile(db, { localId: "p1", name: "Jon" });
    insertBoardItem(db, { localId: "old", boardKey: "_cd_open_forms", name: "Year old", status: "Prepping for Atty Review", nextDate: addDays(todayStr(), -400), profileLocalId: "p1" });
    insertBoardItem(db, { localId: "new", boardKey: "_cd_open_forms", name: "Last week", status: "Prepping for Atty Review", nextDate: addDays(todayStr(), -7), profileLocalId: "p1" });

    expect(group(getAlerts(db), "Overdue Deadlines").items.map((i) => i.name)).toEqual(["Last week", "Year old"]);
  });

  test("archived (deleted) rows never alert", () => {
    const db = freshDb();
    insertProfile(db, { localId: "p1", name: "Kim" });
    insertBoardItem(db, { localId: "bi1", boardKey: "court_cases", name: "Gone", status: "In Progress", nextDate: addDays(todayStr(), -3), profileLocalId: "p1" });
    run(db, "UPDATE board_items SET deleted_at = datetime('now') WHERE local_id = 'bi1'");

    expect(group(getAlerts(db), "Overdue Deadlines").count).toBe(0);
  });

  test("attorney filter scopes overdue and stale results", () => {
    const db = freshDb();
    insertProfile(db, { localId: "p1", name: "Ivy" });
    insertBoardItem(db, {
      localId: "bi1",
      boardKey: "court_cases",
      name: "R's Case",
      status: "In Progress",
      nextDate: addDays(todayStr(), -3),
      profileLocalId: "p1",
      attorney: "R",
    });
    insertBoardItem(db, {
      localId: "bi2",
      boardKey: "court_cases",
      name: "M's Case",
      status: "In Progress",
      nextDate: addDays(todayStr(), -3),
      profileLocalId: "p1",
      attorney: "M",
    });

    const allResult = getAlerts(db);
    expect(group(allResult, "Overdue Deadlines").count).toBe(2);

    const filtered = getAlerts(db, { attorney: "R" });
    expect(group(filtered, "Overdue Deadlines").count).toBe(1);
    expect(group(filtered, "Overdue Deadlines").items[0]!.name).toBe("R's Case");
  });
});

describe("getAlertsTotalCount", () => {
  test("returns combined count across all categories", () => {
    const db = freshDb();
    insertProfile(db, { localId: "p1", name: "Jack" });

    // 1 overdue
    insertBoardItem(db, {
      localId: "bi1",
      boardKey: "court_cases",
      name: "Overdue",
      status: "In Progress",
      nextDate: addDays(todayStr(), -2),
      profileLocalId: "p1",
    });

    // 1 stale
    insertBoardItem(db, {
      localId: "bi2",
      boardKey: "rfes_all",
      name: "Stale RFE",
      status: "Pending",
      nextDate: addDays(todayStr(), 20),
      profileLocalId: "p1",
    });

    const count = getAlertsTotalCount(db);
    expect(count).toBe(2);
    expect(count).toBe(getAlerts(db).totalCount);
  });
});
