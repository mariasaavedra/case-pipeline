// =============================================================================
// Call Log Query Tests
// =============================================================================

import { test, expect, describe } from "vitest";
import Database from "better-sqlite3";
type DatabaseInstance = InstanceType<typeof Database>;

function run(db: DatabaseInstance, sql: string, params: unknown[] = []): void {
  db.prepare(sql).run(...(params as any[]));
}
import { initializeSchema } from "@case-pipeline/seed/db/schema";
import { getCallLogEntries, getCallLogStaffOptions, searchJailIntakesByPocPhone } from "./call-log";
import { makeStaffNames } from "./staff-names";
import { testResolver } from "./staff-names.fixture";

function freshDb(): DatabaseInstance {
  const db = new Database(":memory:");
  initializeSchema(db);
  run(db, "INSERT INTO seed_batches (batch_name, seed_value, status) VALUES ('test', 1, 'complete')");
  return db;
}

function insertProfile(db: DatabaseInstance, opts: { localId: string; name: string }) {
  run(db, `INSERT INTO profiles (batch_id, local_id, name) VALUES (1, ?, ?)`, [opts.localId, opts.name]);
}

function insertCall(
  db: DatabaseInstance,
  opts: {
    localId: string;
    name: string;
    status?: string;
    profileLocalId?: string | null;
    columnValues?: Record<string, unknown>;
    updatedAtSource?: string;
    groupTitle?: string;
  },
) {
  run(
    db,
    `INSERT INTO board_items
       (batch_id, local_id, board_key, group_title, name, status, profile_local_id, column_values, updated_at_source)
     VALUES (1, ?, 'call_log', ?, ?, ?, ?, ?, ?)`,
    [
      opts.localId,
      opts.groupTitle ?? "Call Log",
      opts.name,
      opts.status ?? null,
      opts.profileLocalId ?? null,
      JSON.stringify(opts.columnValues ?? {}),
      opts.updatedAtSource ?? new Date().toISOString(),
    ],
  );
}

describe("getCallLogEntries", () => {
  test("shapes column_values into a CallLogEntry", () => {
    const db = freshDb();
    insertProfile(db, { localId: "prof-1", name: "Jane Doe" });
    insertCall(db, {
      localId: "call-1",
      name: "Jane wants a status update",
      status: "Pending",
      profileLocalId: "prof-1",
      columnValues: {
        phone: "8165551234",
        taken_by: { label: "Fernando Ayala" },
        date: { date: "2026-08-25" },
        hour: "02:25 PM",
        language: { label: "Spanish" },
      },
    });

    const { entries, total } = getCallLogEntries(db);
    expect(total).toBe(1);
    expect(entries[0]).toMatchObject({
      localId: "call-1",
      name: "Jane wants a status update",
      status: "Pending",
      phone: "8165551234",
      takenBy: "Fernando Ayala",
      language: "Spanish",
      date: "2026-08-25",
      time: "02:25 PM",
      profileLocalId: "prof-1",
      profileName: "Jane Doe",
    });
  });

  test("only includes items in the 'Call Log' group (Monday group id 'topics')", () => {
    const db = freshDb();
    insertCall(db, { localId: "call-1", name: "Active call", groupTitle: "Call Log" });
    insertCall(db, { localId: "call-2", name: "Stale backlog", groupTitle: "Pending Calls" });
    insertCall(db, { localId: "call-3", name: "Voicemail", groupTitle: "Voicemail Archive" });

    const { entries, total } = getCallLogEntries(db);
    expect(total).toBe(1);
    expect(entries[0]!.localId).toBe("call-1");
  });

  test("unlinkedOnly filters out calls with a profile_local_id", () => {
    const db = freshDb();
    insertProfile(db, { localId: "prof-1", name: "Jane Doe" });
    insertCall(db, { localId: "call-1", name: "Linked call", profileLocalId: "prof-1" });
    insertCall(db, { localId: "call-2", name: "Unlinked call", profileLocalId: null });

    const { entries, total } = getCallLogEntries(db, { unlinkedOnly: true });
    expect(total).toBe(1);
    expect(entries[0]!.localId).toBe("call-2");
  });

  test("status filter narrows results", () => {
    const db = freshDb();
    insertCall(db, { localId: "call-1", name: "A", status: "RESOLVED" });
    insertCall(db, { localId: "call-2", name: "B", status: "Pending" });

    const { entries, total } = getCallLogEntries(db, { status: "Pending" });
    expect(total).toBe(1);
    expect(entries[0]!.localId).toBe("call-2");
  });

  test("ignores non-call_log board items", () => {
    const db = freshDb();
    insertCall(db, { localId: "call-1", name: "A call" });
    run(
      db,
      `INSERT INTO board_items (batch_id, local_id, board_key, name, column_values) VALUES (1, 'other-1', 'court_cases', 'Not a call', '{}')`,
    );

    const { total } = getCallLogEntries(db);
    expect(total).toBe(1);
  });
});

