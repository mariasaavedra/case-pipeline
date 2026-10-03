// =============================================================================
// Court Motions Query Tests
// =============================================================================

import { test, expect, describe } from "vitest";
import Database from "better-sqlite3";
type DatabaseInstance = InstanceType<typeof Database>;
import { initializeSchema } from "@case-pipeline/seed/db/schema";
import { getCourtMotions, phaseOf, motionAgeOf } from "./court-motions";
import { getCourtCases } from "./court-cases";

const TODAY = "2026-09-30";

function freshDb(): DatabaseInstance {
  const db = new Database(":memory:");
  initializeSchema(db);
  db.prepare("INSERT INTO seed_batches (batch_name, seed_value, status) VALUES ('test', 1, 'complete')").run();
  db.prepare("INSERT INTO profiles (batch_id, local_id, name) VALUES (1, 'p1', 'Ana LOPEZ')").run();
  return db;
}

function insertCase(db: DatabaseInstance, localId: string, mondayId: string, o: { group?: string; hearing?: string } = {}) {
  db.prepare(`
    INSERT INTO board_items (batch_id, local_id, monday_item_id, board_key, group_title, name, profile_local_id, column_values)
    VALUES (1, ?, ?, 'court_cases', ?, ?, 'p1', ?)
  `).run(localId, mondayId, o.group ?? "Court Case", `LB - Case ${localId}`,
    JSON.stringify(o.hearing ? { hearing_date_calendaring: o.hearing } : {}));
}

function insertMotion(
  db: DatabaseInstance,
  localId: string,
  o: { group: string; status?: string; caseId?: string | null; types?: string[]; filed?: string; decided?: string; profile?: string | null },
) {
  const cv = {
    ...(o.types ? { motion: { labels: o.types } } : {}),
    ...(o.caseId ? { court_case: { linked_item_ids: [o.caseId], display_value: "LB - Case" } } : {}),
    ...(o.filed ? { mtn_filed_on: { date: o.filed } } : {}),
    ...(o.decided ? { dec_date: { date: o.decided } } : {}),
    judge: "Justin Howard",
  };
  db.prepare(`
    INSERT INTO board_items (batch_id, local_id, board_key, group_title, name, status, profile_local_id, attorney, paralegals, column_values)
    VALUES (1, ?, 'motions', ?, ?, ?, ?, 'Lucy Betteridge', 'Mayra Ruiz', ?)
  `).run(localId, o.group, `CR - [MTC] - ${localId}`, o.status ?? null, o.profile === undefined ? "p1" : o.profile, JSON.stringify(cv));
}

const byId = (db: DatabaseInstance, hearings?: Map<string, string | null>) =>
  Object.fromEntries(getCourtMotions(db, { today: TODAY, hearings }).map((m) => [m.localId, m]));

describe("phaseOf", () => {
  test("group decides, status wins when it records a decision", () => {
    expect(phaseOf("Motions to be sent", "Assigned")).toBe("to_send");
    expect(phaseOf("ATTY BRIEF", "NO TRIAL DATE YET")).toBe("to_send");
    expect(phaseOf("Filed/Waiting for IJ", "Filed")).toBe("waiting");
    expect(phaseOf("Filed/Waiting for IJ", "Granted - NO JUDGE ORDER")).toBe("granted");
    expect(phaseOf("Filed/Waiting for IJ", "Denied - NO JO")).toBe("denied");
    expect(phaseOf("Filed/Waiting for IJ", "Withdrawn")).toBe("closed");
    expect(phaseOf("Not Proceeding", "Not Proceeding")).toBe("closed");
    expect(phaseOf("North Pole", "North Pole")).toBe("closed");
  });
});

describe("motionAgeOf", () => {
  test("60 / 90 day thresholds", () => {
    expect(motionAgeOf(null)).toBe("unknown");
    expect(motionAgeOf(59)).toBe("fresh");
    expect(motionAgeOf(60)).toBe("waiting");
    expect(motionAgeOf(90)).toBe("late");
  });
});

