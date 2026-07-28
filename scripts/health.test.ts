// =============================================================================
// health.ts tests — the database-level checks (runChecks)
// =============================================================================

import { test, expect, describe } from "vitest";
import Database from "better-sqlite3";
import { runChecks, type Check } from "./health";

type DatabaseInstance = InstanceType<typeof Database>;

function byName(checks: Check[], name: string): Check {
  const c = checks.find((x) => x.name === name);
  if (!c) throw new Error(`no check named ${name}`);
  return c;
}

/** A minimal DB with the tables/columns runChecks looks at. */
function makeDb(opts: {
  schema?: number;
  profiles?: number;
  boardItems?: number;
  lock?: { by: string; atMsAgo: number } | null;
  lastSync?: { at: string; status: string } | null;
}): DatabaseInstance {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE schema_version (version INTEGER PRIMARY KEY);
    CREATE TABLE sync_state (id INTEGER PRIMARY KEY, locked_by TEXT, locked_at TEXT, last_sync_at TEXT, last_sync_status TEXT);
    CREATE TABLE profiles (id INTEGER PRIMARY KEY);
    CREATE TABLE contracts (id INTEGER PRIMARY KEY);
    CREATE TABLE board_items (id INTEGER PRIMARY KEY);
    CREATE TABLE client_updates (id INTEGER PRIMARY KEY);
  `);
  if (opts.schema !== 0) db.prepare("INSERT INTO schema_version VALUES (?)").run(opts.schema ?? 16);
  db.prepare("INSERT INTO sync_state (id, locked_by, locked_at, last_sync_at, last_sync_status) VALUES (1, ?, ?, ?, ?)").run(
    opts.lock ? opts.lock.by : null,
    opts.lock ? new Date(Date.now() - opts.lock.atMsAgo).toISOString() : null,
    opts.lastSync ? opts.lastSync.at : null,
    opts.lastSync ? opts.lastSync.status : null,
  );
  for (let i = 0; i < (opts.profiles ?? 3); i++) db.prepare("INSERT INTO profiles DEFAULT VALUES").run();
  for (let i = 0; i < (opts.boardItems ?? 3); i++) db.prepare("INSERT INTO board_items DEFAULT VALUES").run();
  return db;
}

describe("runChecks", () => {
  test("a healthy database passes every check", () => {
    const db = makeDb({ lastSync: { at: new Date().toISOString(), status: "synced" } });
    const checks = runChecks(db);
    expect(checks.every((c) => c.status === "pass")).toBe(true);
    expect(byName(checks, "integrity").detail).toContain("ok");
    expect(byName(checks, "schema").detail).toBe("v16");
    db.close();
  });

  test("empty key tables FAIL the row-count check", () => {
    const db = makeDb({ profiles: 0 });
    expect(byName(runChecks(db), "row counts").status).toBe("fail");
    db.close();
  });

  test("a stale sync lock WARNs; a fresh one passes", () => {
    const stale = makeDb({ lock: { by: "sync-1", atMsAgo: 40 * 60 * 1000 } });
    expect(byName(runChecks(stale), "sync lock").status).toBe("warn");
    stale.close();

    const fresh = makeDb({ lock: { by: "sync-1", atMsAgo: 60 * 1000 } });
    expect(byName(runChecks(fresh), "sync lock").status).toBe("pass");
    fresh.close();
  });

  test("a recorded corrupt sync FAILs the last-sync check", () => {
    const db = makeDb({ lastSync: { at: new Date().toISOString(), status: "corrupt" } });
    expect(byName(runChecks(db), "last sync").status).toBe("fail");
    db.close();
  });

  test("a sync older than a day WARNs as stale", () => {
    const old = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString();
    const db = makeDb({ lastSync: { at: old, status: "synced" } });
    expect(byName(runChecks(db), "last sync").status).toBe("warn");
    db.close();
  });

  test("no schema FAILs", () => {
    const db = makeDb({ schema: 0 });
    expect(byName(runChecks(db), "schema").status).toBe("fail");
    db.close();
  });
});
