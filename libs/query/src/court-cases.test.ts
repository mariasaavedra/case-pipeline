// =============================================================================
// Court Cases Query Tests
// =============================================================================

import { test, expect, describe } from "vitest";
import Database from "better-sqlite3";
type DatabaseInstance = InstanceType<typeof Database>;
import { initializeSchema } from "@case-pipeline/seed/db/schema";
import { getCourtCases, parseHearing, readinessOf, NO_PREP_STAGE } from "./court-cases";

// =============================================================================
// Helpers
// =============================================================================

const TODAY = "2026-09-30";
const T = { trialBehindDays: 60, trialAtRiskDays: 90, mchBehindDays: 14 };

function freshDb(): DatabaseInstance {
  const db = new Database(":memory:");
  initializeSchema(db);
  db.prepare("INSERT INTO seed_batches (batch_name, seed_value, status) VALUES ('test', 1, 'complete')").run();
  db.prepare("INSERT INTO profiles (batch_id, local_id, name) VALUES (1, 'p1', 'Ana LOPEZ')").run();
  return db;
}

interface CaseOpts {
  localId: string;
  name?: string;
  group?: string;
  profile?: string | null;
  hearing?: string;
  nextDate?: string;
  type?: string;
  status?: string;
  stage?: string;
  method?: string;
  judge?: string;
  paralegals?: string;
  deleted?: boolean;
}

function insertCase(db: DatabaseInstance, o: CaseOpts) {
  const cv = {
    ...(o.hearing ? { hearing_date_calendaring: o.hearing } : {}),
    ...(o.type ? { hearing_type: { label: o.type } } : {}),
    ...(o.status ? { hearing_status: { label: o.status } } : {}),
    ...(o.stage ? { case_prep_status: { label: o.stage } } : {}),
    ...(o.method ? { method: { label: o.method } } : {}),
    ...(o.judge ? { judge_connected: o.judge } : {}),
    a_number: "213-469-865",
    ecas_or_eservice: { label: "ECAS" },
  };
  db.prepare(`
    INSERT INTO board_items (batch_id, local_id, board_key, group_title, name, profile_local_id, attorney, paralegals, next_date, column_values, deleted_at)
    VALUES (1, ?, 'court_cases', ?, ?, ?, 'Lucy Betteridge', ?, ?, ?, ?)
  `).run(
    o.localId, o.group ?? "Court Case", o.name ?? `LB - Case ${o.localId}`,
    o.profile === undefined ? "p1" : o.profile, o.paralegals ?? "Mayra Ruiz", o.nextDate ?? null,
    JSON.stringify(cv), o.deleted ? "2026-09-01" : null,
  );
}

const get = (db: DatabaseInstance) => getCourtCases(db, { today: TODAY });
const byId = (db: DatabaseInstance) => Object.fromEntries(get(db).cases.map((c) => [c.localId, c]));

// =============================================================================
// Tests
// =============================================================================

describe("parseHearing", () => {
  test("mirror string with time", () => {
    expect(parseHearing("2026-11-24 11:30", TODAY)).toEqual({ date: "2026-11-24", time: "11:30" });
  });
  test("date column object", () => {
    expect(parseHearing({ date: "2026-11-24", time: "09:00:00" }, TODAY)).toEqual({ date: "2026-11-24", time: "09:00" });
  });
  test("several dates: the first upcoming wins, else the latest", () => {
    expect(parseHearing("2026-08-01 10:00, 2026-12-01 09:00, 2027-01-05", TODAY)?.date).toBe("2026-12-01");
    expect(parseHearing("2026-08-01, 2026-09-01", TODAY)?.date).toBe("2026-09-01");
  });
  test("garbage is null", () => {
    expect(parseHearing("", TODAY)).toBeNull();
    expect(parseHearing("TBD", TODAY)).toBeNull();
    expect(parseHearing(null, TODAY)).toBeNull();
  });
});

describe("readinessOf", () => {
  test("trial: before stage 3 within 60 days is behind, within 90 at risk", () => {
    expect(readinessOf("trial", "2 - MCH Prep", 45, T)).toBe("behind");
    expect(readinessOf("trial", "TRIAL Sched. - Needs Review - Payment?", 75, T)).toBe("at_risk");
    expect(readinessOf("trial", "1 - Initial Set Up", 120, T)).toBe("on_track");
    expect(readinessOf("trial", "3 - Trial Prep", 10, T)).toBe("on_track");
    expect(readinessOf("trial", null, 30, T)).toBe("behind");
  });
  test("MCH: still in set-up within 14 days is behind", () => {
    expect(readinessOf("mch", "1 - Initial Set Up", 7, T)).toBe("behind");
    expect(readinessOf("mch", "Look into this", 14, T)).toBe("behind");
    expect(readinessOf("mch", "2 - MCH Prep", 3, T)).toBe("on_track");
    expect(readinessOf("mch", "1 - Initial Set Up", 30, T)).toBe("on_track");
  });
  test("no upcoming hearing, or an exception stage, is not judged", () => {
    expect(readinessOf("trial", "2 - MCH Prep", -3, T)).toBe("n_a");
    expect(readinessOf("trial", "2 - MCH Prep", null, T)).toBe("n_a");
    expect(readinessOf("trial", "MTWD Pending", 10, T)).toBe("n_a");
    expect(readinessOf("other", "1 - Initial Set Up", 5, T)).toBe("n_a");
  });
});

