// =============================================================================
// Webhook processor tests (offline — Monday.com client is mocked)
// =============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initializeSchema } from "@case-pipeline/seed/db/schema";

const { fetchItemUpdatesBatchMock } = vi.hoisted(() => ({
  fetchItemUpdatesBatchMock: vi.fn(),
}));
vi.mock("@case-pipeline/monday", () => ({
  fetchItemUpdatesBatch: fetchItemUpdatesBatchMock,
}));

import {
  processWebhookEvents,
  archiveItemByMondayId,
  deletedUpdateIdFrom,
  deleteNoteByMondayUpdateId,
} from "./processor";

type DatabaseInstance = InstanceType<typeof Database>;

function freshDb(): DatabaseInstance {
  const db = new Database(":memory:");
  initializeSchema(db);
  db.prepare("INSERT INTO seed_batches (batch_name, status) VALUES ('test', 'synced')").run();
  return db;
}

function insertProfile(db: DatabaseInstance, mondayItemId: string, localId = `local-${mondayItemId}`): void {
  db.prepare(
    "INSERT INTO profiles (batch_id, local_id, monday_item_id, name) VALUES (1, ?, ?, 'Test Client')",
  ).run(localId, mondayItemId);
}

function insertBoardItem(db: DatabaseInstance, mondayItemId: string, boardKey: string, profileLocalId: string): void {
  db.prepare(
    `INSERT INTO board_items (batch_id, local_id, monday_item_id, board_key, name, profile_local_id, column_values)
     VALUES (1, ?, ?, ?, 'Test Item', ?, '{}')`,
  ).run(`local-${mondayItemId}`, mondayItemId, boardKey, profileLocalId);
}

function enqueueEvent(
  db: DatabaseInstance,
  eventType: string,
  opts: { boardId?: string; itemId?: string } = {},
): number {
  const res = db
    .prepare(
      "INSERT INTO webhook_events (event_type, monday_board_id, monday_item_id, payload) VALUES (?, ?, ?, '{}')",
    )
    .run(eventType, opts.boardId ?? null, opts.itemId ?? null);
  return Number(res.lastInsertRowid);
}

const eventRow = (db: DatabaseInstance, id: number) =>
  db.prepare("SELECT status, attempts, last_error FROM webhook_events WHERE id = ?").get(id) as {
    status: string;
    attempts: number;
    last_error: string | null;
  };

describe("processWebhookEvents", () => {
  beforeEach(() => {
    fetchItemUpdatesBatchMock.mockReset();
  });

  it("archives and removes a deleted item directly", async () => {
    const db = freshDb();
    insertProfile(db, "900");
    const id = enqueueEvent(db, "item_deleted", { itemId: "900" });

    const stats = await processWebhookEvents(db, {
      boardKeyForId: () => null,
      runTargetedSync: vi.fn(),
    });

    expect(stats.processed).toBe(1);
    expect(eventRow(db, id).status).toBe("processed");
    const remaining = db.prepare("SELECT COUNT(*) AS n FROM profiles").get() as { n: number };
    expect(remaining.n).toBe(0);
    const archived = db
      .prepare("SELECT source_table, monday_item_id, snapshot_json FROM archived_rows")
      .get() as { source_table: string; monday_item_id: string; snapshot_json: string };
    expect(archived.source_table).toBe("profiles");
    expect(archived.monday_item_id).toBe("900");
    expect(JSON.parse(archived.snapshot_json).name).toBe("Test Client");
    db.close();
  });

  it("groups column-change events into one targeted sync and marks them processed", async () => {
    const db = freshDb();
    const a = enqueueEvent(db, "update_column_value", { boardId: "111", itemId: "1" });
    const b = enqueueEvent(db, "update_column_value", { boardId: "111", itemId: "2" });
    const c = enqueueEvent(db, "create_pulse", { boardId: "222", itemId: "3" });
    const runTargetedSync = vi.fn().mockResolvedValue(true);

    const stats = await processWebhookEvents(db, {
      boardKeyForId: (bid) => (bid === "111" ? "court_cases" : bid === "222" ? "fee_ks" : null),
      runTargetedSync,
    });

    expect(runTargetedSync).toHaveBeenCalledTimes(1);
    expect(runTargetedSync.mock.calls[0]![0]).toEqual(["court_cases", "fee_ks"]);
    expect(stats.processed).toBe(3);
    for (const id of [a, b, c]) expect(eventRow(db, id).status).toBe("processed");
    db.close();
  });

  it("leaves refresh events pending when the sync is busy (skipped)", async () => {
    const db = freshDb();
    const id = enqueueEvent(db, "update_column_value", { boardId: "111", itemId: "1" });
    const stats = await processWebhookEvents(db, {
      boardKeyForId: () => "court_cases",
      runTargetedSync: vi.fn().mockResolvedValue(false),
    });
    expect(stats.syncSkippedBusy).toBe(true);
    const row = eventRow(db, id);
    expect(row.status).toBe("pending");
    expect(row.attempts).toBe(0); // busy is not a failure
    db.close();
  });

  it("skips events from untracked boards", async () => {
    const db = freshDb();
    const id = enqueueEvent(db, "update_column_value", { boardId: "999", itemId: "1" });
    const stats = await processWebhookEvents(db, {
      boardKeyForId: () => null,
      runTargetedSync: vi.fn(),
    });
    expect(stats.skipped).toBe(1);
    expect(eventRow(db, id).status).toBe("skipped");
    db.close();
  });

  it("refreshes notes for a create_update event (upsert handles the edit case)", async () => {
    const db = freshDb();
    insertProfile(db, "500", "prof-500");
    const id = enqueueEvent(db, "create_update", { itemId: "500" });
    fetchItemUpdatesBatchMock.mockResolvedValue(
      new Map([
        [
          "500",
          [
            {
              id: "u1",
              body: "<p>Hola</p>",
              created_at: "2026-08-06T10:00:00Z",
              creator: { name: "Ana", email: "ana@x.com" },
              assets: [],
              replies: [],
            },
          ],
        ],
      ]),
    );

    await processWebhookEvents(db, { boardKeyForId: () => null, runTargetedSync: vi.fn() });
    expect(eventRow(db, id).status).toBe("processed");
    let note = db
      .prepare("SELECT text_body, author_name FROM client_updates WHERE monday_update_id = 'u1'")
      .get() as { text_body: string; author_name: string };
    expect(note.text_body).toBe("Hola");
    expect(note.author_name).toBe("Ana");

    // Same update id again with an edited body → row is updated, not duplicated.
    enqueueEvent(db, "edit_update", { itemId: "500" });
    fetchItemUpdatesBatchMock.mockResolvedValue(
      new Map([
        [
          "500",
          [
            {
              id: "u1",
              body: "<p>Hola editado</p>",
              created_at: "2026-08-06T10:00:00Z",
              creator: { name: "Ana", email: "ana@x.com" },
              assets: [],
              replies: [],
            },
          ],
        ],
      ]),
    );
    await processWebhookEvents(db, { boardKeyForId: () => null, runTargetedSync: vi.fn() });

    const count = db.prepare("SELECT COUNT(*) AS n FROM client_updates").get() as { n: number };
    expect(count.n).toBe(1);
    note = db
      .prepare("SELECT text_body, author_name FROM client_updates WHERE monday_update_id = 'u1'")
      .get() as { text_body: string; author_name: string };
    expect(note.text_body).toBe("Hola editado");
    db.close();
  });

  it("retries a failing note refresh with backoff, then dead-letters", async () => {
    const db = freshDb();
    insertProfile(db, "600");
    const id = enqueueEvent(db, "create_update", { itemId: "600" });
    db.prepare("UPDATE webhook_events SET attempts = 4 WHERE id = ?").run(id); // one attempt left
    fetchItemUpdatesBatchMock.mockRejectedValue(new Error("monday down"));

    const stats = await processWebhookEvents(db, { boardKeyForId: () => null, runTargetedSync: vi.fn() });
    expect(stats.failed).toBe(1);
    const row = eventRow(db, id);
    expect(row.status).toBe("failed");
    expect(row.last_error).toContain("monday down");
    db.close();
  });
});