describe("getCourtMotions", () => {
  test("links the court case by Monday id and ages waiting motions", () => {
    const db = freshDb();
    insertCase(db, "c1", "111");
    insertMotion(db, "m1", { group: "Filed/Waiting for IJ", status: "Filed", caseId: "111", types: ["MTC"], filed: "2026-06-01" });
    const m = byId(db).m1!;
    expect(m.courtCaseLocalId).toBe("c1");
    expect(m.courtCaseActive).toBe(true);
    expect(m.types).toEqual(["MTC"]);
    expect(m.daysWaiting).toBe(121);
    expect(m.age).toBe("late");
    expect(m.flags).toEqual([]);
  });

  test("flags: no court case, case closed, no filed date, no judge order", () => {
    const db = freshDb();
    insertCase(db, "c2", "222", { group: "Withdrew" });
    insertMotion(db, "a", { group: "Motions to be sent", caseId: null });
    insertMotion(db, "b", { group: "Filed/Waiting for IJ", status: "Filed", caseId: "222", filed: "2026-09-01" });
    insertMotion(db, "c", { group: "Filed/Waiting for IJ", status: "Filed", caseId: null });
    insertMotion(db, "d", { group: "Filed/Waiting for IJ", status: "Granted - NO JUDGE ORDER", caseId: null });
    const ms = byId(db);
    expect(ms.a!.flags).toEqual(["no_court_case"]);
    expect(ms.b!.flags).toEqual(["case_closed"]);
    expect(ms.c!.flags).toEqual(["no_court_case", "no_filed_date"]);
    // Decided motions aren't flagged for a missing case link, only for the order.
    expect(ms.d!.flags).toEqual(["no_judge_order"]);
  });

  test("hearing soon only for open motions on active cases", () => {
    const db = freshDb();
    insertCase(db, "c1", "111");
    insertMotion(db, "open", { group: "Filed/Waiting for IJ", status: "Filed", caseId: "111", filed: "2026-09-01" });
    insertMotion(db, "done", { group: "Granted", status: "Granted", caseId: "111", decided: "2026-09-20" });
    const ms = byId(db, new Map([["c1", "2026-10-08"]]));
    expect(ms.open!.daysToHearing).toBe(8);
    expect(ms.open!.hearingSoon).toBe(true);
    expect(ms.done!.hearingSoon).toBe(false);
    expect(ms.done!.decidedOn).toBe("2026-09-20");
  });

  test("no profile on the motion → the court case's client", () => {
    const db = freshDb();
    insertCase(db, "c1", "111");
    insertMotion(db, "m", { group: "Motions to be sent", caseId: "111", profile: null });
    const m = byId(db).m!;
    expect(m.clientLocalId).toBe("p1");
    expect(m.clientName).toBe("Ana LOPEZ");
    expect(m.flags).toEqual([]);
  });
});

describe("getCourtCases → openMotions", () => {
  test("open motions are attached to their active case; decided ones are not", () => {
    const db = freshDb();
    insertCase(db, "c1", "111", { hearing: "2026-10-05 09:00" });
    insertMotion(db, "w", { group: "Filed/Waiting for IJ", status: "Filed", caseId: "111", types: ["MTC"], filed: "2026-09-10" });
    insertMotion(db, "s", { group: "Motions to be sent", caseId: "111", types: ["BONDMTN"] });
    insertMotion(db, "g", { group: "Granted", status: "Granted", caseId: "111" });
    const r = getCourtCases(db, { today: TODAY });
    const c = r.cases.find((x) => x.localId === "c1")!;
    expect(c.openMotions.map((m) => m.localId).sort()).toEqual(["s", "w"]);
    expect(r.motions).toHaveLength(3);
    expect(r.motions.find((m) => m.localId === "w")!.hearingSoon).toBe(true);
  });
});
