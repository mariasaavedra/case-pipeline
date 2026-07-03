// =============================================================================
// Unified timeline query tests (updates + Emails & Activities)
// =============================================================================

import { test, expect, describe, beforeEach } from "vitest";
import Database from "better-sqlite3";
type DatabaseInstance = InstanceType<typeof Database>;
import { initializeSchema } from "@case-pipeline/seed/db/schema";
import { getClientUpdates, batchGetClientUpdates } from "./updates";

function freshDb(): DatabaseInstance {
  const db = new Database(":memory:");
  initializeSchema(db);
  db.prepare("INSERT INTO seed_batches (batch_name, seed_value, status) VALUES ('test', 1, 'complete')").run();
  return db;
}

function batchId(db: DatabaseInstance): number {
  return (db.prepare("SELECT id FROM seed_batches ORDER BY id DESC LIMIT 1").get() as { id: number }).id;
}

interface RowOpts {
  localId: string;
  profile: string;
  sourceType: string;
  createdAt: string;
  timelineId?: string | null;
  title?: string | null;
  activityTypeName?: string | null;
  author?: string;
  body?: string;
  ignore?: boolean;
}

function insertRow(db: DatabaseInstance, o: RowOpts) {
  const verb = o.ignore ? "INSERT OR IGNORE" : "INSERT";
  return db
    .prepare(
      `${verb} INTO client_updates
         (batch_id, local_id, monday_timeline_id, profile_local_id, author_name,
          title, text_body, source_type, activity_type_name, created_at_source, sync_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced')`
    )
    .run(
      batchId(db), o.localId, o.timelineId ?? null, o.profile, o.author ?? "Author",
      o.title ?? null, o.body ?? "body", o.sourceType, o.activityTypeName ?? null, o.createdAt
    );
}

describe("unified timeline", () => {
  let db: DatabaseInstance;
  beforeEach(() => {
    db = freshDb();
    insertRow(db, { localId: "u1", profile: "p1", sourceType: "update", createdAt: "2026-01-01T10:00:00Z" });
    insertRow(db, { localId: "r1", profile: "p1", sourceType: "reply", createdAt: "2026-01-02T10:00:00Z" });
    insertRow(db, { localId: "e1", profile: "p1", sourceType: "email", timelineId: "t-e1", title: "Visa docs", createdAt: "2026-01-05T10:00:00Z" });
    insertRow(db, { localId: "a1", profile: "p1", sourceType: "custom", timelineId: "t-a1", activityTypeName: "Consult note", createdAt: "2026-01-03T10:00:00Z" });
    insertRow(db, { localId: "n1", profile: "p1", sourceType: "note", timelineId: "t-n1", createdAt: "2026-01-04T10:00:00Z" });
  });

  test("unified read returns every source, newest first", () => {
    const rows = getClientUpdates(db, "p1");
    expect(rows.map((r) => r.localId)).toEqual(["e1", "n1", "a1", "r1", "u1"]);
    expect(new Set(rows.map((r) => r.sourceType))).toEqual(new Set(["update", "reply", "email", "custom", "note"]));
  });

  test("type filter isolates a single source", () => {
    const emails = getClientUpdates(db, "p1", 50, 0, ["email"]);
    expect(emails).toHaveLength(1);
    expect(emails[0]!.sourceType).toBe("email");
    expect(emails[0]!.title).toBe("Visa docs");
  });

  test("type filter accepts multiple sources", () => {
    const rows = getClientUpdates(db, "p1", 50, 0, ["email", "note"]);
    expect(rows.map((r) => r.localId)).toEqual(["e1", "n1"]);
  });

  test("E&A columns are surfaced on the mapped result", () => {
    const activity = getClientUpdates(db, "p1", 50, 0, ["custom"])[0]!;
    expect(activity.activityTypeName).toBe("Consult note");
  });

  test("batch read respects the type filter and per-profile cap", () => {
    const map = batchGetClientUpdates(db, ["p1"], 2, ["email", "note", "custom"]);
    const list = map.get("p1")!;
    expect(list).toHaveLength(2); // capped
    expect(list.every((r) => ["email", "note", "custom"].includes(r.sourceType))).toBe(true);
  });
});

describe("E&A dedup", () => {
  test("same (profile, timeline id) is stored once via INSERT OR IGNORE", () => {
    const db = freshDb();
    insertRow(db, { localId: "x1", profile: "p1", sourceType: "email", timelineId: "dup", createdAt: "2026-01-01T10:00:00Z", ignore: true });
    const second = insertRow(db, { localId: "x2", profile: "p1", sourceType: "email", timelineId: "dup", createdAt: "2026-01-01T10:00:00Z", ignore: true });
    expect(second.changes).toBe(0);
    expect(getClientUpdates(db, "p1")).toHaveLength(1);
  });

  test("the same timeline id is kept per distinct profile", () => {
    const db = freshDb();
    insertRow(db, { localId: "y1", profile: "p1", sourceType: "email", timelineId: "shared", createdAt: "2026-01-01T10:00:00Z", ignore: true });
    const other = insertRow(db, { localId: "y2", profile: "p2", sourceType: "email", timelineId: "shared", createdAt: "2026-01-01T10:00:00Z", ignore: true });
    expect(other.changes).toBe(1);
  });
});
