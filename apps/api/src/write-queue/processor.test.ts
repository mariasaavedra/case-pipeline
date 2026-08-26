// =============================================================================
// Write-queue processor tests (offline — Monday.com client is mocked)
// =============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initializeSchema } from "@case-pipeline/seed/db/schema";

const { createUpdateMock, changeSimpleColumnValueMock, changeColumnValueMock, createItemMock } = vi.hoisted(() => ({
  createUpdateMock: vi.fn(),
  changeSimpleColumnValueMock: vi.fn(),
  changeColumnValueMock: vi.fn(),
  createItemMock: vi.fn(),
}));
// Only the mutations are stubbed; the error classes stay real, because
// the token-fallback logic keys off `instanceof` to tell a permission refusal
// apart from a transient outage.
vi.mock("@case-pipeline/monday", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@case-pipeline/monday")>()),
  createUpdate: createUpdateMock,
  changeSimpleColumnValue: changeSimpleColumnValueMock,
  changeColumnValue: changeColumnValueMock,
  createItem: createItemMock,
}));

import { AuthError, MondayApiError } from "@case-pipeline/monday";
import { enqueueWrite, drainWriteQueue } from "./processor";

type DatabaseInstance = InstanceType<typeof Database>;

function freshDb(): DatabaseInstance {
  const db = new Database(":memory:");
  initializeSchema(db);
  return db;
}

interface Row {
  status: string;
  attempts: number;
  last_error: string | null;
  next_attempt_at: string | null;
}
const queueRow = (db: DatabaseInstance) =>
  db.prepare("SELECT status, attempts, last_error, next_attempt_at FROM write_queue").get() as Row;

