// =============================================================================
// Active Cases Query Tests
// =============================================================================

import { test, expect, describe } from "vitest";
import Database from "better-sqlite3";
type DatabaseInstance = InstanceType<typeof Database>;
import { initializeSchema } from "@case-pipeline/seed/db/schema";
import { getActiveCases } from "./active-cases";

// =============================================================================
// Helpers
// =============================================================================

function freshDb(): DatabaseInstance {
  const db = new Database(":memory:");
  initializeSchema(db);
  return db;
}

function insertBatch(db: DatabaseInstance): number {
  db.prepare("INSERT INTO seed_batches (batch_name, seed_value, status) VALUES ('test', 1, 'complete')").run();
  return (db.prepare("SELECT id FROM seed_batches ORDER BY id DESC LIMIT 1").get() as { id: number }).id;
}

function insertProfile(db: DatabaseInstance, batchId: number, opts: { localId: string; name: string }) {
  db.prepare(
    "INSERT INTO profiles (batch_id, local_id, name) VALUES (?, ?, ?)"
  ).run(batchId, opts.localId, opts.name);
}

interface BoardItemOpts {
  localId: string;
  boardKey: string;
  name: string;
  groupTitle?: string;
  status?: string;
  nextDate?: string;
  paralegals?: string;
  profileLocalId?: string;
}

