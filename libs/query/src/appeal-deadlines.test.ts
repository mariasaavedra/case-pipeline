// =============================================================================
// Appeal & Federal Deadlines Tests
// =============================================================================

import { test, expect, describe } from "vitest";
import Database from "better-sqlite3";
type DatabaseInstance = InstanceType<typeof Database>;
import { initializeSchema } from "@case-pipeline/seed/db/schema";
import { getAppealDeadlineItems, removalDateFromName, lastHearingOnOrBefore } from "./appeal-deadlines";

const TODAY = "2026-10-02";

function freshDb(): DatabaseInstance {
  const db = new Database(":memory:");
  initializeSchema(db);
  db.prepare("INSERT INTO seed_batches (batch_name, seed_value, status) VALUES ('test', 1, 'complete')").run();
  db.prepare("INSERT INTO profiles (batch_id, local_id, name) VALUES (1, 'p1', 'Ana LOPEZ')").run();
  return db;
}

function insert(db: DatabaseInstance, o: { localId: string; board: string; name: string; status?: string; attorney?: string; cv: Record<string, unknown>; deleted?: boolean }) {
  db.prepare(`
    INSERT INTO board_items (batch_id, local_id, board_key, name, status, profile_local_id, attorney, column_values, deleted_at)
    VALUES (1, ?, ?, ?, ?, 'p1', ?, ?, ?)
  `).run(o.localId, o.board, o.name, o.status ?? null, o.attorney ?? "Lucy Betteridge", JSON.stringify(o.cv), o.deleted ? "2026-09-01" : null);
}

const items = (db: DatabaseInstance, attorney?: string) => getAppealDeadlineItems(db, { today: TODAY, attorney });
const byId = (db: DatabaseInstance) => Object.fromEntries(items(db).map((i) => [i.localId, i]));

describe("removalDateFromName", () => {
  test("reads the first dated removal order", () => {
    expect(removalDateFromName("[ORDERED REMOVED 9/17/26 -  (orig. 8/25/26) - NO JO YET] - M - Fabiola")).toBe("2026-09-17");
    expect(removalDateFromName("LB - [MTN TO RECON. FILED 9/14/26] - ORDERED REMOVED 8/19/26] - X")).toBe("2026-08-19");
    expect(removalDateFromName("[ORDERED REMOVED] LB - Alonzo")).toBeNull();
  });
});

describe("lastHearingOnOrBefore", () => {
  test("latest past hearing from the Calendaring mirror", () => {
    expect(lastHearingOnOrBefore("2026-08-01 10:00, 2026-09-14 12:30, 2026-12-01 09:00", TODAY)).toBe("2026-09-14");
    expect(lastHearingOnOrBefore("2026-12-01 09:00", TODAY)).toBeNull();
  });
});

describe("removal orders", () => {
  test("Appealing? → due 30 days after the removal date in the name", () => {
    const db = freshDb();
    insert(db, { localId: "c1", board: "court_cases", name: "[ORDERED REMOVED 9/17/26 - NO JO YET] - LB - Dalila", cv: { hearing_status: { label: "REMOVED - Appealing?" } } });
    const i = byId(db).c1!;
    expect(i.date).toBe("2026-10-17");
    expect(i.daysLeft).toBe(15);
    expect(i.status).toBe("REMOVED - Appealing?");
    expect(i.detail).toContain("BIA appeal due Oct 17");
    expect(i.detail).toContain("no judge order yet");
  });

  test("falls back to the last hearing date; an Appealing? case past its deadline stays listed", () => {
    const db = freshDb();
    insert(db, { localId: "c1", board: "court_cases", name: "LB - Marlen", cv: { hearing_status: { label: "REMOVED - Appealing?" }, hearing_date_calendaring: "2026-08-19 10:30" } });
    const i = byId(db).c1!;
    expect(i.date).toBe("2026-09-18");
    expect(i.daysOverdue).toBe(14);
    expect(i.detail).toContain("(last hearing date)");
  });

  test("Ordered Removed only while the 30 days are still running; appeal filed never", () => {
    const db = freshDb();
    insert(db, { localId: "recent", board: "court_cases", name: "[ORDERED REMOVED 9/20/26] - A", cv: { hearing_status: { label: "Ordered Removed" } } });
    insert(db, { localId: "old", board: "court_cases", name: "[ORDERED REMOVED 8/12/26] - B", cv: { hearing_status: { label: "Ordered Removed" } } });
    insert(db, { localId: "undated", board: "court_cases", name: "C (Det. at Chase)", cv: { hearing_status: { label: "Ordered Removed" } } });
    insert(db, { localId: "filed", board: "court_cases", name: "[BIA APPEAL FILED 9/4/26] - D", cv: { hearing_status: { label: "REMOVED - Appealing?" } } });
    insert(db, { localId: "gone", board: "court_cases", name: "[ORDERED REMOVED 9/20/26] - E", cv: { hearing_status: { label: "REMOVED - Appealing?" } }, deleted: true });
    expect(Object.keys(byId(db))).toEqual(["recent"]);
  });

  test("Appealing? with no date at all is listed, undated, at the end", () => {
    const db = freshDb();
    insert(db, { localId: "nodate", board: "court_cases", name: "F", cv: { hearing_status: { label: "REMOVED - Appealing?" } } });
    insert(db, { localId: "dated", board: "court_cases", name: "[ORDERED REMOVED 9/20/26] - G", cv: { hearing_status: { label: "REMOVED - Appealing?" } } });
    const list = items(db);
    expect(list.map((i) => i.localId)).toEqual(["dated", "nodate"]);
    expect(list[1]!.date).toBeNull();
    expect(list[1]!.detail).toContain("no removal date");
  });
});