describe("getCallLogStaffOptions", () => {
  test("returns distinct taken_by names", () => {
    const db = freshDb();
    insertCall(db, { localId: "call-1", name: "A", columnValues: { taken_by: { label: "Fernando Ayala" } } });
    insertCall(db, { localId: "call-2", name: "B", columnValues: { taken_by: { label: "Cynthia de La Cruz" } } });
    insertCall(db, { localId: "call-3", name: "C", columnValues: { taken_by: { label: "Fernando Ayala" } } });
    insertCall(db, { localId: "call-4", name: "D", columnValues: {} });

    expect(getCallLogStaffOptions(db)).toEqual(["Cynthia de La Cruz", "Fernando Ayala"]);
  });

  test("with the roster: one option per person, inactive people listed", () => {
    const db = freshDb();
    insertCall(db, { localId: "call-1", name: "A", columnValues: { taken_by: { label: "Mayra R." } } });
    insertCall(db, { localId: "call-2", name: "B", columnValues: { taken_by: { label: "mayra ruiz" } } });
    insertCall(db, { localId: "call-3", name: "C", columnValues: { taken_by: { label: "Ana Reyes" } } });
    const names = makeStaffNames(testResolver);
    expect(getCallLogStaffOptions(db, names)).toEqual(["Ana Reyes", "Mayra Ruiz"]);
    expect(names.inactive()).toEqual(["Mayra Ruiz"]);
  });

  test("filtering by the roster name matches every spelling", () => {
    const db = freshDb();
    insertCall(db, { localId: "call-1", name: "A", columnValues: { taken_by: { label: "Mayra R." } } });
    insertCall(db, { localId: "call-2", name: "B", columnValues: { taken_by: { label: "mayra ruiz" } } });
    insertCall(db, { localId: "call-3", name: "C", columnValues: { taken_by: { label: "Ana Reyes" } } });
    expect(getCallLogEntries(db, { takenBy: "Mayra Ruiz" }, testResolver).total).toBe(2);
    expect(getCallLogEntries(db, { takenBy: "Mayra R." }).total).toBe(1);
  });
});

function insertItem(
  db: DatabaseInstance,
  opts: { localId: string; boardKey: string; mondayItemId: string; name: string; profileLocalId?: string; columnValues?: Record<string, unknown> },
) {
  run(
    db,
    `INSERT INTO board_items (batch_id, local_id, monday_item_id, board_key, name, profile_local_id, column_values)
     VALUES (1, ?, ?, ?, ?, ?, ?)`,
    [opts.localId, opts.mondayItemId, opts.boardKey, opts.name, opts.profileLocalId ?? "", JSON.stringify(opts.columnValues ?? {})],
  );
}

describe("jail intakes on the Call Log", () => {
  test("a call linked to an intake shows it and is not 'unlinked'", () => {
    const db = freshDb();
    insertItem(db, { localId: "ji-1", boardKey: "_fa_jail_intakes", mondayItemId: "900", name: "Manuel ANAYA" });
    insertCall(db, { localId: "call-1", name: "Jennifer", columnValues: { profile: { linked_item_ids: ["900"] } } });
    insertCall(db, { localId: "call-2", name: "Nobody" });

    const byId = Object.fromEntries(getCallLogEntries(db).entries.map((e) => [e.localId, e]));
    expect(byId["call-1"]).toMatchObject({ jailIntakeLocalId: "ji-1", jailIntakeName: "Manuel ANAYA" });
    expect(byId["call-2"]!.jailIntakeLocalId).toBeNull();
    expect(getCallLogEntries(db, { unlinkedOnly: true }).entries.map((e) => e.localId)).toEqual(["call-2"]);
  });

  test("finds intakes by POC phone, any punctuation, skipping ones that became a client", () => {
    const db = freshDb();
    insertProfile(db, { localId: "prof-1", name: "Converted Client" });
    insertItem(db, {
      localId: "ji-open", boardKey: "_fa_jail_intakes", mondayItemId: "900", name: "Open Lead",
      columnValues: { poc_phone: "(816) 462-9131", poc_name_and_relationship_with_detained: "Jennifer - Wife" },
    });
    insertItem(db, { localId: "appt-1", boardKey: "appointments_m", mondayItemId: "500", name: "Consult", profileLocalId: "prof-1" });
    insertItem(db, {
      localId: "ji-done", boardKey: "_fa_jail_intakes", mondayItemId: "901", name: "Converted",
      columnValues: { poc_phone: "816-462-9131", x_appointments: { linked_item_ids: ["500"] } },
    });

    const matches = searchJailIntakesByPocPhone(db, "816-462-9131");
    expect(matches.map((m) => m.localId)).toEqual(["ji-open"]);
    expect(matches[0]).toMatchObject({ name: "Open Lead", pocName: "Jennifer - Wife", pocPhone: "(816) 462-9131" });
    expect(searchJailIntakesByPocPhone(db, "Jennifer")).toEqual([]);
  });
});