function insertBoardItem(db: DatabaseInstance, batchId: number, opts: BoardItemOpts) {
  db.prepare(`
    INSERT INTO board_items
      (batch_id, local_id, board_key, name, group_title, status, next_date, paralegals, profile_local_id, column_values)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    batchId,
    opts.localId,
    opts.boardKey,
    opts.name,
    opts.groupTitle ?? null,
    opts.status ?? null,
    opts.nextDate ?? null,
    opts.paralegals ?? null,
    opts.profileLocalId ?? null,
    "{}",
  );
}

// Returns an ISO date string offset by `days` from today
function daysFromToday(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// =============================================================================
// Tests
// =============================================================================

describe("getActiveCases", () => {
  test("empty DB returns empty assignees array", () => {
    const db = freshDb();
    const result = getActiveCases(db);
    expect(result.assignees).toEqual([]);
    db.close();
  });

  test("cases grouped correctly by paralegal name", () => {
    const db = freshDb();
    const batchId = insertBatch(db);
    insertProfile(db, batchId, { localId: "p1", name: "Ana Garcia" });
    insertProfile(db, batchId, { localId: "p2", name: "Luis Perez" });

    insertBoardItem(db, batchId, {
      localId: "bi1", boardKey: "_cd_open_forms", name: "Ana Garcia - I-485",
      groupTitle: "Open Forms", paralegals: "Laura Torres", profileLocalId: "p1",
    });
    insertBoardItem(db, batchId, {
      localId: "bi2", boardKey: "_cd_open_forms", name: "Luis Perez - N-400",
      groupTitle: "Open Forms", paralegals: "Mayra Ruiz", profileLocalId: "p2",
    });

    const result = getActiveCases(db);
    expect(result.assignees).toHaveLength(2);
    const names = result.assignees.map(a => a.name);
    expect(names).toContain("Laura Torres");
    expect(names).toContain("Mayra Ruiz");
    expect(result.assignees.find(a => a.name === "Laura Torres")!.cases).toHaveLength(1);
    db.close();
  });

  test("null paralegals appear in Unassigned row", () => {
    const db = freshDb();
    const batchId = insertBatch(db);
    insertProfile(db, batchId, { localId: "p1", name: "Ana Garcia" });

    insertBoardItem(db, batchId, {
      localId: "bi1", boardKey: "_cd_open_forms", name: "Ana Garcia - I-485",
      groupTitle: "Open Forms", paralegals: undefined, profileLocalId: "p1",
    });

    const result = getActiveCases(db);
    expect(result.assignees).toHaveLength(1);
    expect(result.assignees[0]!.name).toBe("Unassigned");
    db.close();
  });

  test("Unassigned row sorted last when named assignees also exist", () => {
    const db = freshDb();
    const batchId = insertBatch(db);

    insertBoardItem(db, batchId, {
      localId: "bi1", boardKey: "_cd_open_forms", name: "Case A",
      groupTitle: "Open Forms", paralegals: undefined,
    });
    insertBoardItem(db, batchId, {
      localId: "bi2", boardKey: "_cd_open_forms", name: "Case B",
      groupTitle: "Open Forms", paralegals: "Walter Taborda",
    });

    const result = getActiveCases(db);
    expect(result.assignees).toHaveLength(2);
    expect(result.assignees[result.assignees.length - 1]!.name).toBe("Unassigned");
    db.close();
  });

  test("assignees sorted alphabetically (Unassigned last)", () => {
    const db = freshDb();
    const batchId = insertBatch(db);

    for (const [id, paralegal] of [
      ["bi1", "Walter Taborda"],
      ["bi2", "Cynthia De La Cruz"],
      ["bi3", "Laura Torres"],
      ["bi4", null],
    ] as const) {
      insertBoardItem(db, batchId, {
        localId: id, boardKey: "_cd_open_forms", name: "Case",
        groupTitle: "Open Forms", paralegals: paralegal ?? undefined,
      });
    }

    const result = getActiveCases(db);
    const names = result.assignees.map(a => a.name);
    expect(names).toEqual(["Cynthia De La Cruz", "Laura Torres", "Walter Taborda", "Unassigned"]);
    db.close();
  });

  test("urgency buckets computed correctly", () => {
    const db = freshDb();
    const batchId = insertBatch(db);
    const p = "Laura Torres";

    const cases = [
      { id: "overdue",   date: daysFromToday(-5),  expectedUrgency: "overdue"   },
      { id: "critical",  date: daysFromToday(2),   expectedUrgency: "critical"  },
      { id: "soon",      date: daysFromToday(5),   expectedUrgency: "soon"      },
      { id: "later",     date: daysFromToday(15),  expectedUrgency: "later"     },
      { id: "nodate",    date: undefined,           expectedUrgency: "none"      },
    ];

    for (const c of cases) {
      insertBoardItem(db, batchId, {
        localId: c.id, boardKey: "_cd_open_forms", name: `Case ${c.id}`,
        groupTitle: "Open Forms", paralegals: p, nextDate: c.date,
      });
    }

    const result = getActiveCases(db);
    const assignee = result.assignees.find(a => a.name === p)!;
    expect(assignee).toBeDefined();

    for (const c of cases) {
      const found = assignee.cases.find(k => k.localId === c.id);
      expect(found, `case ${c.id}`).toBeDefined();
      expect(found!.urgency).toBe(c.expectedUrgency);
    }
    db.close();
  });

  test("daysUntilTarget is negative for overdue cases", () => {
    const db = freshDb();
    const batchId = insertBatch(db);

    insertBoardItem(db, batchId, {
      localId: "bi1", boardKey: "_cd_open_forms", name: "Overdue Case",
      groupTitle: "Open Forms", paralegals: "Laura Torres",
      nextDate: daysFromToday(-3),
    });

    const result = getActiveCases(db);
    const c = result.assignees[0]!.cases[0]!;
    expect(c.daysUntilTarget).toBeLessThan(0);
    db.close();
  });

  test("isCourtCase true for Court Forms group, false for Open Forms", () => {
    const db = freshDb();
    const batchId = insertBatch(db);

    insertBoardItem(db, batchId, {
      localId: "court", boardKey: "_cd_open_forms", name: "EOIR 42A",
      groupTitle: "Court Forms", paralegals: "Laura Torres",
    });
    insertBoardItem(db, batchId, {
      localId: "form", boardKey: "_cd_open_forms", name: "I-485",
      groupTitle: "Open Forms", paralegals: "Laura Torres",
    });

    const result = getActiveCases(db);
    const cases = result.assignees[0]!.cases;
    expect(cases.find(c => c.localId === "court")!.isCourtCase).toBe(true);
    expect(cases.find(c => c.localId === "form")!.isCourtCase).toBe(false);
    db.close();
  });

  test("shared case appears in each assigned paralegal's row", () => {
    const db = freshDb();
    const batchId = insertBatch(db);
    insertProfile(db, batchId, { localId: "p1", name: "Ana Garcia" });

    insertBoardItem(db, batchId, {
      localId: "bi1", boardKey: "_cd_open_forms", name: "Ana Garcia - I-485",
      groupTitle: "Open Forms", paralegals: "Laura Torres, Walter Taborda",
      profileLocalId: "p1",
    });

    const result = getActiveCases(db);
    const names = result.assignees.map((a) => a.name);
    expect(names).toContain("Laura Torres");
    expect(names).toContain("Walter Taborda");
    // Same case object on both rows
    expect(result.assignees.find((a) => a.name === "Laura Torres")!.cases[0]!.localId).toBe("bi1");
    expect(result.assignees.find((a) => a.name === "Walter Taborda")!.cases[0]!.localId).toBe("bi1");
    db.close();
  });

  test("shared case carries full assignees list (for the SHARED badge)", () => {
    const db = freshDb();
    const batchId = insertBatch(db);

    insertBoardItem(db, batchId, {
      localId: "bi1", boardKey: "_cd_open_forms", name: "Shared Case",
      groupTitle: "Open Forms", paralegals: "Laura Torres, Walter Taborda, Mayra Ruiz",
    });

    const result = getActiveCases(db);
    const c = result.assignees[0]!.cases[0]!;
    expect(c.assignees).toEqual(["Laura Torres", "Walter Taborda", "Mayra Ruiz"]);
    db.close();
  });

  test("duplicate / whitespace-padded names are de-duplicated and trimmed", () => {
    const db = freshDb();
    const batchId = insertBatch(db);

    insertBoardItem(db, batchId, {
      localId: "bi1", boardKey: "_cd_open_forms", name: "Case",
      groupTitle: "Open Forms", paralegals: " Laura Torres ,Laura Torres , Walter Taborda ",
    });

    const result = getActiveCases(db);
    expect(result.assignees.map((a) => a.name).sort()).toEqual(["Laura Torres", "Walter Taborda"]);
    expect(result.assignees[0]!.cases[0]!.assignees).toEqual(["Laura Torres", "Walter Taborda"]);
    db.close();
  });

  test("single-assignee case has a one-element assignees list", () => {
    const db = freshDb();
    const batchId = insertBatch(db);

    insertBoardItem(db, batchId, {
      localId: "bi1", boardKey: "_cd_open_forms", name: "Solo Case",
      groupTitle: "Open Forms", paralegals: "Laura Torres",
    });

    const result = getActiveCases(db);
    expect(result.assignees[0]!.cases[0]!.assignees).toEqual(["Laura Torres"]);
    db.close();
  });

  test("unassigned case has an empty assignees list", () => {
    const db = freshDb();
    const batchId = insertBatch(db);

    insertBoardItem(db, batchId, {
      localId: "bi1", boardKey: "_cd_open_forms", name: "Orphan Case",
      groupTitle: "Open Forms", paralegals: undefined,
    });

    const result = getActiveCases(db);
    expect(result.assignees[0]!.name).toBe("Unassigned");
    expect(result.assignees[0]!.cases[0]!.assignees).toEqual([]);
    db.close();
  });

  test("items in terminal groups are excluded", () => {
    const db = freshDb();
    const batchId = insertBatch(db);

    insertBoardItem(db, batchId, {
      localId: "active", boardKey: "_cd_open_forms", name: "Active Case",
      groupTitle: "Open Forms", paralegals: "Laura Torres",
    });
    for (const [id, group] of [["filed", "Filed"], ["interview", "Interview"], ["pips", "Filed PIPS"], ["closed", "Closed"]] as const) {
      insertBoardItem(db, batchId, {
        localId: id, boardKey: "_cd_open_forms", name: `Terminal ${id}`,
        groupTitle: group, paralegals: "Laura Torres",
      });
    }

    const result = getActiveCases(db);
    const cases = result.assignees[0]!.cases;
    expect(cases).toHaveLength(1);
    expect(cases[0]!.localId).toBe("active");
    db.close();
  });

  test("items from other boards are excluded", () => {
    const db = freshDb();
    const batchId = insertBatch(db);

    insertBoardItem(db, batchId, {
      localId: "open", boardKey: "_cd_open_forms", name: "Open Form",
      groupTitle: "Open Forms", paralegals: "Laura Torres",
    });
    insertBoardItem(db, batchId, {
      localId: "court", boardKey: "court_cases", name: "Court Case",
      groupTitle: "Court Case", paralegals: "Laura Torres",
    });

    const result = getActiveCases(db);
    expect(result.assignees).toHaveLength(1);
    expect(result.assignees[0]!.cases).toHaveLength(1);
    expect(result.assignees[0]!.cases[0]!.localId).toBe("open");
    db.close();
  });

  test("cases within assignee sorted by urgency (overdue first, none last)", () => {
    const db = freshDb();
    const batchId = insertBatch(db);
    const p = "Laura Torres";

    insertBoardItem(db, batchId, { localId: "later",    boardKey: "_cd_open_forms", name: "Later",    groupTitle: "Open Forms", paralegals: p, nextDate: daysFromToday(20) });
    insertBoardItem(db, batchId, { localId: "overdue",  boardKey: "_cd_open_forms", name: "Overdue",  groupTitle: "Open Forms", paralegals: p, nextDate: daysFromToday(-1) });
    insertBoardItem(db, batchId, { localId: "critical", boardKey: "_cd_open_forms", name: "Critical", groupTitle: "Open Forms", paralegals: p, nextDate: daysFromToday(2)  });
    insertBoardItem(db, batchId, { localId: "none",     boardKey: "_cd_open_forms", name: "None",     groupTitle: "Open Forms", paralegals: p });

    const result = getActiveCases(db);
    const urgencies = result.assignees[0]!.cases.map(c => c.urgency);
    expect(urgencies[0]).toBe("overdue");
    expect(urgencies[urgencies.length - 1]).toBe("none");
    db.close();
  });
});
