// =============================================================================
// Alerts Query Tests
// =============================================================================

import { test, expect, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { initializeSchema } from "../../scripts/seed/lib/db/schema";
import { getAlerts, getAlertsTotalCount } from "./alerts";

// =============================================================================
// Helpers
// =============================================================================

function freshDb(): Database {
  const db = new Database(":memory:");
  initializeSchema(db);
  db.run(
    "INSERT INTO seed_batches (batch_name, seed_value, status) VALUES ('test', 1, 'complete')",
  );
  return db;
}

function insertProfile(
  db: Database,
  opts: { localId: string; name: string; priority?: string },
) {
  db.run(
    `INSERT INTO profiles (batch_id, local_id, name, priority) VALUES (1, ?, ?, ?)`,
    [opts.localId, opts.name, opts.priority ?? null],
  );
}

function insertBoardItem(
  db: Database,
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
  db.run(
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
  db: Database,
  opts: {
    localId: string;
    profileLocalId: string;
    caseType: string;
    status: string;
  },
) {
  db.run(
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
  db: Database,
  opts: {
    localId: string;
    profileLocalId: string;
    createdAtSource: string;
  },
) {
  db.run(
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
    expect(result.groups).toHaveLength(3);
    expect(result.groups[0]!.count).toBe(0);
    expect(result.groups[1]!.count).toBe(0);
    expect(result.groups[2]!.count).toBe(0);
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
    const overdue = result.groups[0]!;
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
    expect(result.groups[0]!.count).toBe(0);
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
    expect(result.groups[0]!.count).toBe(0);
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
    expect(result.groups[0]!.count).toBe(0);
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
    const stale = result.groups[1]!;
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
    expect(result.groups[1]!.count).toBe(0);
  });

  test("pending contract without board items is flagged", () => {
    const db = freshDb();
    insertProfile(db, { localId: "p1", name: "Grace" });
    insertContract(db, {
      localId: "c1",
      profileLocalId: "p1",
      caseType: "Asylum",
      status: "Paid Needs Action",
    });

    const result = getAlerts(db);
    const pending = result.groups[2]!;
    expect(pending.severity).toBe("info");
    expect(pending.count).toBe(1);
    expect(pending.items[0]!.name).toBe("Asylum");
    expect(pending.items[0]!.clientName).toBe("Grace");
  });

  test("pending contract WITH active board items is NOT flagged", () => {
    const db = freshDb();
    insertProfile(db, { localId: "p1", name: "Hank" });
    insertContract(db, {
      localId: "c1",
      profileLocalId: "p1",
      caseType: "TPS",
      status: "Paid Needs Action",
    });
    insertBoardItem(db, {
      localId: "bi1",
      boardKey: "court_cases",
      name: "Active Work",
      status: "In Progress",
      profileLocalId: "p1",
    });

    const result = getAlerts(db);
    expect(result.groups[2]!.count).toBe(0);
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
    expect(allResult.groups[0]!.count).toBe(2);

    const filtered = getAlerts(db, { attorney: "R" });
    expect(filtered.groups[0]!.count).toBe(1);
    expect(filtered.groups[0]!.items[0]!.name).toBe("R's Case");
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

    // 1 pending contract
    insertProfile(db, { localId: "p2", name: "Kate" });
    insertContract(db, {
      localId: "c1",
      profileLocalId: "p2",
      caseType: "U-Visa",
      status: "Paid Needs Action",
    });

    const count = getAlertsTotalCount(db);
    expect(count).toBeGreaterThanOrEqual(2);
  });
});
