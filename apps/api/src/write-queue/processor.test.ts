// =============================================================================
// Write-queue processor tests (offline — Monday.com client is mocked)
// =============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initializeSchema } from "@case-pipeline/seed/db/schema";

const { createUpdateMock, changeSimpleColumnValueMock, createItemMock } = vi.hoisted(() => ({
  createUpdateMock: vi.fn(),
  changeSimpleColumnValueMock: vi.fn(),
  createItemMock: vi.fn(),
}));
vi.mock("@case-pipeline/monday", () => ({
  createUpdate: createUpdateMock,
  changeSimpleColumnValue: changeSimpleColumnValueMock,
  createItem: createItemMock,
}));

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
    createItemMock.mockReset();
  });

  it("syncs a create_update op and marks it synced", async () => {
    const db = freshDb();
    createUpdateMock.mockResolvedValue("monday-update-1");

    enqueueWrite(db, { opType: "create_update", mondayItemId: "123", payload: { body: "hi" } });
    const synced = await drainWriteQueue(db, { token: "tok" });

    expect(synced).toBe(1);
    expect(createUpdateMock).toHaveBeenCalledWith("123", "hi", "tok");
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
