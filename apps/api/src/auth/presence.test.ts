import { describe, test, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import {
  touchPresence,
  resetPresenceThrottle,
  presenceStatus,
  listPresence,
  TOUCH_INTERVAL_MS,
} from "./presence.js";

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE users (
    id INTEGER PRIMARY KEY, azure_oid TEXT UNIQUE NOT NULL, email TEXT NOT NULL,
    name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, last_active_at TEXT
  )`);
  return db;
}

describe("presenceStatus", () => {
  test("buckets by age", () => {
    expect(presenceStatus(null)).toBe("offline");
    expect(presenceStatus(0)).toBe("online");
    expect(presenceStatus(5 * 60)).toBe("online");
    expect(presenceStatus(5 * 60 + 1)).toBe("idle");
    expect(presenceStatus(60 * 60)).toBe("idle");
    expect(presenceStatus(60 * 60 + 1)).toBe("offline");
  });
});

describe("touchPresence", () => {
  beforeEach(() => resetPresenceThrottle());

  test("writes once per interval per user", () => {
    const db = makeDb();
    db.prepare("INSERT INTO users (azure_oid, email, name) VALUES ('a', 'a@x', 'A')").run();
    expect(touchPresence(db, "a", 1_000)).toBe(true);
    expect(db.prepare("SELECT last_active_at FROM users").get()).toMatchObject({ last_active_at: expect.any(String) });
    expect(touchPresence(db, "a", 1_000 + TOUCH_INTERVAL_MS - 1)).toBe(false);
    expect(touchPresence(db, "a", 1_000 + TOUCH_INTERVAL_MS)).toBe(true);
    expect(touchPresence(db, "b", 1_000)).toBe(true); // separate user, separate throttle
  });
});

describe("listPresence", () => {
  test("derives status from server-side age, skips disabled users, newest first", () => {
    const db = makeDb();
    const ins = db.prepare("INSERT INTO users (azure_oid, email, name, active, last_active_at) VALUES (?, ?, ?, ?, ?)");
    ins.run("never", "n@x", "Never", 1, null);
    ins.run("old", "o@x", "Old", 1, "2020-01-01 00:00:00");
    db.prepare(
      "INSERT INTO users (azure_oid, email, name, active, last_active_at) VALUES ('idle', 'i@x', 'Idle', 1, datetime('now', '-20 minutes'))",
    ).run();
    db.prepare(
      "INSERT INTO users (azure_oid, email, name, active, last_active_at) VALUES ('on', 'on@x', 'On', 1, datetime('now', '-1 minute'))",
    ).run();
    db.prepare(
      "INSERT INTO users (azure_oid, email, name, active, last_active_at) VALUES ('off', 'off@x', 'Disabled', 0, datetime('now'))",
    ).run();

    const rows = listPresence(db);
    expect(rows.map((r) => [r.name, r.status])).toEqual([
      ["On", "online"],
      ["Idle", "idle"],
      ["Old", "offline"],
      ["Never", "offline"],
    ]);
    expect(rows[3]?.secondsAgo).toBeNull();
  });
});