describe("archiveItemByMondayId", () => {
  it("finds rows across tables and preserves board_key for board items", () => {
    const db = freshDb();
    insertProfile(db, "1", "prof-1");
    insertBoardItem(db, "2", "court_cases", "prof-1");

    expect(archiveItemByMondayId(db, "2")).toBe(true);
    const archived = db
      .prepare("SELECT source_table, board_key FROM archived_rows WHERE monday_item_id = '2'")
      .get() as { source_table: string; board_key: string };
    expect(archived.source_table).toBe("board_items");
    expect(archived.board_key).toBe("court_cases");

    expect(archiveItemByMondayId(db, "does-not-exist")).toBe(false);
    db.close();
  });
});

describe("note deletions (delete_update)", () => {
  it("reads the update id from the spellings Monday uses", () => {
    expect(deletedUpdateIdFrom(JSON.stringify({ event: { updateId: 4242 } }))).toBe("4242");
    expect(deletedUpdateIdFrom(JSON.stringify({ event: { update_id: "77" } }))).toBe("77");
    expect(deletedUpdateIdFrom(JSON.stringify({ event: { updateFullId: 9 } }))).toBe("9");
  });

  it("returns null for shapes it does not recognise, so nothing is deleted on a guess", () => {
    expect(deletedUpdateIdFrom("not json")).toBeNull();
    expect(deletedUpdateIdFrom(JSON.stringify({ event: {} }))).toBeNull();
    expect(deletedUpdateIdFrom(JSON.stringify({ event: { updateId: "  " } }))).toBeNull();
    expect(deletedUpdateIdFrom(JSON.stringify({ nope: true }))).toBeNull();
  });

  it("removes the note and its replies, leaving other notes alone", () => {
    const db = freshDb();
    insertProfile(db, "100", "p1");
    const insert = db.prepare(
      `INSERT INTO client_updates (batch_id, local_id, monday_update_id, profile_local_id, author_name, text_body, source_type, reply_to_update_id, created_at_source)
       VALUES (1, ?, ?, 'p1', 'Tester', ?, ?, ?, '2026-08-06T00:00:00Z')`,
    );
    insert.run("u1", "500", "the note", "update", null);
    insert.run("u2", "501", "a reply", "reply", "500");
    insert.run("u3", "600", "an unrelated note", "update", null);

    expect(deleteNoteByMondayUpdateId(db, "500")).toBe(2);
    const left = db.prepare("SELECT monday_update_id FROM client_updates").all() as { monday_update_id: string }[];
    expect(left.map((r) => r.monday_update_id)).toEqual(["600"]);

    expect(deleteNoteByMondayUpdateId(db, "does-not-exist")).toBe(0);
    db.close();
  });
});
