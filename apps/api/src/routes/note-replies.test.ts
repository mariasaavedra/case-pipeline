// =============================================================================
// Sub-note routing tests
// =============================================================================
// planReply decides where a sub-note lands in Monday — a real reply under an
// update, or a "Re:" update on an E&A entry's item. Getting it wrong posts a
// note on the wrong client record, so each branch is pinned here against a
// real schema in memory. Nothing is sent to Monday.
// =============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initializeSchema } from "@case-pipeline/seed/db/schema";
import { planReply, eaReplyPrefix } from "./note-replies";

type Db = InstanceType<typeof Database>;

function insertEntry(
  db: Db,
  o: {
    localId: string;
    sourceType: string;
    updateId?: string | null;
    timelineId?: string | null;
    replyTo?: string | null;
    boardItem?: string | null;
    boardKey?: string | null;
    title?: string | null;
    activity?: string | null;
  },
) {
  db.prepare(
    `INSERT INTO client_updates
       (batch_id, local_id, monday_update_id, monday_timeline_id, profile_local_id, board_item_local_id,
        board_key, author_name, title, text_body, source_type, activity_type_name, reply_to_update_id,
        created_at_source, sync_status)
     VALUES (1, ?, ?, ?, 'p1', ?, ?, 'Ana', ?, 'body', ?, ?, ?, '2026-09-12T15:00:00Z', 'synced')`,
  ).run(
    o.localId, o.updateId ?? null, o.timelineId ?? null, o.boardItem ?? null, o.boardKey ?? null,
    o.title ?? null, o.sourceType, o.activity ?? null, o.replyTo ?? null,
  );
}

let db: Db;
beforeEach(() => {
  db = new Database(":memory:");
  initializeSchema(db);
  db.prepare("INSERT INTO seed_batches (batch_name, seed_value, status) VALUES ('t', 1, 'complete')").run();
  db.prepare("INSERT INTO profiles (batch_id, local_id, name, monday_item_id) VALUES (1, 'p1', 'Juan', 'PROFILE-1')").run();
  db.prepare(
    `INSERT INTO board_items (batch_id, local_id, monday_item_id, board_key, name, profile_local_id, column_values)
     VALUES (1, 'bi1', 'COURT-1', 'court_cases', 'Juan — court', 'p1', '{}')`,
  ).run();
  db.prepare(
    `INSERT INTO board_columns (board_key, monday_board_id, column_id, title, type) VALUES ('court_cases', 'BOARD-C', 'x', 'X', 'text')`,
  ).run();
});

describe("planReply", () => {
  it("threads a sub-note on a Monday update as a real reply on the same item", () => {
    insertEntry(db, { localId: "u1", sourceType: "update", updateId: "UPD-1" });
    const plan = planReply(db, "u1", "Called the client");
    expect(plan).toMatchObject({
      ok: true, mondayItemId: "PROFILE-1", mondayBoardId: null,
      parentId: "UPD-1", rootMondayId: "UPD-1", body: "Called the client", isEa: false,
    });
  });

  // Monday nests replies one level deep, so a reply-to-a-reply joins the root's thread.
  it("sends a reply to a reply under the thread root", () => {
    insertEntry(db, { localId: "u1", sourceType: "update", updateId: "UPD-1" });
    insertEntry(db, { localId: "r1", sourceType: "reply", updateId: "REP-1", replyTo: "UPD-1" });
    const plan = planReply(db, "r1", "Follow-up");
    expect(plan).toMatchObject({ ok: true, parentId: "UPD-1", rootMondayId: "UPD-1" });
    if (plan.ok) expect(plan.root.local_id).toBe("u1");
  });

  it("posts a sub-note on an E&A entry as a prefixed top-level update on that entry's item", () => {
    insertEntry(db, {
      localId: "a1", sourceType: "custom", timelineId: "TL-1",
      boardItem: "bi1", boardKey: "court_cases", activity: "Casenote",
    });
    const plan = planReply(db, "a1", "Filed the motion");
    expect(plan).toMatchObject({
      ok: true, mondayItemId: "COURT-1", mondayBoardId: "BOARD-C",
      parentId: undefined, rootMondayId: "TL-1", isEa: true,
      body: "Re: Casenote (Sep 12, 2026) — Filed the motion",
    });
  });

  it("keeps a second sub-note on an E&A entry in the same thread", () => {
    insertEntry(db, { localId: "e1", sourceType: "email", timelineId: "TL-2", title: "Visa docs" });
    insertEntry(db, { localId: "s1", sourceType: "reply", updateId: "UPD-9", replyTo: "TL-2" });
    const plan = planReply(db, "s1", "Got them");
    expect(plan).toMatchObject({ ok: true, rootMondayId: "TL-2", parentId: undefined, isEa: true });
    if (plan.ok) expect(plan.body).toBe("Re: Visa docs (Sep 12, 2026) — Got them");
  });

  it("refuses an entry that hasn't reached Monday yet", () => {
    insertEntry(db, { localId: "q1", sourceType: "update" });
    expect(planReply(db, "q1", "x")).toMatchObject({ ok: false, status: 409 });
  });

  it("404s an unknown entry", () => {
    expect(planReply(db, "nope", "x")).toMatchObject({ ok: false, status: 404 });
  });

  it("refuses when the entry's Monday item is unknown", () => {
    db.prepare("UPDATE profiles SET monday_item_id = NULL").run();
    insertEntry(db, { localId: "u1", sourceType: "update", updateId: "UPD-1" });
    expect(planReply(db, "u1", "x")).toMatchObject({ ok: false, status: 400 });
  });
});

describe("eaReplyPrefix", () => {
  const base = { title: null, activity_type_name: null, source_type: "email", created_at_source: "2026-01-05T10:00:00Z" };

  it("prefers the subject, then the activity name, then the kind", () => {
    expect(eaReplyPrefix({ ...base, title: "Visa docs", activity_type_name: "X" })).toBe("Re: Visa docs (Jan 5, 2026) —");
    expect(eaReplyPrefix({ ...base, source_type: "custom", activity_type_name: "Consult note" })).toBe("Re: Consult note (Jan 5, 2026) —");
    expect(eaReplyPrefix({ ...base, source_type: "note" })).toBe("Re: Note (Jan 5, 2026) —");
  });

  it("shortens a long subject and drops an unparseable date", () => {
    const p = eaReplyPrefix({ ...base, title: "x".repeat(100), created_at_source: "garbage" });
    expect(p).toBe(`Re: ${"x".repeat(57)}… —`);
  });
});
