// =============================================================================
// Appointments Query Tests
// =============================================================================

import { test, expect, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { initializeSchema } from "../../scripts/seed/lib/db/schema";
import { getAppointments, getAttorneyList } from "./appointments";

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
    groupTitle?: string;
  },
) {
  db.run(
    `INSERT INTO board_items (batch_id, local_id, board_key, name, status, next_date, attorney, profile_local_id, group_title, column_values)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, '{}')`,
    [
      opts.localId,
      opts.boardKey,
      opts.name,
      opts.status ?? null,
      opts.nextDate ?? null,
      opts.attorney ?? null,
      opts.profileLocalId ?? null,
      opts.groupTitle ?? null,
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
    [opts.localId, opts.profileLocalId, opts.caseType, opts.caseType, opts.status, `CT-${opts.localId}`],
  );
}

function insertUpdate(
  db: Database,
  opts: {
    localId: string;
    profileLocalId: string;
    authorName: string;
    textBody: string;
    boardKey?: string;
  },
) {
  db.run(
    `INSERT INTO client_updates (batch_id, local_id, profile_local_id, author_name, text_body, source_type, created_at_source, board_key)
     VALUES (1, ?, ?, ?, ?, 'update', datetime('now'), ?)`,
    [opts.localId, opts.profileLocalId, opts.authorName, opts.textBody, opts.boardKey ?? null],
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

describe("getAppointments", () => {
  test("returns empty result on empty database", () => {
    const db = freshDb();
    const result = getAppointments(db, { date: todayStr() });
    expect(result.entries).toEqual([]);
    expect(result.attorneys).toEqual([]);
    db.close();
  });

  test("returns appointments for today", () => {
    const db = freshDb();
    insertProfile(db, { localId: "p1", name: "Maria Garcia", priority: "High" });

    insertBoardItem(db, {
      localId: "a1",
      boardKey: "appointments_r",
      name: "Initial Consultation",
      status: "Scheduled",
      nextDate: todayStr(),
      attorney: "R",
      profileLocalId: "p1",
    });

    const result = getAppointments(db, { date: todayStr(), range: "day" });
    expect(result.entries.length).toBe(1);
    expect(result.entries[0]!.appointment.name).toBe("Initial Consultation");
    expect(result.entries[0]!.profile?.name).toBe("Maria Garcia");
    expect(result.entries[0]!.profile?.priority).toBe("High");
    db.close();
  });

  test("filters by attorney", () => {
    const db = freshDb();
    insertProfile(db, { localId: "p1", name: "Maria Garcia" });
    insertProfile(db, { localId: "p2", name: "John Smith" });

    insertBoardItem(db, {
      localId: "a1",
      boardKey: "appointments_r",
      name: "Consult R",
      nextDate: todayStr(),
      attorney: "R",
      profileLocalId: "p1",
    });
    insertBoardItem(db, {
      localId: "a2",
      boardKey: "appointments_m",
      name: "Consult M",
      nextDate: todayStr(),
      attorney: "M",
      profileLocalId: "p2",
    });

    const resultR = getAppointments(db, { attorney: "R", date: todayStr() });
    expect(resultR.entries.length).toBe(1);
    expect(resultR.entries[0]!.appointment.attorney).toBe("R");

    const resultAll = getAppointments(db, { attorney: "all", date: todayStr() });
    expect(resultAll.entries.length).toBe(2);
    db.close();
  });

  test("week range includes appointments within 7 days", () => {
    const db = freshDb();
    insertProfile(db, { localId: "p1", name: "Maria Garcia" });

    const today = todayStr();
    insertBoardItem(db, {
      localId: "a1",
      boardKey: "appointments_r",
      name: "Today",
      nextDate: today,
      attorney: "R",
      profileLocalId: "p1",
    });
    insertBoardItem(db, {
      localId: "a2",
      boardKey: "appointments_r",
      name: "In 3 days",
      nextDate: addDays(today, 3),
      attorney: "R",
      profileLocalId: "p1",
    });
    insertBoardItem(db, {
      localId: "a3",
      boardKey: "appointments_r",
      name: "In 10 days",
      nextDate: addDays(today, 10),
      attorney: "R",
      profileLocalId: "p1",
    });

    const result = getAppointments(db, { range: "week", date: today });
    expect(result.entries.length).toBe(2);
    expect(result.entries.map((e) => e.appointment.name)).toContain("Today");
    expect(result.entries.map((e) => e.appointment.name)).toContain("In 3 days");
    db.close();
  });

  test("excludes non-appointment board items", () => {
    const db = freshDb();
    insertProfile(db, { localId: "p1", name: "Maria Garcia" });

    insertBoardItem(db, {
      localId: "a1",
      boardKey: "appointments_r",
      name: "Appointment",
      nextDate: todayStr(),
      attorney: "R",
      profileLocalId: "p1",
    });
    insertBoardItem(db, {
      localId: "bi1",
      boardKey: "court_cases",
      name: "Court Case",
      nextDate: todayStr(),
      profileLocalId: "p1",
    });

    const result = getAppointments(db, { date: todayStr() });
    expect(result.entries.length).toBe(1);
    expect(result.entries[0]!.appointment.boardKey).toBe("appointments_r");
    db.close();
  });

  test("includes client snapshot with case and contract counts", () => {
    const db = freshDb();
    insertProfile(db, { localId: "p1", name: "Maria Garcia" });

    // Appointment
    insertBoardItem(db, {
      localId: "a1",
      boardKey: "appointments_r",
      name: "Consult",
      nextDate: todayStr(),
      attorney: "R",
      profileLocalId: "p1",
    });

    // Non-appointment board items (counted as active cases)
    insertBoardItem(db, {
      localId: "bi1",
      boardKey: "court_cases",
      name: "Case 1",
      profileLocalId: "p1",
    });
    insertBoardItem(db, {
      localId: "bi2",
      boardKey: "motions",
      name: "Motion 1",
      profileLocalId: "p1",
    });

    // Active contract
    insertContract(db, {
      localId: "c1",
      profileLocalId: "p1",
      caseType: "I-485",
      status: "Atty Reviewing",
    });
    // Closed contract (should NOT count)
    insertContract(db, {
      localId: "c2",
      profileLocalId: "p1",
      caseType: "FOIA",
      status: "Completed",
    });

    const result = getAppointments(db, { date: todayStr() });
    const snapshot = result.entries[0]!.snapshot;
    expect(snapshot.activeCaseCount).toBe(2);
    expect(snapshot.pendingContractCount).toBe(1);
    db.close();
  });

  test("includes client updates", () => {
    const db = freshDb();
    insertProfile(db, { localId: "p1", name: "Maria Garcia" });

    insertBoardItem(db, {
      localId: "a1",
      boardKey: "appointments_r",
      name: "Consult",
      nextDate: todayStr(),
      attorney: "R",
      profileLocalId: "p1",
    });

    insertUpdate(db, {
      localId: "u1",
      profileLocalId: "p1",
      authorName: "Attorney R",
      textBody: "Client called about documents.",
    });

    const result = getAppointments(db, { date: todayStr() });
    expect(result.entries[0]!.updates.length).toBe(1);
    expect(result.entries[0]!.updates[0]!.textBody).toBe("Client called about documents.");
    db.close();
  });

  test("sorts by next_date ascending", () => {
    const db = freshDb();
    insertProfile(db, { localId: "p1", name: "Maria Garcia" });

    const today = todayStr();
    insertBoardItem(db, {
      localId: "a1",
      boardKey: "appointments_r",
      name: "Later",
      nextDate: addDays(today, 2),
      attorney: "R",
      profileLocalId: "p1",
    });
    insertBoardItem(db, {
      localId: "a2",
      boardKey: "appointments_r",
      name: "Earlier",
      nextDate: today,
      attorney: "R",
      profileLocalId: "p1",
    });

    const result = getAppointments(db, { range: "week", date: today });
    expect(result.entries[0]!.appointment.name).toBe("Earlier");
    expect(result.entries[1]!.appointment.name).toBe("Later");
    db.close();
  });

  test("includes full case summary data", () => {
    const db = freshDb();
    insertProfile(db, { localId: "p1", name: "Maria Garcia" });

    insertBoardItem(db, {
      localId: "a1",
      boardKey: "appointments_r",
      name: "Consult",
      nextDate: todayStr(),
      attorney: "R",
      profileLocalId: "p1",
    });

    const result = getAppointments(db, { date: todayStr() });
    expect(result.entries[0]!.caseSummary).not.toBeNull();
    expect(result.entries[0]!.caseSummary!.profile.name).toBe("Maria Garcia");
    db.close();
  });
});

describe("getAttorneyList", () => {
  test("returns distinct attorneys from appointment boards", () => {
    const db = freshDb();

    insertBoardItem(db, {
      localId: "a1",
      boardKey: "appointments_r",
      name: "Consult 1",
      attorney: "R",
    });
    insertBoardItem(db, {
      localId: "a2",
      boardKey: "appointments_m",
      name: "Consult 2",
      attorney: "M",
    });
    insertBoardItem(db, {
      localId: "a3",
      boardKey: "appointments_r",
      name: "Consult 3",
      attorney: "R",
    });
    // Non-appointment board — should NOT appear
    insertBoardItem(db, {
      localId: "bi1",
      boardKey: "court_cases",
      name: "Case",
      attorney: "X",
    });

    const attorneys = getAttorneyList(db);
    expect(attorneys).toEqual(["M", "R"]);
    db.close();
  });

  test("excludes null attorneys", () => {
    const db = freshDb();

    insertBoardItem(db, {
      localId: "a1",
      boardKey: "appointments_r",
      name: "Consult",
      attorney: null as any,
    });

    const attorneys = getAttorneyList(db);
    expect(attorneys).toEqual([]);
    db.close();
  });
});
