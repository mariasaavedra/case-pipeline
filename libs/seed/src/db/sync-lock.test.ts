// =============================================================================
// Sync advisory lock tests
// =============================================================================
// The lock exists so the write-queue processor never mutates live.db while the
// sync is rebuilding it. That guarantee had a hole: a held lock goes stale after
// 30 minutes and nothing refreshed it, while a full walk now runs for about four
// hours — so from minute 30 of every nightly sync the queue could take the lock
// and write anyway. These pin the heartbeat that closes it.
// =============================================================================

import { test, expect, describe, beforeEach } from "vitest";
import Database from "better-sqlite3";
type DatabaseInstance = InstanceType<typeof Database>;
import { acquireSyncLock, releaseSyncLock, refreshSyncLock, syncLockHolder } from "./sync-lock";

const STALE_MS = 30 * 60 * 1000;

let db: DatabaseInstance;
beforeEach(() => {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE sync_state (
      id INTEGER PRIMARY KEY, locked_by TEXT, locked_at TEXT,
      last_sync_at TEXT, last_sync_status TEXT
    );
    INSERT INTO sync_state (id) VALUES (1);
  `);
});

/** Backdate the held lock, standing in for time passing. */
function ageLock(ms: number): void {
  db.prepare("UPDATE sync_state SET locked_at = ? WHERE id = 1").run(
    new Date(Date.now() - ms).toISOString(),
  );
}

describe("acquire and release", () => {
  test("a free lock can be taken", () => {
    expect(acquireSyncLock(db, "sync-1")).toBe(true);
    expect(syncLockHolder(db)).toBe("sync-1");
  });

  test("a held lock cannot be taken by someone else", () => {
    acquireSyncLock(db, "sync-1");
    expect(acquireSyncLock(db, "queue-1")).toBe(false);
  });

  test("releasing frees it", () => {
    acquireSyncLock(db, "sync-1");
    releaseSyncLock(db, "sync-1");
    expect(syncLockHolder(db)).toBeNull();
    expect(acquireSyncLock(db, "queue-1")).toBe(true);
  });

  test("a non-holder cannot release someone else's lock", () => {
    acquireSyncLock(db, "sync-1");
    releaseSyncLock(db, "queue-1");
    expect(syncLockHolder(db)).toBe("sync-1");
  });
});

describe("staleness", () => {
  test("a lock held silently past the stale window can be stolen", () => {
    // The safety valve: a crashed holder must not wedge the queue forever.
    acquireSyncLock(db, "sync-1");
    ageLock(STALE_MS + 60_000);
    expect(syncLockHolder(db)).toBeNull();
    expect(acquireSyncLock(db, "queue-1")).toBe(true);
  });

  test("a refreshed lock is NOT stolen — the four-hour sync case", () => {
    // Without the heartbeat this is where the write-queue processor took the
    // lock and mutated a database mid-rebuild.
    acquireSyncLock(db, "sync-1");
    ageLock(STALE_MS + 60_000);
    expect(refreshSyncLock(db, "sync-1")).toBe(true);
    expect(syncLockHolder(db)).toBe("sync-1");
    expect(acquireSyncLock(db, "queue-1")).toBe(false);
  });

  test("a heartbeat keeps working across many stale windows", () => {
    acquireSyncLock(db, "sync-1");
    for (let hour = 0; hour < 4; hour++) {
      ageLock(STALE_MS - 60_000);
      expect(refreshSyncLock(db, "sync-1")).toBe(true);
    }
    expect(acquireSyncLock(db, "queue-1")).toBe(false);
  });
});

describe("refreshSyncLock", () => {
  test("reports false once the lock has been lost, so the holder can notice", () => {
    acquireSyncLock(db, "sync-1");
    ageLock(STALE_MS + 60_000);
    acquireSyncLock(db, "queue-1"); // stolen
    expect(refreshSyncLock(db, "sync-1")).toBe(false);
    expect(syncLockHolder(db)).toBe("queue-1");
  });

  test("refreshing a lock nobody holds does nothing", () => {
    expect(refreshSyncLock(db, "sync-1")).toBe(false);
    expect(syncLockHolder(db)).toBeNull();
  });
});

describe("syncLockHolder", () => {
  test("null when free — which is what lets the backup proceed", () => {
    expect(syncLockHolder(db)).toBeNull();
  });

  test("names the holder while a sync is live", () => {
    acquireSyncLock(db, "sync-4242");
    expect(syncLockHolder(db)).toBe("sync-4242");
  });
});
