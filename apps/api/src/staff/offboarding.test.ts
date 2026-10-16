import { describe, test, expect } from "vitest";
import Database from "better-sqlite3";
import type { BoardConfig } from "@case-pipeline/config";
import type { WorkloadAssignment, WorkloadItem } from "@case-pipeline/query";
import { createStaffTablesSql, createOffboardingTableSql } from "./schema.js";
import { createStaff } from "./roster.js";
import {
  swapPersons,
  swapNames,
  planReassignments,
  applyLocalReassignment,
  startOffboarding,
  setManualStep,
  getOffboarding,
  allStepsDone,
} from "./offboarding.js";

const BOARDS: Record<string, BoardConfig> = {
  _cd_open_forms: {
    id: "100", name: "Open Forms",
    columns: { paralegal: { resolve: "by_id", id: "project_owner" }, attorney: { resolve: "by_type", type: "people" } },
  },
  fee_ks: { id: "200", name: "Fee Ks", columns: { paralegal: { resolve: "by_id", id: "people_mkkw3twh" } } },
};

function item(over: Partial<WorkloadItem>): WorkloadItem {
  return {
    source: "open_forms", localId: "f1", table: "board_items", boardKey: "_cd_open_forms", mondayItemId: "m1",
    title: "I-130", clientName: null, clientLocalId: null, level: "ok", levelLabel: "Later", people: {}, ...over,
  };
}

describe("swapPersons", () => {
  test("replaces the departing person and keeps co-assignees and teams", () => {
    const r = swapPersons(
      [{ id: "1", kind: "person" }, { id: "2", kind: "person" }, { id: "1", kind: "team" }],
      (id) => id === "1",
      "3",
    );
    expect(r.removed).toBe(1);
    expect(r.personsAndTeams).toEqual([{ id: 2, kind: "person" }, { id: 1, kind: "team" }, { id: 3, kind: "person" }]);
  });

  test("never adds the replacement twice; null just removes", () => {
    expect(swapPersons([{ id: "1", kind: "person" }, { id: "3", kind: "person" }], (id) => id === "1", "3").personsAndTeams)
      .toEqual([{ id: 3, kind: "person" }]);
    expect(swapPersons([{ id: "1", kind: "person" }], (id) => id === "1", null)).toEqual({ personsAndTeams: [], removed: 1 });
  });

  test("removed = 0 when the person is already gone (handled on Monday)", () => {
    expect(swapPersons([{ id: "2", kind: "person" }], (id) => id === "1", "3").removed).toBe(0);
  });
});

describe("swapNames", () => {
  test("swaps by name, keeps the rest, empties to null", () => {
    const gone = (n: string) => n === "Old P";
    expect(swapNames("Old P, Ana", gone, "Mayra")).toBe("Ana, Mayra");
    expect(swapNames("Old P", gone, null)).toBeNull();
    expect(swapNames("Old P, Mayra", gone, "mayra")).toBe("Mayra");
  });
});

