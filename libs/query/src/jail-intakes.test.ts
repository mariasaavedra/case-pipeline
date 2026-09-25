// =============================================================================
// Jail Intake Query Tests
// =============================================================================
// Two things carry the weight here. The default filter is narrow on purpose —
// production has ~292 open leads but only 8 in the last 10 days — so the rest
// must surface as `olderCount` rather than vanish. And an intake has no profile
// of its own: whether a lead converted is only knowable by following
// x_appointments to the appointment, and the appointment to the profile.
// =============================================================================

import { test, expect, describe } from "vitest";
import Database from "better-sqlite3";
type DatabaseInstance = InstanceType<typeof Database>;
import { initializeSchema } from "@case-pipeline/seed/db/schema";
import { getJailIntakes, cutoffDate } from "./jail-intakes";

const TODAY = "2026-09-25";

function run(db: DatabaseInstance, sql: string, params: unknown[] = []): void {
  db.prepare(sql).run(...(params as unknown[] as never[]));
}

function freshDb(): DatabaseInstance {
  const db = new Database(":memory:");
  initializeSchema(db);
  run(db, "INSERT INTO seed_batches (batch_name, seed_value, status) VALUES ('test', 1, 'complete')");
  return db;
}

function insertIntake(
  db: DatabaseInstance,
  opts: {
    localId: string;
    name: string;
    status?: string;
    groupTitle?: string;
    createdOn?: string;
    columnValues?: Record<string, unknown>;
  },
): void {
  const cv = {
    intake_created_on: opts.createdOn ? { date: opts.createdOn } : undefined,
    ...opts.columnValues,
  };
  run(
    db,
    `INSERT INTO board_items (batch_id, local_id, board_key, group_title, name, status, profile_local_id, column_values)
     VALUES (1, ?, '_fa_jail_intakes', ?, ?, ?, '', ?)`,
    [opts.localId, opts.groupTitle ?? "Jail Intakes", opts.name, opts.status ?? "New Detainee", JSON.stringify(cv)],
  );
}

function insertAppointment(
  db: DatabaseInstance,
  opts: { localId: string; mondayItemId: string; name: string; nextDate?: string; profileLocalId?: string },
): void {
  run(
    db,
    `INSERT INTO board_items (batch_id, local_id, monday_item_id, board_key, group_title, name, status, next_date, profile_local_id, column_values)
     VALUES (1, ?, ?, 'appointments_lb', 'Upcoming', ?, 'Upcoming', ?, ?, '{}')`,
    [opts.localId, opts.mondayItemId, opts.name, opts.nextDate ?? null, opts.profileLocalId ?? ""],
  );
}

describe("cutoffDate", () => {
  test("counts back in calendar days", () => {
    expect(cutoffDate(10, "2026-09-25")).toBe("2026-09-15");
  });

  test("crosses a month boundary", () => {
    expect(cutoffDate(10, "2026-10-05")).toBe("2026-09-25");
  });
});

describe("getJailIntakes — the default triage list", () => {
  test("hides Scheduled and Not Proceeding, keeps the rest", () => {
    const db = freshDb();
    insertIntake(db, { localId: "a", name: "New one", status: "New Detainee", createdOn: TODAY });
    insertIntake(db, { localId: "b", name: "Paid?", status: "Payment link sent. Waiting on payment", createdOn: TODAY });
    insertIntake(db, { localId: "c", name: "Booked", status: "Scheduled", createdOn: TODAY });
    insertIntake(db, { localId: "d", name: "Dead", status: "Not Proceeding", createdOn: TODAY });

    const res = getJailIntakes(db, {}, TODAY);
    expect(res.intakes.map((i) => i.localId).sort()).toEqual(["a", "b"]);
  });

  test("excludes the Scheduled GROUP even when the status disagrees", () => {
    // The two disagree on roughly thirty rows in production. Scheduled by
    // either measure is not triage work.
    const db = freshDb();
    insertIntake(db, { localId: "a", name: "Odd one", status: "New Detainee", groupTitle: "Scheduled", createdOn: TODAY });
    expect(getJailIntakes(db, {}, TODAY).intakes).toHaveLength(0);
  });

  test("withinDays keeps recent leads and counts the rest as olderCount", () => {
    const db = freshDb();
    insertIntake(db, { localId: "recent", name: "Recent", createdOn: "2026-09-20" });
    insertIntake(db, { localId: "edge", name: "Exactly ten days", createdOn: "2026-09-15" });
    insertIntake(db, { localId: "old1", name: "Old", createdOn: "2026-08-01" });
    insertIntake(db, { localId: "old2", name: "Older", createdOn: "2026-05-01" });

    const res = getJailIntakes(db, { withinDays: 10 }, TODAY);
    expect(res.intakes.map((i) => i.localId).sort()).toEqual(["edge", "recent"]);
    expect(res.total).toBe(2);
    // The backlog is reported, not hidden — 292 open vs 8 recent on production.
    expect(res.olderCount).toBe(2);
  });

  test("olderCount is zero when no date limit is applied", () => {
    const db = freshDb();
    insertIntake(db, { localId: "a", name: "A", createdOn: "2026-01-01" });
    const res = getJailIntakes(db, {}, TODAY);
    expect(res.total).toBe(1);
    expect(res.olderCount).toBe(0);
  });

  test("includeClosed brings back the whole funnel", () => {
    const db = freshDb();
    insertIntake(db, { localId: "a", name: "Open", createdOn: TODAY });
    insertIntake(db, { localId: "c", name: "Booked", status: "Scheduled", createdOn: TODAY });
    expect(getJailIntakes(db, { includeClosed: true }, TODAY).intakes).toHaveLength(2);
  });

  test("an intake with no created date is not mistaken for a recent one", () => {
    const db = freshDb();
    insertIntake(db, { localId: "undated", name: "No date" });
    const res = getJailIntakes(db, { withinDays: 10 }, TODAY);
    expect(res.intakes).toHaveLength(0);
    expect(res.olderCount).toBe(1);
  });

  test("newest first", () => {
    const db = freshDb();
    insertIntake(db, { localId: "mid", name: "Mid", createdOn: "2026-09-20" });
    insertIntake(db, { localId: "new", name: "New", createdOn: "2026-09-24" });
    insertIntake(db, { localId: "old", name: "Old", createdOn: "2026-09-16" });
    expect(getJailIntakes(db, {}, TODAY).intakes.map((i) => i.localId)).toEqual(["new", "mid", "old"]);
  });
});