describe("getCourtCases", () => {
  test("only live cases in the Court Case group", () => {
    const db = freshDb();
    insertCase(db, { localId: "active" });
    insertCase(db, { localId: "inactive", group: "Inactive Court Cases" });
    insertCase(db, { localId: "gone", deleted: true });
    expect(get(db).cases.map((c) => c.localId)).toEqual(["active"]);
    db.close();
  });

  test("reads the hearing, judge, method and people", () => {
    const db = freshDb();
    insertCase(db, {
      localId: "a", hearing: "2026-11-24 11:30", type: "Trial", judge: "Colin Johnson",
      method: "In-Person NEEDS WEBEX", stage: "3 - Trial Prep", paralegals: "Mayra Ruiz, Walter Taborda",
    });
    expect(byId(db).a).toMatchObject({
      clientName: "Ana LOPEZ", hearingDate: "2026-11-24", hearingTime: "11:30", daysToHearing: 55,
      hearingKind: "trial", judge: "Colin Johnson", needsWebex: true, detained: false,
      paralegals: ["Mayra Ruiz", "Walter Taborda"], service: "ECAS", aNumber: "213-469-865",
      readiness: "on_track", flags: [],
    });
    db.close();
  });

  test("falls back to the Next Hearing Date column", () => {
    const db = freshDb();
    insertCase(db, { localId: "a", nextDate: "2026-10-10" });
    expect(byId(db).a).toMatchObject({ hearingDate: "2026-10-10", hearingTime: null, daysToHearing: 10 });
    db.close();
  });

  test("flags data problems", () => {
    const db = freshDb();
    insertCase(db, { localId: "past", hearing: "2026-09-01" });
    insertCase(db, { localId: "awaiting", hearing: "2026-06-01", type: "AWAITING NEW DATE", stage: "2 - MCH Prep" });
    insertCase(db, { localId: "awaitingName", name: "LB - [AWAITING NEW DATE**] - X" });
    insertCase(db, { localId: "nodate" });
    insertCase(db, { localId: "noprofile", hearing: "2026-10-20", profile: null });
    insertCase(db, { localId: "connect", hearing: "2026-10-20", status: "CONNECT PROFILE" });
    const c = byId(db);
    expect(c.past!.flags).toEqual(["past_hearing"]);
    expect(c.awaiting!.flags).toEqual(["awaiting_new_date"]);
    expect(c.awaiting!.readiness).toBe("n_a");
    expect(c.awaitingName!.flags).toEqual(["awaiting_new_date"]);
    expect(c.nodate!.flags).toEqual(["no_hearing_date"]);
    expect(c.noprofile!.flags).toEqual(["connect_profile"]);
    expect(c.connect!.flags).toEqual(["connect_profile"]);
    db.close();
  });

  test("order: upcoming soonest first, then past (recent first), then undated", () => {
    const db = freshDb();
    insertCase(db, { localId: "undated" });
    insertCase(db, { localId: "pastOld", hearing: "2026-05-01" });
    insertCase(db, { localId: "later", hearing: "2026-12-01" });
    insertCase(db, { localId: "pastRecent", hearing: "2026-09-20" });
    insertCase(db, { localId: "soon", hearing: "2026-10-02 09:00" });
    expect(get(db).cases.map((c) => c.localId)).toEqual(["soon", "later", "pastRecent", "pastOld", "undated"]);
    db.close();
  });

  test("stages in workflow order, exceptions after, unset last", () => {
    const db = freshDb();
    insertCase(db, { localId: "a", stage: "Look into this" });
    insertCase(db, { localId: "b", stage: "3 - Trial Prep" });
    insertCase(db, { localId: "c" });
    insertCase(db, { localId: "d", stage: "1 - Initial Set Up" });
    insertCase(db, { localId: "e", stage: "Brand new label" });
    expect(get(db).stages).toEqual(["1 - Initial Set Up", "3 - Trial Prep", "Brand new label", "Look into this", NO_PREP_STAGE]);
    db.close();
  });

  test("stage options and column id come from the synced board schema", () => {
    const db = freshDb();
    expect(get(db)).toMatchObject({ stageOptions: [], stageColumnId: null });
    db.prepare(`
      INSERT INTO board_columns (board_key, monday_board_id, column_id, title, type, options)
      VALUES ('court_cases', '123', 'color_mkp7t3ds', 'Case Prep Status', 'status', ?)
    `).run(JSON.stringify([{ label: "WD Warning" }, { label: "2 - MCH Prep" }, { label: "1 - Initial Set Up" }]));
    expect(get(db)).toMatchObject({
      stageOptions: ["1 - Initial Set Up", "2 - MCH Prep", "WD Warning"],
      stageColumnId: "color_mkp7t3ds",
    });
    db.close();
  });
});
