// =============================================================================
// Backup verification tests
// =============================================================================
// Retention hangs off this answer. Getting it wrong in one direction keeps
// every backup forever (which filled the disk for a fortnight); getting it
// wrong in the other deletes the last good copy. Both matter, so both are here.
// =============================================================================

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { verifyWrittenBackup } from "./verify";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "verify-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** A real SQLite file with a little data, the way db.backup() leaves one. */
function writeSoundDb(name: string): string {
  const file = path.join(dir, name);
  const db = new Database(file);
  db.exec("CREATE TABLE t (a TEXT); INSERT INTO t VALUES ('x'), ('y');");
  db.close();
  return file;
}

describe("verifyWrittenBackup", () => {
  test("a sound copy verifies", () => {
    expect(verifyWrittenBackup(writeSoundDb("live-2026-09-25.db"))).toBe(true);
  });

  test("a file that is not a database does not verify", () => {
    // The 2026-08-17 shape: the disk filled mid-write and left a partial file
    // behind. Pruning older copies on the strength of that would be the actual
    // disaster, and the old logic would have — it asked the SOURCE, which was fine.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const file = path.join(dir, "live-2026-09-25.db");
    fs.writeFileSync(file, "this is not a database");
    expect(verifyWrittenBackup(file)).toBe(false);
  });

  test("a truncated database does not verify", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const file = writeSoundDb("live-2026-09-25.db");
    const full = fs.readFileSync(file);
    fs.writeFileSync(file, full.subarray(0, Math.floor(full.length / 2)));
    expect(verifyWrittenBackup(file)).toBe(false);
  });

  test("a missing file does not verify, and does not throw", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(verifyWrittenBackup(path.join(dir, "never-written.db"))).toBe(false);
  });

  test("an empty file does not verify", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const file = path.join(dir, "live-2026-09-25.db");
    fs.writeFileSync(file, "");
    expect(verifyWrittenBackup(file)).toBe(false);
  });

  test("opens read-only — verification never writes to the copy it checks", () => {
    const file = writeSoundDb("live-2026-09-25.db");
    const before = fs.statSync(file).mtimeMs;
    expect(verifyWrittenBackup(file)).toBe(true);
    expect(fs.statSync(file).mtimeMs).toBe(before);
    // A read-only open must not leave WAL sidecars beside the backup either.
    expect(fs.existsSync(`${file}-wal`)).toBe(false);
    expect(fs.existsSync(`${file}-shm`)).toBe(false);
  });
});
