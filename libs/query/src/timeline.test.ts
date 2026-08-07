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

describe("timeline category filter", () => {
  // Category filtering happens server-side so a filtered view is complete, not
  // "the newest page, then filtered" (which starved activities on busy inboxes).
  let db: DatabaseInstance;
  const insCat = (o: { localId: string; sourceType: string; createdAt: string; boardKey?: string | null; timelineId?: string | null }) =>
    db
      .prepare(
        `INSERT INTO client_updates
           (batch_id, local_id, monday_timeline_id, profile_local_id, board_key, author_name, text_body, source_type, created_at_source, sync_status)
         VALUES (?, ?, ?, 'p1', ?, 'A', 'body', ?, ?, 'synced')`
      )
      .run(batchId(db), o.localId, o.timelineId ?? null, o.boardKey ?? null, o.sourceType, o.createdAt);

  beforeEach(() => {
    db = freshDb();
    insCat({ localId: "em", sourceType: "email", timelineId: "t-em", createdAt: "2026-01-10T10:00:00Z" });
    insCat({ localId: "ac", sourceType: "custom", timelineId: "t-ac", createdAt: "2026-01-09T10:00:00Z" });
    insCat({ localId: "nt", sourceType: "note", timelineId: "t-nt", createdAt: "2026-01-08T10:00:00Z" });
    insCat({ localId: "up", sourceType: "update", createdAt: "2026-01-07T10:00:00Z" });
    insCat({ localId: "doc", sourceType: "note", boardKey: "address_changes", timelineId: "t-doc", createdAt: "2026-01-06T10:00:00Z" });
    insCat({ localId: "notice", sourceType: "note", boardKey: "nvc_notices", timelineId: "t-notice", createdAt: "2026-01-05T10:00:00Z" });
    insCat({ localId: "appt", sourceType: "note", boardKey: "appointments_r", timelineId: "t-appt", createdAt: "2026-01-04T10:00:00Z" });
  });

  const ids = (category: Parameters<typeof getClientUpdates>[5]) =>
    getClientUpdates(db, "p1", 500, 0, undefined, category).map((r) => r.localId).sort();

  test("notes is everything that is not an email", () => {
    expect(ids("notes")).toEqual(["ac", "appt", "doc", "notice", "nt", "up"]);
  });

  test("notes INCLUDES document, notice and appointment board entries", () => {
    // The regression this replaces: the old allow-list rule matched only
    // update/reply/note off those boards, so a chip labelled "Notes" hid the
    // notes attached to a document or an appointment.
    const notes = ids("notes");
    expect(notes).toContain("doc");
    expect(notes).toContain("notice");
    expect(notes).toContain("appt");
  });

  test("notes keeps E&A activities, which are not emails either", () => {
    expect(ids("notes")).toContain("ac");
  });

  test("all returns everything", () => {
    expect(ids("all")).toHaveLength(7);
  });

  test("an absent category returns everything", () => {
    expect(ids(undefined)).toHaveLength(7);
  });
});

describe("timeline date range", () => {
  // Applied in SQL rather than in the browser: `limit` caps the NEWEST rows, so
  // a client-side date filter returns nothing for an older range once a busy
  // profile exceeds the page.
  let db: DatabaseInstance;
  const ins = (localId: string, createdAt: string, sourceType = "update") =>
    db
      .prepare(
        `INSERT INTO client_updates
           (batch_id, local_id, profile_local_id, author_name, text_body, source_type, created_at_source, sync_status)
         VALUES (?, ?, 'p1', 'A', 'body', ?, ?, 'synced')`
      )
      .run(batchId(db), localId, sourceType, createdAt);

  beforeEach(() => {
    db = freshDb();
    ins("jan01", "2026-01-01T10:00:00Z");
    ins("mar01", "2026-03-01T00:30:00Z"); // first minutes of the day
    ins("mar15", "2026-03-15T12:00:00Z");
    ins("mar31", "2026-03-31T23:45:00Z"); // last minutes of the day
    ins("apr01", "2026-04-01T08:00:00Z");
    ins("mar20mail", "2026-03-20T09:00:00Z", "email");
  });

  const ids = (
    range: Parameters<typeof getClientUpdates>[6],
    category?: Parameters<typeof getClientUpdates>[5],
  ) => getClientUpdates(db, "p1", 500, 0, undefined, category, range).map((r) => r.localId).sort();

  test("from is inclusive of the whole starting day", () => {
    // mar01 is at 00:30, so the lower bound has to catch entries made just
    // after midnight on the start date.
    expect(ids({ from: "2026-03-01" })).toEqual(["apr01", "mar01", "mar15", "mar20mail", "mar31"]);
  });

  test("to is inclusive of the whole ending day", () => {
    // mar31 is at 23:45 — the bound is exclusive against Apr 1, not against
    // midnight on Mar 31, which would have dropped nearly the entire last day.
    expect(ids({ to: "2026-03-31" })).toEqual(["jan01", "mar01", "mar15", "mar20mail", "mar31"]);
  });

  test("from and to together bound both ends", () => {
    expect(ids({ from: "2026-03-01", to: "2026-03-31" })).toEqual(["mar01", "mar15", "mar20mail", "mar31"]);
  });

  test("a single-day range returns just that day", () => {
    expect(ids({ from: "2026-03-15", to: "2026-03-15" })).toEqual(["mar15"]);
  });

  test("the range composes with the category filter", () => {
    expect(ids({ from: "2026-03-01", to: "2026-03-31" }, "notes")).toEqual(["mar01", "mar15", "mar31"]);
  });

  test("an empty range is no filter at all", () => {
    expect(ids({})).toHaveLength(6);
    expect(ids(undefined)).toHaveLength(6);
  });

  test("a range that matches nothing returns empty, not everything", () => {
    expect(ids({ from: "2027-01-01" })).toEqual([]);
  });

  test("crossing a month boundary handles the next-day rollover", () => {
    expect(ids({ from: "2026-03-31", to: "2026-04-01" })).toEqual(["apr01", "mar31"]);
  });
});

describe("update attachments", () => {
  let db: DatabaseInstance;
  beforeEach(() => {
    db = freshDb();
  });

  const insertWithAttachments = (localId: string, attachments: string | null) =>
    db
      .prepare(
        `INSERT INTO client_updates
           (batch_id, local_id, profile_local_id, author_name, text_body, source_type, attachments, created_at_source, sync_status)
         VALUES (?, ?, 'p1', 'A', 'see attached', 'update', ?, '2026-01-01T10:00:00Z', 'synced')`
      )
      .run(batchId(db), localId, attachments);

  test("parses stored attachment JSON onto the mapped result", () => {
    insertWithAttachments(
      "u1",
      JSON.stringify([{ name: "contract.pdf", url: "https://m/1", thumbnailUrl: null, fileExtension: ".pdf", fileSize: 1024 }])
    );
    const u = getClientUpdates(db, "p1")[0]!;
    expect(u.attachments).toHaveLength(1);
    expect(u.attachments[0]).toEqual({ name: "contract.pdf", url: "https://m/1", thumbnailUrl: null, fileExtension: ".pdf", fileSize: 1024 });
  });

  test("null attachments map to an empty array", () => {
    insertWithAttachments("u2", null);
    expect(getClientUpdates(db, "p1")[0]!.attachments).toEqual([]);
  });

  test("corrupt attachment JSON degrades to an empty array", () => {
    insertWithAttachments("u3", "{not json");
    expect(getClientUpdates(db, "p1")[0]!.attachments).toEqual([]);
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
