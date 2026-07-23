// =============================================================================
// Dashboard KPI Query Tests
// =============================================================================

import { test, expect, describe } from "vitest";
import Database from "better-sqlite3";
type DatabaseInstance = InstanceType<typeof Database>;

function run(db: DatabaseInstance, sql: string, params: unknown[] = []): void {
  db.prepare(sql).run(...(params as any[]));
}
import { initializeSchema } from "@case-pipeline/seed/db/schema";
import { getDashboardKpis, getKpiCardDetail } from "./dashboard";

// =============================================================================
// Helpers
// =============================================================================

function freshDb(): DatabaseInstance {
  const db = new Database(":memory:");
  initializeSchema(db);
  insertBatch(db);
  return db;
}

function insertBatch( db: DatabaseInstance) {
  run(db, 
    "INSERT INTO seed_batches (batch_name, seed_value, status) VALUES ('test', 1, 'complete')",
  );
}

function insertProfile(
  db: DatabaseInstance,
  opts: { localId: string; name: string },
) {
  run(db, 
    `INSERT INTO profiles (batch_id, local_id, name) VALUES (1, ?, ?)`,
    [opts.localId, opts.name],
  );
}

function insertContract(
  db: DatabaseInstance,
  opts: {
    localId: string;
    profileLocalId: string;
    caseType: string;
    status: string;
    groupTitle?: string;
  },
) {
  run(db,
    `INSERT INTO contracts (batch_id, local_id, profile_local_id, name, case_type, status, value, contract_id, group_title)
     VALUES (1, ?, ?, ?, ?, ?, 1000, ?, ?)`,
    [opts.localId, opts.profileLocalId, opts.caseType, opts.caseType, opts.status, `CT-${opts.localId}`, opts.groupTitle ?? null],
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
    profileLocalId?: string;
    groupTitle?: string;
    columnValues?: Record<string, unknown>;
  },
) {
  run(db,
    `INSERT INTO board_items (batch_id, local_id, board_key, name, status, next_date, profile_local_id, group_title, column_values)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      opts.localId,
      opts.boardKey,
      opts.name,
      opts.status ?? null,
      opts.nextDate ?? null,
      opts.profileLocalId ?? null,
      opts.groupTitle ?? null,
      JSON.stringify(opts.columnValues ?? {}),
    ],
  );
}

// =============================================================================
// Tests
// =============================================================================

describe("getDashboardKpis", () => {
  test("returns 6 KPI cards", () => {
    const db = freshDb();
    const cards = getDashboardKpis(db);
    expect(cards.length).toBe(6);
    expect(cards.map((c) => c.key)).toEqual([
      "open_forms",
      "pending_contracts",
      "paid_fee_ks",
      "upcoming_deadlines",
      "upcoming_hearings",
      "alerts",
    ]);
    db.close();
  });

  test("returns zero counts on empty database", () => {
    const db = freshDb();
    const cards = getDashboardKpis(db);
    for (const card of cards) {
      expect(card.count).toBe(0);
      expect(card.items).toEqual([]);
    }
    db.close();
  });

  test("Open Forms — counts items with correct board_key and group_title", () => {
    const db = freshDb();
    insertProfile(db, { localId: "p1", name: "Maria Garcia" });

    insertBoardItem(db, {
      localId: "bi1",
      boardKey: "_cd_open_forms",
      name: "Maria Garcia - I-485",
      groupTitle: "Open Forms",
      profileLocalId: "p1",
    });
    insertBoardItem(db, {
      localId: "bi2",
      boardKey: "_cd_open_forms",
      name: "Maria Garcia - I-130",
      groupTitle: "Open Forms",
      profileLocalId: "p1",
    });
    // Different group_title — should NOT be counted
    insertBoardItem(db, {
      localId: "bi3",
      boardKey: "_cd_open_forms",
      name: "Maria Garcia - N-400",
      groupTitle: "Completed",
      profileLocalId: "p1",
    });

    const cards = getDashboardKpis(db);
    const openForms = cards.find((c) => c.key === "open_forms")!;
    expect(openForms.count).toBe(2);
    expect(openForms.items.length).toBe(2);
    expect(openForms.items[0]!.clientName).toBe("Maria Garcia");
    db.close();
  });

  test("Pending Contracts — counts contracts in 'Pending Fee Ks' group", () => {
    const db = freshDb();
    insertProfile(db, { localId: "p1", name: "Maria Garcia" });

    // Pending group (should be counted)
    insertContract(db, {
      localId: "c1",
      profileLocalId: "p1",
      caseType: "I-485",
      status: "Atty Reviewing",
      groupTitle: "Pending Fee Ks",
    });
    insertContract(db, {
      localId: "c2",
      profileLocalId: "p1",
      caseType: "I-130",
      status: "HOLD",
      groupTitle: "Pending Fee Ks",
    });
    // Different group (should NOT count)
    insertContract(db, {
      localId: "c3",
      profileLocalId: "p1",
      caseType: "FOIA",
      status: "Completed",
      groupTitle: "Closed",
    });
    // Paid group (should NOT count in pending)
    insertContract(db, {
      localId: "c4",
      profileLocalId: "p1",
      caseType: "N-400",
      status: "Paid Needs Action",
      groupTitle: "Paid Fee Ks",
    });

    const cards = getDashboardKpis(db);
    const pending = cards.find((c) => c.key === "pending_contracts")!;
    expect(pending.count).toBe(2);
    expect(pending.items.length).toBe(2);
    db.close();
  });

  test("Paid Fee Ks — counts contracts in 'Paid Fee Ks' group", () => {
    const db = freshDb();
    insertProfile(db, { localId: "p1", name: "Maria Garcia" });

    insertContract(db, {
      localId: "c1",
      profileLocalId: "p1",
      caseType: "I-485",
      status: "Paid Needs Action",
      groupTitle: "Paid Fee Ks",
    });
    insertContract(db, {
      localId: "c2",
      profileLocalId: "p1",
      caseType: "I-130",
      status: "E-File opened",
      groupTitle: "Paid Fee Ks",
    });
    insertContract(db, {
      localId: "c3",
      profileLocalId: "p1",
      caseType: "N-400",
      status: "Create Project",
      groupTitle: "Paid Fee Ks",
    });
    // Different group — should NOT count
    insertContract(db, {
      localId: "c4",
      profileLocalId: "p1",
      caseType: "FOIA",
      status: "Active",
      groupTitle: "Pending Fee Ks",
    });

    const cards = getDashboardKpis(db);
    const paid = cards.find((c) => c.key === "paid_fee_ks")!;
    expect(paid.count).toBe(3);
    expect(paid.items.length).toBe(3);
    db.close();
  });

  test("Upcoming Deadlines — includes items within 7 days", () => {
    const db = freshDb();
    insertProfile(db, { localId: "p1", name: "Maria Garcia" });

    const today = new Date();
    const inRange = new Date(today);
    inRange.setDate(inRange.getDate() + 3);
    const outOfRange = new Date(today);
    outOfRange.setDate(outOfRange.getDate() + 10);
    const past = new Date(today);
    past.setDate(past.getDate() - 2);

    insertBoardItem(db, {
      localId: "bi1",
      boardKey: "court_cases",
      name: "Hearing",
      nextDate: inRange.toISOString().slice(0, 10),
      profileLocalId: "p1",
    });
    insertBoardItem(db, {
      localId: "bi2",
      boardKey: "rfes_all",
      name: "RFE Due",
      nextDate: outOfRange.toISOString().slice(0, 10),
      profileLocalId: "p1",
    });
    insertBoardItem(db, {
      localId: "bi3",
      boardKey: "motions",
      name: "Past Motion",
      nextDate: past.toISOString().slice(0, 10),
      profileLocalId: "p1",
    });

    const cards = getDashboardKpis(db);
    const deadlines = cards.find((c) => c.key === "upcoming_deadlines")!;
    expect(deadlines.count).toBe(1);
    expect(deadlines.items[0]!.name).toBe("Hearing");
    db.close();
  });

  test("Upcoming Hearings — only court_cases, 7d range", () => {
    const db = freshDb();
    insertProfile(db, { localId: "p1", name: "Maria Garcia" });

    const today = new Date();
    const inRange = new Date(today);
    inRange.setDate(inRange.getDate() + 5);

    insertBoardItem(db, {
      localId: "bi1",
      boardKey: "court_cases",
      name: "Garcia Hearing",
      nextDate: inRange.toISOString().slice(0, 10),
      profileLocalId: "p1",
    });
    // Not court_cases — should not count
    insertBoardItem(db, {
      localId: "bi2",
      boardKey: "motions",
      name: "Motion",
      nextDate: inRange.toISOString().slice(0, 10),
      profileLocalId: "p1",
    });

    const cards = getDashboardKpis(db, { range: "7d" });
    const hearings = cards.find((c) => c.key === "upcoming_hearings")!;
    expect(hearings.count).toBe(1);
    expect(hearings.items[0]!.name).toBe("Garcia Hearing");
    db.close();
  });

  test("Upcoming Hearings — month range includes entire month", () => {
    const db = freshDb();
    insertProfile(db, { localId: "p1", name: "Maria Garcia" });

    const today = new Date();
    // End of current month
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    const dateStr = endOfMonth.toISOString().slice(0, 10);

    insertBoardItem(db, {
      localId: "bi1",
      boardKey: "court_cases",
      name: "End of Month Hearing",
      nextDate: dateStr,
      profileLocalId: "p1",
    });

    const cards = getDashboardKpis(db, { range: "month" });
    const hearings = cards.find((c) => c.key === "upcoming_hearings")!;
    expect(hearings.count).toBeGreaterThanOrEqual(1);
    db.close();
  });

  test("items are limited to 5", () => {
    const db = freshDb();
    insertProfile(db, { localId: "p1", name: "Maria Garcia" });

    for (let i = 0; i < 8; i++) {
      insertBoardItem(db, {
        localId: `bi${i}`,
        boardKey: "_cd_open_forms",
        name: `Form ${i}`,
        groupTitle: "Open Forms",
        profileLocalId: "p1",
      });
    }

    const cards = getDashboardKpis(db);
    const openForms = cards.find((c) => c.key === "open_forms")!;
    expect(openForms.count).toBe(8);
    expect(openForms.items.length).toBe(5);
    db.close();
  });

  test("items include client name and localId from profile join", () => {
    const db = freshDb();
    insertProfile(db, { localId: "p1", name: "Maria Garcia" });

    insertContract(db, {
      localId: "c1",
      profileLocalId: "p1",
      caseType: "I-485",
      status: "Paid Needs Action",
      groupTitle: "Paid Fee Ks",
    });

    const cards = getDashboardKpis(db);
    const paid = cards.find((c) => c.key === "paid_fee_ks")!;
    expect(paid.items[0]!.clientName).toBe("Maria Garcia");
    expect(paid.items[0]!.clientLocalId).toBe("p1");
    db.close();
  });

  test("Open Forms — excludes cases parked in North Pole from count AND list", () => {
    const db = freshDb();
    insertProfile(db, { localId: "p1", name: "Maria Garcia" });

    insertBoardItem(db, {
      localId: "bi1",
      boardKey: "_cd_open_forms",
      name: "Active form",
      groupTitle: "Open Forms",
      status: "In Progress",
      profileLocalId: "p1",
    });
    insertBoardItem(db, {
      localId: "bi2",
      boardKey: "_cd_open_forms",
      name: "Parked form",
      groupTitle: "Open Forms",
      status: "Send to North Pole",
      profileLocalId: "p1",
    });

    const openForms = getDashboardKpis(db).find((c) => c.key === "open_forms")!;
    expect(openForms.count).toBe(1);
    expect(openForms.items.map((i) => i.name)).toEqual(["Active form"]);

    // The click-through list must agree with the number on the card.
    const detail = getKpiCardDetail(db, "open_forms")!;
    expect(detail.count).toBe(1);
    expect(detail.items.map((i) => i.name)).toEqual(["Active form"]);
    db.close();
  });

  test("column selection surfaces the chosen column value on each row", () => {
    const db = freshDb();
    insertProfile(db, { localId: "p1", name: "Maria Garcia" });
    insertBoardItem(db, {
      localId: "bi1",
      boardKey: "_cd_open_forms",
      name: "I-485",
      groupTitle: "Open Forms",
      status: "In Progress",
      profileLocalId: "p1",
      columnValues: { status: { label: "In Progress" }, target_date: { date: "2026-08-01" } },
    });

    const cards = getDashboardKpis(db, { columnSelections: { open_forms: "target_date" } });
    const openForms = cards.find((c) => c.key === "open_forms")!;
    expect(openForms.columnId).toBe("target_date");
    expect(openForms.columnLabel).toBe("Target Date");
    expect(openForms.items[0]!.columnValue).toEqual({ date: "2026-08-01" });
    db.close();
  });

  test("no column configured leaves columnValue null", () => {
    const db = freshDb();
    insertProfile(db, { localId: "p1", name: "Maria Garcia" });
    insertBoardItem(db, {
      localId: "bi1",
      boardKey: "_cd_open_forms",
      name: "I-485",
      groupTitle: "Open Forms",
      profileLocalId: "p1",
      columnValues: { status: { label: "In Progress" } },
    });

    const openForms = getDashboardKpis(db).find((c) => c.key === "open_forms")!;
    expect(openForms.columnId).toBeNull();
    expect(openForms.items[0]!.columnValue).toBeNull();
    db.close();
  });
});

describe("getKpiCardDetail", () => {
  test("returns every row, not just the 5 the card previews", () => {
    const db = freshDb();
    insertProfile(db, { localId: "p1", name: "Maria Garcia" });
    for (let i = 0; i < 8; i++) {
      insertBoardItem(db, {
        localId: `bi${i}`,
        boardKey: "_cd_open_forms",
        name: `Form ${i}`,
        groupTitle: "Open Forms",
        profileLocalId: "p1",
      });
    }

    const detail = getKpiCardDetail(db, "open_forms")!;
    expect(detail.count).toBe(8);
    expect(detail.items.length).toBe(8);
    db.close();
  });

  test("offers the populated columns as display options, status first then by coverage", () => {
    const db = freshDb();
    insertProfile(db, { localId: "p1", name: "Maria Garcia" });
    insertBoardItem(db, {
      localId: "bi1",
      boardKey: "_cd_open_forms",
      name: "I-485",
      groupTitle: "Open Forms",
      profileLocalId: "p1",
      columnValues: {
        a_number: "A123456789",
        status: { label: "In Progress" },
        target_date: { date: "2026-08-01" },
        subitems: "ignored",
        empty_col: "",
      },
    });
    insertBoardItem(db, {
      localId: "bi2",
      boardKey: "_cd_open_forms",
      name: "I-130",
      groupTitle: "Open Forms",
      profileLocalId: "p1",
      columnValues: { status: { label: "Filed" }, target_date: { date: "2026-09-01" } },
    });

    const detail = getKpiCardDetail(db, "open_forms")!;
    // status (2 rows) pinned first, then target_date (2) over a_number (1).
    expect(detail.columns.map((c) => c.id)).toEqual(["status", "target_date", "a_number"]);
    // Both rows carry a status; only one carries an A-number.
    expect(detail.columns.find((c) => c.id === "status")!.populatedCount).toBe(2);
    expect(detail.columns.find((c) => c.id === "a_number")!.populatedCount).toBe(1);
    db.close();
  });

  test("each row carries all of its column values so re-picking needs no refetch", () => {
    const db = freshDb();
    insertProfile(db, { localId: "p1", name: "Maria Garcia" });
    insertBoardItem(db, {
      localId: "bi1",
      boardKey: "_cd_open_forms",
      name: "I-485",
      groupTitle: "Open Forms",
      profileLocalId: "p1",
      columnValues: { status: { label: "In Progress" }, a_number: "A123456789" },
    });

    const detail = getKpiCardDetail(db, "open_forms", {
      columnSelections: { open_forms: "a_number" },
    })!;
    expect(detail.items[0]!.columnValue).toBe("A123456789");
    expect(detail.items[0]!.columnValues).toEqual({
      status: { label: "In Progress" },
      a_number: "A123456789",
    });
    db.close();
  });

  test("returns null for an unknown card key", () => {
    const db = freshDb();
    expect(getKpiCardDetail(db, "not_a_card")).toBeNull();
    db.close();
  });
});