describe("write-queue processor", () => {
  beforeEach(() => {
    createUpdateMock.mockReset();
    changeSimpleColumnValueMock.mockReset();
    changeColumnValueMock.mockReset();
    createItemMock.mockReset();
  });

  it("syncs a create_update op and marks it synced", async () => {
    const db = freshDb();
    createUpdateMock.mockResolvedValue("monday-update-1");

    enqueueWrite(db, { opType: "create_update", mondayItemId: "123", payload: { body: "hi" } });
    const synced = await drainWriteQueue(db, { token: "tok" });

    expect(synced).toBe(1);
    expect(createUpdateMock).toHaveBeenCalledWith("123", "hi", "tok", undefined, undefined);
    expect(queueRow(db).status).toBe("synced");
    db.close();
  });

  it("syncs a create_update op as a threaded reply when parentId is queued", async () => {
    const db = freshDb();
    createUpdateMock.mockResolvedValue("reply-1");

    enqueueWrite(db, {
      opType: "create_update",
      mondayItemId: "123",
      payload: { body: "hi", parentId: "update-999" },
    });
    const synced = await drainWriteQueue(db, { token: "tok" });

    expect(synced).toBe(1);
    expect(createUpdateMock).toHaveBeenCalledWith("123", "hi", "tok", "update-999", undefined);
    expect(queueRow(db).status).toBe("synced");
    db.close();
  });

  it("syncs a create_update op with mentions_list when mentions are queued", async () => {
    const db = freshDb();
    createUpdateMock.mockResolvedValue("update-with-mention-1");

    enqueueWrite(db, {
      opType: "create_update",
      mondayItemId: "123",
      payload: { body: "cc @Jane", mentions: [{ id: "42", type: "User" }] },
    });
    const synced = await drainWriteQueue(db, { token: "tok" });

    expect(synced).toBe(1);
    expect(createUpdateMock).toHaveBeenCalledWith("123", "cc @Jane", "tok", undefined, [{ id: "42", type: "User" }]);
    expect(queueRow(db).status).toBe("synced");
    db.close();
  });

  it("retries with backoff on failure (not dead-lettered before max attempts)", async () => {
    const db = freshDb();
    // A missing monday_item_id makes dispatch fail deterministically — exercises
    // the retry/backoff path without relying on a rejected network mock.
    enqueueWrite(db, { opType: "create_update", mondayItemId: null, payload: { body: "hi" }, maxAttempts: 3 });
    const synced = await drainWriteQueue(db);

    expect(synced).toBe(0);
    const row = queueRow(db);
    expect(row.status).toBe("pending");
    expect(row.attempts).toBe(1);
    expect(row.last_error).toContain("monday_item_id");
    expect(row.next_attempt_at).toBeTruthy(); // backoff scheduled
    expect(createUpdateMock).not.toHaveBeenCalled();
    db.close();
  });

  it("dead-letters after reaching max attempts", async () => {
    const db = freshDb();
    enqueueWrite(db, { opType: "create_update", mondayItemId: null, payload: { body: "hi" }, maxAttempts: 1 });
    await drainWriteQueue(db);

    const row = queueRow(db);
    expect(row.status).toBe("failed");
    expect(row.attempts).toBe(1);
    db.close();
  });

  it("skips items whose next_attempt_at is still in the future", async () => {
    const db = freshDb();
    createUpdateMock.mockResolvedValue("x");

    const id = enqueueWrite(db, { opType: "create_update", mondayItemId: "123", payload: { body: "hi" } });
    db.prepare("UPDATE write_queue SET next_attempt_at = ? WHERE id = ?").run(
      new Date(Date.now() + 60_000).toISOString(),
      id,
    );
    const synced = await drainWriteQueue(db);

    expect(synced).toBe(0);
    expect(createUpdateMock).not.toHaveBeenCalled();
    db.close();
  });

  it("dead-letters an unsupported op_type without calling Monday.com", async () => {
    const db = freshDb();

    // `reschedule` is still a TODO — a genuinely unsupported op_type.
    enqueueWrite(db, { opType: "reschedule", mondayItemId: "123", payload: {}, maxAttempts: 1 });
    await drainWriteQueue(db);

    const row = queueRow(db);
    expect(row.status).toBe("failed");
    expect(row.last_error).toContain("Unsupported");
    expect(createUpdateMock).not.toHaveBeenCalled();
    db.close();
  });

  it("syncs a change_column op via change_simple_column_value", async () => {
    const db = freshDb();
    changeSimpleColumnValueMock.mockResolvedValue("123");

    enqueueWrite(db, {
      opType: "change_column",
      mondayItemId: "123",
      payload: { boardId: "board-9", columnId: "status", value: "Filed" },
    });
    const synced = await drainWriteQueue(db, { token: "tok" });

    expect(synced).toBe(1);
    expect(changeSimpleColumnValueMock).toHaveBeenCalledWith("board-9", "123", "status", "Filed", "tok");
    expect(queueRow(db).status).toBe("synced");
    db.close();
  });

  it("syncs a create_item op via create_item", async () => {
    const db = freshDb();
    createItemMock.mockResolvedValue("new-item-1");

    enqueueWrite(db, {
      opType: "create_item",
      payload: { boardId: "board-9", itemName: "Jane — U-Visa", columnValues: { deal_value: 5000 } },
    });
    const synced = await drainWriteQueue(db, { token: "tok" });

    expect(synced).toBe(1);
    expect(createItemMock).toHaveBeenCalledWith("board-9", "Jane — U-Visa", { deal_value: 5000 }, "tok");
    expect(queueRow(db).status).toBe("synced");
    db.close();
  });

  it("syncs a change_column_json op via change_column_value", async () => {
    const db = freshDb();
    changeColumnValueMock.mockResolvedValue("123");

    enqueueWrite(db, {
      opType: "change_column_json",
      mondayItemId: "123",
      payload: { boardId: "board-9", columnId: "people__1", value: { personsAndTeams: [{ id: 42, kind: "person" }] } },
    });
    const synced = await drainWriteQueue(db, { token: "tok" });

    expect(synced).toBe(1);
    expect(changeColumnValueMock).toHaveBeenCalledWith(
      "board-9", "123", "people__1", { personsAndTeams: [{ id: 42, kind: "person" }] }, "tok",
    );
    expect(queueRow(db).status).toBe("synced");
    db.close();
  });

  it("dead-letters a change_column op missing board/column ids", async () => {
    const db = freshDb();

    enqueueWrite(db, { opType: "change_column", mondayItemId: "123", payload: { value: "Filed" }, maxAttempts: 1 });
    await drainWriteQueue(db);

    const row = queueRow(db);
    expect(row.status).toBe("failed");
    expect(row.last_error).toContain("boardId");
    expect(changeSimpleColumnValueMock).not.toHaveBeenCalled();
    db.close();
  });

  // ---------------------------------------------------------------------------
  // Personal token → shared token fallback
  // ---------------------------------------------------------------------------
  // The regression this guards: a personal token issued before `boards:write`
  // was requested burned all five attempts and dead-lettered a status change the
  // shared token could have made — while the dashboard showed it as applied.

  it("retries with the shared token when the author's personal token is refused", async () => {
    const db = freshDb();
    changeSimpleColumnValueMock
      .mockRejectedValueOnce(new AuthError("Authentication failed: 403 Forbidden"))
      .mockResolvedValueOnce("123");
    const rejected = vi.fn();

    enqueueWrite(db, {
      opType: "change_column",
      mondayItemId: "123",
      authorOid: "oid-1",
      payload: { boardId: "board-9", columnId: "status", value: "Filed" },
    });
    const synced = await drainWriteQueue(db, {
      token: "shared-tok",
      resolveUserToken: () => "personal-tok",
      reportTokenRejected: rejected,
    });

    expect(synced).toBe(1);
    expect(changeSimpleColumnValueMock).toHaveBeenNthCalledWith(1, "board-9", "123", "status", "Filed", "personal-tok");
    expect(changeSimpleColumnValueMock).toHaveBeenNthCalledWith(2, "board-9", "123", "status", "Filed", "shared-tok");
    expect(queueRow(db).status).toBe("synced");
    expect(rejected).toHaveBeenCalledWith("oid-1", "Authentication failed: 403 Forbidden");
    db.close();
  });

  it("keeps retrying later on a transient failure instead of burning the shared token", async () => {
    const db = freshDb();
    createUpdateMock.mockRejectedValue(new MondayApiError("Server error: 503", 503, true));

    enqueueWrite(db, {
      opType: "create_update",
      mondayItemId: "123",
      authorOid: "oid-1",
      payload: { body: "hi" },
    });
    const synced = await drainWriteQueue(db, { token: "shared-tok", resolveUserToken: () => "personal-tok" });

    expect(synced).toBe(0);
    // One attempt only — no fallback call with the shared token.
    expect(createUpdateMock).toHaveBeenCalledOnce();
    const row = queueRow(db);
    expect(row.status).toBe("pending");
    expect(row.attempts).toBe(1);
    db.close();
  });

  // ---------------------------------------------------------------------------
  // create_item reconciliation
  // ---------------------------------------------------------------------------
  // The regression this guards: target_table/target_local_id are set on EVERY
  // create_item op, not just placeholder rows created while Monday was down
  // (e.g. Fee K creation targets the already-linked profile purely for audit
  // context). Reconciliation must only attach the new item id to a row that's
  // actually still awaiting one.

  it("attaches the new item id to a placeholder row with no monday_item_id yet", async () => {
    const db = freshDb();
    createItemMock.mockResolvedValue("new-call-1");
    db.prepare(
      `INSERT INTO board_items (local_id, monday_item_id, board_key, name, column_values, sync_status)
       VALUES ('call-local-1', NULL, 'call_log', 'Jane Doe', '{}', 'pending')`,
    ).run();

    enqueueWrite(db, {
      opType: "create_item",
      targetTable: "board_items",
      targetLocalId: "call-local-1",
      payload: { boardId: "board-9", itemName: "Jane Doe" },
    });
    const synced = await drainWriteQueue(db, { token: "tok" });

    expect(synced).toBe(1);
    const row = db.prepare("SELECT monday_item_id, sync_status FROM board_items WHERE local_id = 'call-local-1'").get() as {
      monday_item_id: string | null;
      sync_status: string;
    };
    expect(row.monday_item_id).toBe("new-call-1");
    expect(row.sync_status).toBe("synced");
    db.close();
  });

  it("does not overwrite an existing row's monday_item_id when create_item targets it only for audit context", async () => {
    const db = freshDb();
    createItemMock.mockResolvedValue("new-fee-k-1");
    db.prepare(
      `INSERT INTO profiles (local_id, monday_item_id, name) VALUES ('profile-local-1', 'existing-profile-item', 'Jane Doe')`,
    ).run();

    // Mirrors the Fee K creation flow: targetLocalId is the profile's OWN id,
    // used for audit context — not a placeholder awaiting the new Fee K's id.
    enqueueWrite(db, {
      opType: "create_item",
      targetTable: "profiles",
      targetLocalId: "profile-local-1",
      payload: { boardId: "board-9", itemName: "Jane Doe — U-Visa" },
    });
    const synced = await drainWriteQueue(db, { token: "tok" });

    expect(synced).toBe(1);
    const row = db.prepare("SELECT monday_item_id FROM profiles WHERE local_id = 'profile-local-1'").get() as {
      monday_item_id: string | null;
    };
    expect(row.monday_item_id).toBe("existing-profile-item");
    db.close();
  });

  it("does not drain while the sync advisory lock is held by another writer", async () => {
    const db = freshDb();
    createUpdateMock.mockResolvedValue("x");
    enqueueWrite(db, { opType: "create_update", mondayItemId: "123", payload: { body: "hi" } });

    // Simulate a sync run holding the lock.
    db.prepare("UPDATE sync_state SET locked_by = 'sync-test', locked_at = ? WHERE id = 1").run(
      new Date().toISOString(),
    );
    const synced = await drainWriteQueue(db);

    expect(synced).toBe(0);
    expect(createUpdateMock).not.toHaveBeenCalled();
    expect(queueRow(db).status).toBe("pending");
    db.close();
  });
});