describe("getJailIntakes — conversion", () => {
  test("follows x_appointments to the consult AND the profile it created", () => {
    const db = freshDb();
    run(db, "INSERT INTO profiles (batch_id, local_id, name) VALUES (1, 'p1', 'Ana GOMEZ')");
    insertAppointment(db, {
      localId: "appt1", mondayItemId: "999", name: "Ana GOMEZ", nextDate: "2026-10-02", profileLocalId: "p1",
    });
    insertIntake(db, {
      localId: "a", name: "Ana GOMEZ", createdOn: TODAY,
      columnValues: { x_appointments: { linked_item_ids: ["999"] } },
    });

    const [intake] = getJailIntakes(db, {}, TODAY).intakes;
    expect(intake?.convertedTo).toEqual({
      appointmentLocalId: "appt1",
      appointmentName: "Ana GOMEZ",
      consultDate: "2026-10-02",
      profileLocalId: "p1",
      profileName: "Ana GOMEZ",
    });
  });

  test("a lead with no appointment has not converted", () => {
    const db = freshDb();
    insertIntake(db, { localId: "a", name: "Still a lead", createdOn: TODAY });
    expect(getJailIntakes(db, {}, TODAY).intakes[0]?.convertedTo).toBeNull();
  });

  test("a link to an appointment we have not synced does not invent a conversion", () => {
    const db = freshDb();
    insertIntake(db, {
      localId: "a", name: "Dangling", createdOn: TODAY,
      columnValues: { x_appointments: { linked_item_ids: ["does-not-exist"] } },
    });
    expect(getJailIntakes(db, {}, TODAY).intakes[0]?.convertedTo).toBeNull();
  });

  test("a converted intake whose appointment has no profile yet still reports the consult", () => {
    const db = freshDb();
    insertAppointment(db, { localId: "appt1", mondayItemId: "999", name: "Pending", nextDate: "2026-10-02" });
    insertIntake(db, {
      localId: "a", name: "Pending", createdOn: TODAY,
      columnValues: { x_appointments: { linked_item_ids: ["999"] } },
    });
    const c = getJailIntakes(db, {}, TODAY).intakes[0]?.convertedTo;
    expect(c?.consultDate).toBe("2026-10-02");
    expect(c?.profileLocalId).toBeNull();
  });
});

describe("getJailIntakes — fields and filters", () => {
  test("shapes the contact details staff actually need", () => {
    const db = freshDb();
    insertIntake(db, {
      localId: "a", name: "Juan PEREZ", createdOn: TODAY,
      columnValues: {
        jail: "Kay County",
        alien_number: "088-467-122",
        language: { label: "Spanish" },
        poc_name_and_relationship_with_detained: "Maria, sister",
        poc_phone: "316-869-3861",
        last_interaction_date: { date: "2026-09-24" },
      },
    });
    const [i] = getJailIntakes(db, {}, TODAY).intakes;
    expect(i).toMatchObject({
      jail: "Kay County",
      alienNumber: "088-467-122",
      language: "Spanish",
      pocName: "Maria, sister",
      pocPhone: "316-869-3861",
      lastInteractionDate: "2026-09-24",
    });
  });

  test("search matches the detainee's name or the facility", () => {
    const db = freshDb();
    insertIntake(db, { localId: "a", name: "Juan PEREZ", createdOn: TODAY, columnValues: { jail: "Kay County" } });
    insertIntake(db, { localId: "b", name: "Ana GOMEZ", createdOn: TODAY, columnValues: { jail: "Chase County" } });
    expect(getJailIntakes(db, { search: "PEREZ" }, TODAY).intakes.map((i) => i.localId)).toEqual(["a"]);
    expect(getJailIntakes(db, { search: "Chase" }, TODAY).intakes.map((i) => i.localId)).toEqual(["b"]);
  });

  test("statusOptions lists every status on the board, closed ones included", () => {
    const db = freshDb();
    insertIntake(db, { localId: "a", name: "A", status: "New Detainee", createdOn: TODAY });
    insertIntake(db, { localId: "b", name: "B", status: "Scheduled", createdOn: TODAY });
    expect(getJailIntakes(db, {}, TODAY).statusOptions).toEqual(["New Detainee", "Scheduled"]);
  });

  test("ignores malformed column JSON rather than throwing", () => {
    const db = freshDb();
    run(
      db,
      `INSERT INTO board_items (batch_id, local_id, board_key, group_title, name, status, profile_local_id, column_values)
       VALUES (1, 'bad', '_fa_jail_intakes', 'Jail Intakes', 'Broken', 'New Detainee', '', 'not json')`,
    );
    const [i] = getJailIntakes(db, {}, TODAY).intakes;
    expect(i?.name).toBe("Broken");
    expect(i?.jail).toBeNull();
  });
});
