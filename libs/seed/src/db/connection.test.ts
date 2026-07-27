import { test, expect, describe, afterEach } from "vitest";
import { initializeDatabase, closeDatabase, openDatabase, applyPragmas, isDatabaseHealthy } from "./connection";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

afterEach(() => {
  closeDatabase();
});

function tmpFile(name: string): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cp-conn-")), name);
}

describe("durability pragma", () => {
  test("durable=true sets synchronous=FULL, default stays NORMAL", () => {
    const full = new Database(":memory:");
    applyPragmas(full, false, true);
    expect(full.pragma("synchronous", { simple: true })).toBe(2); // 2 = FULL
    full.close();

    const normal = new Database(":memory:");
    applyPragmas(normal, false, false);
    expect(normal.pragma("synchronous", { simple: true })).toBe(1); // 1 = NORMAL
    normal.close();
  });
});

describe("isDatabaseHealthy", () => {
  test("returns true for a sound database", () => {
    const p = tmpFile("good.db");
    const db = openDatabase(p);
    db.exec("CREATE TABLE t (x); INSERT INTO t VALUES (1), (2), (3);");
    expect(isDatabaseHealthy(db)).toBe(true);
    db.close();
  });

  test("returns false for a corrupt database file", () => {
    const p = tmpFile("bad.db");
    // Keep everything in the main file (no WAL) so the raw clobber below lands.
    const seed = new Database(p);
    seed.pragma("journal_mode = DELETE");
    seed.exec("CREATE TABLE t (x TEXT)");
    const ins = seed.prepare("INSERT INTO t VALUES (?)");
    for (let i = 0; i < 500; i++) ins.run("row-" + i);
    seed.close();

    // Clobber the first page's b-tree body (byte 100 onward is page-1 content).
    const fd = fs.openSync(p, "r+");
    fs.writeSync(fd, Buffer.alloc(3900, 0xff), 0, 3900, 100);
    fs.closeSync(fd);

    const db = new Database(p, { readonly: true });
    expect(isDatabaseHealthy(db)).toBe(false);
    db.close();
  });
});

describe("initializeDatabase", () => {
  test("returns the same instance for the same path", () => {
    const db1 = initializeDatabase({ path: ":memory:" });
    const db2 = initializeDatabase({ path: ":memory:" });
    expect(db1).toBe(db2);
  });

  test("throws when called with a different path", () => {
    initializeDatabase({ path: ":memory:" });
    expect(() =>
      initializeDatabase({ path: "/tmp/other-test.db" })
    ).toThrow("Database already initialized");
  });

  test("allows reinitialization after closeDatabase", () => {
    initializeDatabase({ path: ":memory:" });
    closeDatabase();
    const db = initializeDatabase({ path: ":memory:" });
    expect(db).toBeDefined();
  });
});