describe("Appeals board", () => {
  test("appeal due and not filed; filed, not hired and far-off ones are skipped", () => {
    const db = freshDb();
    insert(db, { localId: "due", board: "appeals", name: "BIA - A", status: "Submitted", cv: { appeal_due: { date: "2026-10-10" } } });
    insert(db, { localId: "filed", board: "appeals", name: "BIA - B", status: "Submitted", cv: { appeal_due: { date: "2026-10-10" }, appeal_filed_on: { date: "2026-10-01" } } });
    insert(db, { localId: "nohire", board: "appeals", name: "BIA - C", status: "Did not hire", cv: { appeal_due: { date: "2026-10-10" } } });
    insert(db, { localId: "far", board: "appeals", name: "BIA - D", cv: { appeal_due: { date: "2027-01-10" } } });
    insert(db, { localId: "ancient", board: "appeals", name: "BIA - E", cv: { appeal_due: { date: "2022-09-16" } } });
    const ms = byId(db);
    expect(Object.keys(ms)).toEqual(["due"]);
    expect(ms.due!.detail).toBe("Appeal due Oct 10, not filed yet");
  });

  test("briefing schedule due and no brief filed", () => {
    const db = freshDb();
    insert(db, { localId: "brief", board: "appeals", name: "BIA - F", cv: { appeal_filed_on: { date: "2026-08-01" }, brief_sched_due: { date: "2026-10-20" } } });
    insert(db, { localId: "briefed", board: "appeals", name: "BIA - G", cv: { brief_sched_due: { date: "2026-10-20" }, brief_filed_on: { date: "2026-10-01" } } });
    expect(Object.keys(byId(db))).toEqual(["brief"]);
    expect(byId(db).brief!.detail).toBe("BIA brief due Oct 20, not filed yet");
  });
});

describe("Litigation", () => {
  test("due within 14 days on an open complaint", () => {
    const db = freshDb();
    insert(db, { localId: "soon", board: "litigation", name: "Habeas - A", cv: { due_date: { date: "2026-10-09" }, work_due: "Reply", status_of_complaint: { label: "Filed" } } });
    insert(db, { localId: "later", board: "litigation", name: "Habeas - B", cv: { due_date: { date: "2026-11-30" }, status_of_complaint: { label: "Filed" } } });
    insert(db, { localId: "past", board: "litigation", name: "Habeas - C", cv: { due_date: { date: "2026-09-30" }, status_of_complaint: { label: "Filed" } } });
    insert(db, { localId: "done", board: "litigation", name: "PFR - D", cv: { due_date: { date: "2026-10-05" }, status_of_complaint: { label: "Dismissed" } } });
    const ms = byId(db);
    expect(Object.keys(ms)).toEqual(["soon"]);
    expect(ms.soon!.detail).toBe("Reply due Oct 9");
    expect(ms.soon!.daysLeft).toBe(7);
  });
});

test("attorney filter", () => {
  const db = freshDb();
  insert(db, { localId: "a", board: "appeals", name: "BIA - A", attorney: "Bradley Burke", cv: { appeal_due: { date: "2026-10-10" } } });
  insert(db, { localId: "b", board: "appeals", name: "BIA - B", cv: { appeal_due: { date: "2026-10-12" } } });
  expect(items(db, "Bradley Burke").map((i) => i.localId)).toEqual(["a"]);
});
