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
import { getCallLogEntries, getCallLogStaffOptions } from "./call-log";

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
});