describe("planReassignments", () => {
  const mine: WorkloadAssignment[] = [
    { item: item({}), columns: ["paralegal", "attorney"] },
    { item: item({ localId: "k1", source: "prescheduling", table: "contracts", boardKey: "fee_ks", mondayItemId: "m9" }), columns: ["paralegal"] },
    { item: item({ localId: "f2", mondayItemId: null }), columns: ["paralegal"] },
  ];
  const staff = (id: number) =>
    ({ 5: { name: "Mayra", mondayUserId: "55", active: true }, 6: { name: "No Monday", mondayUserId: null, active: true } } as Record<
      number,
      { name: string; mondayUserId: string | null; active: boolean }
    >)[id] ?? null;

  test("plans writes against what the person really holds, with column + board ids", () => {
    const { writes, skipped } = planReassignments(
      mine,
      [
        { source: "open_forms", localId: "f1", column: "paralegal", toStaffId: 5 },
        { source: "prescheduling", localId: "k1", column: "paralegal", toStaffId: null },
      ],
      BOARDS,
      staff,
    );
    expect(skipped).toEqual([]);
    expect(writes).toEqual([
      expect.objectContaining({ localId: "f1", mondayBoardId: "100", columnId: "project_owner", to: { staffId: 5, name: "Mayra", mondayUserId: "55" } }),
      expect.objectContaining({ localId: "k1", table: "contracts", mondayBoardId: "200", columnId: "people_mkkw3twh", to: null }),
    ]);
  });

  test("seed data (no live writes): unsynced items still change locally, no Monday account needed", () => {
    const { writes, localOnly, skipped } = planReassignments(
      mine,
      [
        { source: "open_forms", localId: "f2", column: "paralegal", toStaffId: 6 },
        { source: "open_forms", localId: "f1", column: "attorney", toStaffId: null },
      ],
      BOARDS,
      staff,
      { liveWrites: false },
    );
    expect(writes).toEqual([]);
    expect(skipped).toEqual([]);
    expect(localOnly).toEqual([
      { source: "open_forms", localId: "f2", table: "board_items", column: "paralegal", to: { staffId: 6, name: "No Monday" } },
      { source: "open_forms", localId: "f1", table: "board_items", column: "attorney", to: null },
    ]);
  });

  test("skips what can't be done, and says why", () => {
    const { writes, skipped } = planReassignments(
      mine,
      [
        { source: "open_forms", localId: "nope", column: "paralegal", toStaffId: 5 },
        { source: "prescheduling", localId: "k1", column: "attorney", toStaffId: 5 },
        { source: "open_forms", localId: "f2", column: "paralegal", toStaffId: 5 },
        { source: "open_forms", localId: "f1", column: "attorney", toStaffId: 5 },
        { source: "open_forms", localId: "f1", column: "paralegal", toStaffId: 6 },
      ],
      BOARDS,
      staff,
    );
    expect(writes).toEqual([]);
    expect(skipped.map((s) => s.reason)).toEqual([
      "No longer assigned to this person",
      "No longer assigned to this person",
      "Not synced to Monday yet",
      "No attorney column configured for this board",
      "No Monday has no Monday account to assign",
    ]);
  });
});

describe("applyLocalReassignment", () => {
  function caseDb() {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE board_items (local_id TEXT, paralegals TEXT, attorney TEXT, column_values TEXT);
             CREATE TABLE contracts (local_id TEXT, raw_column_values TEXT);`);
    db.prepare("INSERT INTO board_items VALUES ('f1', 'Old P, Ana', 'Lucy', ?)").run(JSON.stringify({ paralegal: { label: "Old P, Ana" } }));
    db.prepare("INSERT INTO contracts VALUES ('k1', ?)").run(JSON.stringify({ paralegal: { label: "Old P" }, attorney: { label: "Lucy" } }));
    return db;
  }
  const gone = (n: string) => n === "Old P";

  test("updates the flat column and the JSON copy of a board item", () => {
    const db = caseDb();
    applyLocalReassignment(db, { table: "board_items", localId: "f1", column: "paralegal", to: { name: "Mayra" } }, gone);
    const row = db.prepare("SELECT paralegals, column_values FROM board_items").get() as { paralegals: string; column_values: string };
    expect(row.paralegals).toBe("Ana, Mayra");
    expect(JSON.parse(row.column_values).paralegal.label).toBe("Ana, Mayra");
  });

  test("updates a Fee K's raw values; removing the only person empties the column", () => {
    const db = caseDb();
    applyLocalReassignment(db, { table: "contracts", localId: "k1", column: "paralegal", to: null }, gone);
    const raw = JSON.parse((db.prepare("SELECT raw_column_values AS r FROM contracts").get() as { r: string }).r);
    expect(raw.paralegal).toBeNull();
    expect(raw.attorney.label).toBe("Lucy");
  });
});

describe("checklist", () => {
  test("start once, tick and untick steps, all done only when every step is ticked", () => {
    const db = new Database(":memory:");
    db.exec(createStaffTablesSql);
    db.exec(createOffboardingTableSql);
    const id = createStaff(db, { name: "Old P" });
    expect(startOffboarding(db, id, 1)).toBe(true);
    expect(startOffboarding(db, id, 1)).toBe(false);
    for (const s of ["monday_seat", "microsoft_365", "ringcentral"] as const) setManualStep(db, id, s, true, "admin@firm.com");
    expect(allStepsDone(getOffboarding(db, id))).toBe(false);
    setManualStep(db, id, "slack", true, null);
    expect(allStepsDone(getOffboarding(db, id))).toBe(true);
    setManualStep(db, id, "slack", false, null);
    expect(getOffboarding(db, id)!.steps.slack).toBeUndefined();
  });
});
