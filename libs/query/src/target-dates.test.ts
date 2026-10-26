// =============================================================================
// Target Dates Query Tests
// =============================================================================
// What matters: each open form lands in the right bucket counted from the
// firm's today, most overdue first and undated last, and the history says how
// often the date moved and who changed it last.

import { test, expect, describe } from "vitest";
import Database from "better-sqlite3";
type DatabaseInstance = InstanceType<typeof Database>;
import { initializeSchema } from "@case-pipeline/seed/db/schema";
import { bucketFor, getTargetDates, TARGET_DATE_COLUMN_ID } from "./target-dates";

const TODAY = "2026-10-26";

function freshDb(): DatabaseInstance {
  const db = new Database(":memory:");
  initializeSchema(db);
  db.prepare("INSERT INTO seed_batches (batch_name, seed_value, status) VALUES ('test', 1, 'complete')").run();
  db.prepare("INSERT INTO profiles (batch_id, local_id, name, raw_column_values) VALUES (1, 'p1', 'Ana LOPEZ', '{}')").run();
  return db;
}

function insertForm(db: DatabaseInstance, localId: string, target: string | null, paralegals = "Mayra Ruiz", group = "Open Forms") {
  db.prepare(`INSERT INTO board_items
                (batch_id, local_id, monday_item_id, board_key, name, group_title, status, paralegals, next_date, profile_local_id, column_values)
              VALUES (1, ?, ?, '_cd_open_forms', ?, ?, 'Needs Forms Appt', ?, ?, 'p1', '{}')`)
    .run(localId, `m-${localId}`, `I-130 ${localId}`, group, paralegals, target);
}

function insertChange(db: DatabaseInstance, localId: string, at: string, from: string | null, to: string | null, userId = "111") {
  db.prepare(`INSERT INTO item_events (event_type, board_key, monday_item_id, column_id, column_title, column_type, previous_text, value_text, monday_user_id, changed_at)
              VALUES ('update_column_value', '_cd_open_forms', ?, ?, 'Target Date', 'date', ?, ?, ?, ?)`)
    .run(`m-${localId}`, TARGET_DATE_COLUMN_ID, from, to, userId, at);
}

describe("bucketFor", () => {
  test("overdue / 7 days / 14 days / later / none", () => {
    expect(bucketFor(-1)).toBe("overdue");
    expect(bucketFor(0)).toBe("week");
    expect(bucketFor(7)).toBe("week");
    expect(bucketFor(8)).toBe("twoWeeks");
    expect(bucketFor(14)).toBe("twoWeeks");
    expect(bucketFor(15)).toBe("later");
    expect(bucketFor(null)).toBe("none");
  });
});

describe("getTargetDates", () => {
  test("buckets from the given today, most overdue first, undated last", () => {
    const db = freshDb();
    insertForm(db, "later", "2026-12-01");
    insertForm(db, "none", null);
    insertForm(db, "late2", "2026-10-20");
    insertForm(db, "late9", "2026-10-17");
    insertForm(db, "soon", "2026-10-30");
    insertForm(db, "next", "2026-11-05");
    insertForm(db, "closed", "2026-10-01", "Mayra Ruiz", "Done");

    const r = getTargetDates(db, { today: TODAY });
    expect(r.cases.map((c) => c.localId)).toEqual(["late9", "late2", "soon", "next", "later", "none"]);
    expect(r.counts).toEqual({ overdue: 2, week: 1, twoWeeks: 1, later: 1, none: 1 });
    expect(r.cases[0]).toMatchObject({ daysLeft: -9, bucket: "overdue", mondayItemId: "m-late9" });
  });

  test("counts real moves and names the last change", () => {
    const db = freshDb();
    insertForm(db, "a", "2026-11-17");
    db.prepare(`INSERT INTO item_events (event_type, board_key, monday_item_id, changed_at) VALUES ('create_pulse', '_cd_open_forms', 'm-a', '2026-09-01T10:00:00Z')`).run();
    insertChange(db, "a", "2026-09-01T10:05:00Z", null, "2026-10-20");        // typed in at creation: not a move
    insertChange(db, "a", "2026-10-10T15:00:00Z", "2026-10-20", "2026-11-03"); // a move
    insertChange(db, "a", "2026-10-24T15:00:00Z", "2026-11-03", "2026-11-17", "222"); // a move, by someone else

    const [c] = getTargetDates(db, { today: TODAY }).cases;
    expect(c!.moves).toBe(2);
    expect(c!.lastChange).toEqual({ at: "2026-10-24T15:00:00Z", userId: "222", from: "2026-11-03", to: "2026-11-17" });
  });

  test("one entry per paralegal across casings", () => {
    const db = freshDb();
    insertForm(db, "a", "2026-11-01", "Mayra Ruiz, Lucy B");
    insertForm(db, "b", "2026-11-01", "Lucy B");
    expect(getTargetDates(db, { today: TODAY }).paralegals).toEqual(["Lucy B", "Mayra Ruiz"]);
  });
});
