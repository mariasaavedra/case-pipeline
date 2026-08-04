// =============================================================================
// backup-db tests — retention pruning and the corrupt-source guard
// =============================================================================

import { test, expect, describe, afterEach } from "vitest";
import { backupDatabase } from "./backup-db";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let dataDir: string;

function makeGoodDb(name: string): void {
  const db = new Database(path.join(dataDir, name));
  db.pragma("journal_mode = DELETE");
  db.exec("CREATE TABLE t (x); INSERT INTO t VALUES (1);");
  db.close();
}

function corrupt(name: string): void {
  const p = path.join(dataDir, name);
  const db = new Database(p);
  db.pragma("journal_mode = DELETE");
  db.exec("CREATE TABLE IF NOT EXISTS grow (x TEXT)");
  const ins = db.prepare("INSERT INTO grow VALUES (?)");
  for (let i = 0; i < 500; i++) ins.run("row-" + i); // grow past one page
  db.close();
  const fd = fs.openSync(p, "r+");
  fs.writeSync(fd, Buffer.alloc(3900, 0xff), 0, 3900, 100); // clobber page-1 body
  fs.closeSync(fd);
}

function backupsFor(label: string): string[] {
  return fs
    .readdirSync(path.join(dataDir, "backups"))
    .filter((f) => new RegExp(`^${label}-\\d.*\\.db$`).test(f))
    .sort();
}

afterEach(() => {
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("backupDatabase", () => {
  // Real online-backup + integrity-check I/O — inherently variable and slower on
  // shared CI runners, so allow well past the 5s default (locally it's sub-second).
  const IO_TIMEOUT = 20000;

  test("prunes to the retention limit for a healthy source", async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cp-bk-"));
    makeGoodDb("live.db");
    for (let i = 0; i < 4; i++) {
      await backupDatabase({ source: "live", keep: 2, dataDir });
      await new Promise((r) => setTimeout(r, 20)); // distinct ISO stamps (ms precision)
    }
    expect(backupsFor("live").length).toBe(2);
  }, IO_TIMEOUT);

  test("a corrupt source is still backed up but NEVER prunes good backups", async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cp-bk-"));

    // Two good backups already on disk (the known-good restore points).
    makeGoodDb("live.db");
    await backupDatabase({ source: "live", keep: 2, dataDir });
    await new Promise((r) => setTimeout(r, 20));
    await backupDatabase({ source: "live", keep: 2, dataDir });
    expect(backupsFor("live").length).toBe(2);

    // Source goes corrupt; a backup with keep=1 would normally prune to 1.
    corrupt("live.db");
    await new Promise((r) => setTimeout(r, 20));
    await backupDatabase({ source: "live", keep: 1, dataDir });

    // The corrupt copy is written (evidence) but the two good ones survive.
    expect(backupsFor("live").length).toBe(3);
  }, IO_TIMEOUT);
});
