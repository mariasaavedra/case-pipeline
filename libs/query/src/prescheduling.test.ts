// =============================================================================
// Prescheduling Query Tests
// =============================================================================

import { test, expect, describe } from "vitest";
import Database from "better-sqlite3";
type DatabaseInstance = InstanceType<typeof Database>;
import { initializeSchema } from "@case-pipeline/seed/db/schema";
import { getPrescheduling, NO_STAGE } from "./prescheduling";

// =============================================================================
// Helpers
// =============================================================================

const TODAY = "2026-09-30";

function freshDb(): DatabaseInstance {
  const db = new Database(":memory:");
  initializeSchema(db);
  db.prepare("INSERT INTO seed_batches (batch_name, seed_value, status) VALUES ('test', 1, 'complete')").run();
  db.prepare("INSERT INTO profiles (batch_id, local_id, name) VALUES (1, 'p1', 'Ana LOPEZ')").run();
  return db;
}

interface FeeKOpts {
  localId: string;
  group?: string;
  psStage?: string;
  hireDate?: string;
  reminder?: string;
  evidence?: string;
  paralegal?: string;
  contractFor?: string[];
  northPoleUntil?: string;
  deleted?: boolean;
}

function insertFeeK(db: DatabaseInstance, o: FeeKOpts) {
  const cv = {
    ...(o.psStage ? { ps_stage: { label: o.psStage } } : {}),
    ...(o.hireDate ? { hire_date: { date: o.hireDate } } : {}),
    ...(o.reminder ? { reminder_sent_checked_on: { date: o.reminder } } : {}),
    ...(o.evidence ? { evidence_received_date: { date: o.evidence } } : {}),
    ...(o.paralegal ? { paralegal: { label: o.paralegal } } : {}),
    ...(o.contractFor ? { contract_for: { labels: o.contractFor } } : {}),
    ...(o.northPoleUntil ? { north_pole_until: { date: o.northPoleUntil } } : {}),
    it_will_go_to: { label: "Open Forms" },
  };
  db.prepare(`
    INSERT INTO contracts (batch_id, local_id, profile_local_id, name, group_title, raw_column_values, deleted_at)
    VALUES (1, ?, 'p1', ?, ?, ?, ?)
  `).run(o.localId, `Fee K ${o.localId}`, o.group ?? "Paid Fee Ks", JSON.stringify(cv), o.deleted ? "2026-09-01" : null);
}

const get = (db: DatabaseInstance) => getPrescheduling(db, { today: TODAY });
const byId = (db: DatabaseInstance) => Object.fromEntries(get(db).cases.map((c) => [c.localId, c]));

// =============================================================================
// Tests
// =============================================================================

describe("getPrescheduling", () => {
  test("only live Paid Fee Ks are returned", () => {
    const db = freshDb();
    insertFeeK(db, { localId: "paid" });
    insertFeeK(db, { localId: "pending", group: "Pending Fee Ks" });
    insertFeeK(db, { localId: "gone", deleted: true });
    expect(get(db).cases.map((c) => c.localId)).toEqual(["paid"]);
    db.close();
  });

  test("wait level from days since hire (30 / 60 by default)", () => {
    const db = freshDb();
    insertFeeK(db, { localId: "fresh", hireDate: "2026-09-10" });
    insertFeeK(db, { localId: "waiting", hireDate: "2026-08-31" });
    insertFeeK(db, { localId: "late", hireDate: "2026-08-01" });
    insertFeeK(db, { localId: "nodate" });
    const c = byId(db);
    expect(c.fresh).toMatchObject({ waitLevel: "fresh", daysWaiting: 20 });
    expect(c.waiting).toMatchObject({ waitLevel: "waiting", daysWaiting: 30 });
    expect(c.late).toMatchObject({ waitLevel: "late", daysWaiting: 60 });
    expect(c.nodate).toMatchObject({ waitLevel: "unknown", daysWaiting: null });
    // Longest wait first, unknown last.
    expect(get(db).cases.map((x) => x.localId)).toEqual(["late", "waiting", "fresh", "nodate"]);
    db.close();
  });

  test("thresholds are configurable", () => {
    const db = freshDb();
    insertFeeK(db, { localId: "a", hireDate: "2026-09-10" });
    expect(getPrescheduling(db, { today: TODAY, waitingDays: 10, lateDays: 15 }).cases[0]!.waitLevel).toBe("late");
    db.close();
  });

  test("not cooperating: reminder 14+ days ago and no evidence since", () => {
    const db = freshDb();
    insertFeeK(db, { localId: "silent", reminder: "2026-09-01" });
    insertFeeK(db, { localId: "recent", reminder: "2026-09-25" });
    insertFeeK(db, { localId: "answered", reminder: "2026-09-01", evidence: "2026-09-10" });
    insertFeeK(db, { localId: "oldEvidence", reminder: "2026-09-01", evidence: "2026-08-01" });
    insertFeeK(db, { localId: "noReminder" });
    const c = byId(db);
    expect(c.silent!.notCooperating).toBe(true);
    expect(c.recent!.notCooperating).toBe(false);
    expect(c.answered!.notCooperating).toBe(false);
    expect(c.oldEvidence!.notCooperating).toBe(true);
    expect(c.noReminder!.notCooperating).toBe(false);
    db.close();
  });

  test("stages in workflow order, North Pole left out, unset stage last", () => {
    const db = freshDb();
    insertFeeK(db, { localId: "a", psStage: "Para Assigned" });
    insertFeeK(db, { localId: "b", psStage: "Need Evidence" });
    insertFeeK(db, { localId: "c" });
    insertFeeK(db, { localId: "d", psStage: "Send to North Pole" });
    insertFeeK(db, { localId: "e", psStage: "Need to contact client" });
    expect(get(db).stages).toEqual(["Need to contact client", "Need Evidence", "Para Assigned", NO_STAGE]);
    db.close();
  });

  test("North Pole cases are parked; snoozed only with a future return date", () => {
    const db = freshDb();
    insertFeeK(db, { localId: "future", psStage: "Send to North Pole", northPoleUntil: "2026-12-01" });
    insertFeeK(db, { localId: "past", psStage: "Send to North Pole", northPoleUntil: "2026-09-01" });
    insertFeeK(db, { localId: "none", psStage: "Send to North Pole" });
    insertFeeK(db, { localId: "back", psStage: "Back from North Pole", northPoleUntil: "2026-12-01" });
    const c = byId(db);
    expect(c.future).toMatchObject({ parked: true, snoozed: true, northPoleUntil: "2026-12-01" });
    expect(c.past).toMatchObject({ parked: true, snoozed: false });
    expect(c.none).toMatchObject({ parked: true, snoozed: false, northPoleUntil: null });
    expect(c.back).toMatchObject({ parked: false, snoozed: false, northPoleUntil: null });
    db.close();
  });

  test("client name from the profile; paralegals and contract types parsed", () => {
    const db = freshDb();
    insertFeeK(db, { localId: "a", paralegal: "Paola Barbosa, Cynthia de La Cruz", contractFor: ["I-130", "I-485"] });
    expect(get(db).cases[0]).toMatchObject({
      clientName: "Ana LOPEZ",
      clientLocalId: "p1",
      paralegals: ["Paola Barbosa", "Cynthia de La Cruz"],
      contractFor: ["I-130", "I-485"],
      itWillGoTo: "Open Forms",
    });
    db.close();
  });
});
