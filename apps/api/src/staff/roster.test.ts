import { describe, test, expect } from "vitest";
import Database from "better-sqlite3";
import { createStaffTablesSql } from "./schema.js";
import {
  normName,
  createStaff,
  addAlias,
  reassignAlias,
  setRoles,
  listStaff,
  resolveStaffByName,
  staffForUser,
  refreshStaff,
  unmatchedBoardNames,
  AliasTakenError,
  type BoardNames,
} from "./roster.js";

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE users (
    id INTEGER PRIMARY KEY, azure_oid TEXT UNIQUE NOT NULL, email TEXT NOT NULL, name TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1, monday_name TEXT, paralegal_link TEXT, attorney_board TEXT, staff_id INTEGER
  )`);
  db.exec(createStaffTablesSql);
  return db;
}

function names(paralegals: Record<string, number>, attorneys: Record<string, number> = {}): BoardNames {
  return { paralegals: new Map(Object.entries(paralegals)), attorneys: new Map(Object.entries(attorneys)) };
}

describe("normName", () => {
  test("ignores case, accents and spacing", () => {
    expect(normName("  María   Ruíz ")).toBe("maria ruiz");
  });
});

describe("resolveStaffByName", () => {
  test("matches the name and any alias, inactive people included", () => {
    const db = makeDb();
    const id = createStaff(db, { name: "Mayra Ruiz", active: false });
    addAlias(db, id, "Mayra R.");
    expect(resolveStaffByName(db, "mayra ruiz")?.id).toBe(id);
    expect(resolveStaffByName(db, "MAYRA R.")?.active).toBe(false);
    expect(resolveStaffByName(db, "Someone Else")).toBeNull();
    expect(resolveStaffByName(db, null)).toBeNull();
  });

  test("an alias can't be taken twice unless moved on purpose", () => {
    const db = makeDb();
    const a = createStaff(db, { name: "Ana Lopez" });
    const b = createStaff(db, { name: "Ana L.", source: "board_name", active: false });
    expect(() => addAlias(db, a, "ana l.")).toThrow(AliasTakenError);
    reassignAlias(db, a, "Ana L.");
    expect(resolveStaffByName(db, "Ana L.")?.id).toBe(a);
    // The board_name row has no names left, so it's gone.
    expect(listStaff(db).map((s) => s.id)).not.toContain(b);
  });
});

describe("refreshStaff", () => {
  test("adds Monday users, then unmatched board names as inactive", () => {
    const db = makeDb();
    const r = refreshStaff(db, {
      workspaceUsers: [{ id: "11", name: "Mayra Ruiz", email: "mayra@firm.com" }],
      boardNames: names({ "Mayra Ruiz": 4, "Old Paralegal": 2 }, { "Lucy Betteridge": 3 }),
      attorneyBoards: [{ boardKey: "appointments_lb", attorneyName: "Lucy Betteridge", displayName: "LB" }],
    });
    expect(r.mondayAdded).toBe(1);
    expect(r.boardNamesAdded).toBe(2);
    const staff = listStaff(db);
    const mayra = staff.find((s) => s.name === "Mayra Ruiz")!;
    expect(mayra).toMatchObject({ mondayUserId: "11", active: true, source: "monday", roles: ["paralegal"] });
    const old = staff.find((s) => s.name === "Old Paralegal")!;
    expect(old).toMatchObject({ active: false, source: "board_name", roles: ["paralegal"] });
    const lucy = staff.find((s) => s.name === "Lucy Betteridge")!;
    expect(lucy).toMatchObject({ roles: ["attorney"], attorneyBoard: "appointments_lb" });
  });

  test("a board_name row becomes the Monday user once Monday lists them", () => {
    const db = makeDb();
    refreshStaff(db, { workspaceUsers: null, boardNames: names({ "Ana Lopez": 1 }), attorneyBoards: [] });
    refreshStaff(db, {
      workspaceUsers: [{ id: "22", name: "Ana Lopez", email: "ana@firm.com" }],
      boardNames: names({ "Ana Lopez": 1 }),
      attorneyBoards: [],
    });
    const staff = listStaff(db);
    expect(staff).toHaveLength(1);
    expect(staff[0]).toMatchObject({ mondayUserId: "22", source: "monday", active: true, email: "ana@firm.com" });
  });

  test("never re-suggests roles an admin has reviewed", () => {
    const db = makeDb();
    const input = { workspaceUsers: null, boardNames: names({ "Ana Lopez": 1 }), attorneyBoards: [] };
    refreshStaff(db, input);
    const ana = listStaff(db)[0]!;
    setRoles(db, ana.id, ["reception"]);
    const r = refreshStaff(db, input);
    expect(r.rolesSuggested).toBe(0);
    expect(listStaff(db)[0]!.roles).toEqual(["reception"]);
  });

  test("links logins and carries over paralegal_link + attorney_board", () => {
    const db = makeDb();
    db.prepare(
      "INSERT INTO users (azure_oid, email, name, paralegal_link, attorney_board) VALUES ('o1', 'x@firm.com', 'Mayra R', 'Mayra Ruiz', NULL)",
    ).run();
    db.prepare(
      "INSERT INTO users (azure_oid, email, name, attorney_board) VALUES ('o2', 'lucy@firm.com', 'Lucy B', 'appointments_lb')",
    ).run();
    const r = refreshStaff(db, {
      workspaceUsers: [{ id: "33", name: "Lucy Betteridge", email: "lucy@firm.com" }],
      boardNames: names({ "Mayra Ruiz": 1 }),
      attorneyBoards: [],
    });
    expect(r.loginsLinked).toBe(2);
    const lucy = listStaff(db).find((s) => s.name === "Lucy Betteridge")!;
    expect(lucy.attorneyBoard).toBe("appointments_lb");
    expect(lucy.login?.email).toBe("lucy@firm.com");
    const mayraLogin = db.prepare("SELECT * FROM users WHERE azure_oid = 'o1'").get() as {
      email: string; name: string; staff_id: number | null;
    };
    expect(staffForUser(db, mayraLogin)?.name).toBe("Mayra Ruiz");
    // Without the stored link, neither the email nor "Mayra R" identifies her.
    expect(staffForUser(db, { ...mayraLogin, staff_id: null })).toBeNull();
  });

  test("reports active Monday people the workspace no longer lists", () => {
    const db = makeDb();
    refreshStaff(db, { workspaceUsers: [{ id: "1", name: "A", email: "" }], boardNames: names({}), attorneyBoards: [] });
    const r = refreshStaff(db, { workspaceUsers: [], boardNames: names({}), attorneyBoards: [] });
    expect(r.missingFromMonday).toEqual(["A"]);
  });
});

describe("unmatchedBoardNames", () => {
  test("lists names no one holds, busiest first", () => {
    const db = makeDb();
    createStaff(db, { name: "Known" });
    expect(unmatchedBoardNames(db, names({ Known: 5, X: 1, Y: 3 }, { X: 4 }))).toEqual([
      { name: "X", items: 5 },
      { name: "Y", items: 3 },
    ]);
  });
});
