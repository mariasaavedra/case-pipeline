// =============================================================================
// Dashboard KPI Query Tests
// =============================================================================

import { test, expect, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { initializeSchema } from "../../scripts/seed/lib/db/schema";
import { getDashboardKpis } from "./dashboard";

// =============================================================================
// Helpers
// =============================================================================

function freshDb(): Database {
  const db = new Database(":memory:");
  initializeSchema(db);
  insertBatch(db);
  return db;
}

function insertBatch(db: Database) {
  db.run(
    "INSERT INTO seed_batches (batch_name, seed_value, status) VALUES ('test', 1, 'complete')",
  );
}

function insertProfile(
  db: Database,
  opts: { localId: string; name: string },
) {
  db.run(
    `INSERT INTO profiles (batch_id, local_id, name) VALUES (1, ?, ?)`,
    [opts.localId, opts.name],
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
    [opts.localId, opts.profileLocalId, opts.caseType, opts.caseType, opts.status, `CT-${opts.localId}`],
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
    profileLocalId?: string;
    groupTitle?: string;
  },
) {
  db.run(
    `INSERT INTO board_items (batch_id, local_id, board_key, name, status, next_date, profile_local_id, group_title, column_values)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, '{}')`,
    [
      opts.localId,
      opts.boardKey,
      opts.name,
      opts.status ?? null,
      opts.nextDate ?? null,
      opts.profileLocalId ?? null,
      opts.groupTitle ?? null,
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

  test("Pending Contracts — excludes closed and paid statuses", () => {
    const db = freshDb();
    insertProfile(db, { localId: "p1", name: "Maria Garcia" });

    // Pending (should be counted)
    insertContract(db, {
      localId: "c1",
      profileLocalId: "p1",
      caseType: "I-485",
      status: "Atty Reviewing",
    });
    insertContract(db, {
      localId: "c2",
      profileLocalId: "p1",
      caseType: "I-130",
      status: "HOLD",
    });
    // Closed (should NOT count)
    insertContract(db, {
      localId: "c3",
      profileLocalId: "p1",
      caseType: "FOIA",
      status: "Completed",
    });
    // Paid (should NOT count in pending)
    insertContract(db, {
      localId: "c4",
      profileLocalId: "p1",
      caseType: "N-400",
      status: "Paid Needs Action",
    });

    const cards = getDashboardKpis(db);
    const pending = cards.find((c) => c.key === "pending_contracts")!;
    expect(pending.count).toBe(2);
    expect(pending.items.length).toBe(2);
    db.close();
  });

  test("Paid Fee Ks — counts only paid statuses", () => {
    const db = freshDb();
    insertProfile(db, { localId: "p1", name: "Maria Garcia" });

    insertContract(db, {
      localId: "c1",
      profileLocalId: "p1",
      caseType: "I-485",
      status: "Paid Needs Action",
    });
    insertContract(db, {
      localId: "c2",
      profileLocalId: "p1",
      caseType: "I-130",
      status: "E-File opened",
    });
    insertContract(db, {
      localId: "c3",
      profileLocalId: "p1",
      caseType: "N-400",
      status: "Create Project",
    });
    // Not paid
    insertContract(db, {
      localId: "c4",
      profileLocalId: "p1",
      caseType: "FOIA",
      status: "Active",
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
    });

    const cards = getDashboardKpis(db);
    const paid = cards.find((c) => c.key === "paid_fee_ks")!;
    expect(paid.items[0]!.clientName).toBe("Maria Garcia");
    expect(paid.items[0]!.clientLocalId).toBe("p1");
    db.close();
  });
});
