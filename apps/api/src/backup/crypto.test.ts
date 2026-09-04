// =============================================================================
// Backup encryption tests
// =============================================================================
// These exist because of 2026-09-02, when the daily backup wrote 999,952,384
// bytes of a 1,594,970,112-byte database and stopped. The stream resolved, the
// plaintext was left on disk unencrypted, and the truncated `.db.enc` sat in
// the retention series as one of four restore points until someone happened to
// compare file sizes two days later.
//
// Two invariants follow, and both are asserted here:
//   1. An encrypted backup is ALWAYS plaintext + 48 bytes. Anything else is a
//      partial write and must not be accepted as a backup.
//   2. A failed encryption leaves NOTHING behind — not a partial ciphertext
//      that will fail at restore time, and not an unencrypted copy of PII.

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  encryptFile,
  encryptFileSync,
  decryptFile,
  assertCompleteCiphertext,
  ENCRYPT_OVERHEAD,
} from "./crypto";

const PASS = "test-passphrase-not-for-production";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bkcrypto-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** A file with enough bytes to span several stream chunks. */
function makeSource(name = "live-2026-09-02T05-30-00-029Z.db", bytes = 300_000): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, Buffer.alloc(bytes, "a"));
  return p;
}

describe("encryptFile", () => {
  test("writes exactly plaintext + 48 bytes and removes the plaintext", async () => {
    const src = makeSource();
    const size = fs.statSync(src).size;

    const dest = await encryptFile(src, PASS);

    expect(fs.statSync(dest).size).toBe(size + ENCRYPT_OVERHEAD);
    expect(fs.existsSync(src)).toBe(false);
  });

  test("round-trips back to identical bytes", async () => {
    const src = makeSource();
    const original = fs.readFileSync(src);

    const dest = await encryptFile(src, PASS);
    const out = path.join(dir, "restored.db");
    await decryptFile(dest, PASS, out);

    expect(fs.readFileSync(out).equals(original)).toBe(true);
  });

  test("a truncated backup cannot be restored — which is why size is checked", async () => {
    // The 2026-09-02 artefact, reproduced: a .enc that looks like a valid
    // backup by name and fails only when someone actually needs it.
    const src = makeSource();
    const dest = await encryptFile(src, PASS);
    fs.truncateSync(dest, Math.floor(fs.statSync(dest).size / 2));

    await expect(decryptFile(dest, PASS, path.join(dir, "restored.db"))).rejects.toThrow();
  });

  test("on failure it leaves no unencrypted copy of the data behind", async () => {
    // Force the write to fail by parking a directory where the .enc must go.
    const src = makeSource();
    fs.mkdirSync(`${src}.enc`);

    await expect(encryptFile(src, PASS)).rejects.toThrow();

    // The plaintext is a throwaway copy and the source database is untouched,
    // so removing it costs nothing — whereas leaving it is client PII sitting
    // in the clear, written by the routine meant to prevent exactly that.
    expect(fs.existsSync(src)).toBe(false);
  });
});

describe("encryptFileSync", () => {
  test("writes exactly plaintext + 48 bytes and removes the plaintext", () => {
    const src = makeSource("users-2026-09-02T05-30-00-029Z.db", 4_096);
    const size = fs.statSync(src).size;

    const dest = encryptFileSync(src, PASS);

    expect(fs.statSync(dest).size).toBe(size + ENCRYPT_OVERHEAD);
    expect(fs.existsSync(src)).toBe(false);
  });

  test("round-trips back to identical bytes", async () => {
    const src = makeSource("users-round-trip.db", 4_096);
    const original = fs.readFileSync(src);

    const dest = encryptFileSync(src, PASS);
    const out = path.join(dir, "restored-users.db");
    await decryptFile(dest, PASS, out);

    expect(fs.readFileSync(out).equals(original)).toBe(true);
  });

  test("on failure it leaves no unencrypted copy behind", () => {
    const src = makeSource("users-fail.db", 4_096);
    fs.mkdirSync(`${src}.enc`);

    expect(() => encryptFileSync(src, PASS)).toThrow();
    expect(fs.existsSync(src)).toBe(false);
  });
});

describe("assertCompleteCiphertext", () => {
  test("accepts a ciphertext of exactly plaintext + 48", () => {
    const dest = path.join(dir, "ok.db.enc");
    fs.writeFileSync(dest, Buffer.alloc(1_000 + ENCRYPT_OVERHEAD));
    expect(() => assertCompleteCiphertext(dest, 1_000)).not.toThrow();
  });

  test("rejects the 2026-09-02 short write", () => {
    // The real numbers from production: a 1,594,970,112-byte database whose
    // encryption stopped at 999,952,384. Scaled down, same shape.
    const dest = path.join(dir, "short.db.enc");
    fs.writeFileSync(dest, Buffer.alloc(999));
    expect(() => assertCompleteCiphertext(dest, 1_594)).toThrow(/did not complete/);
  });

  test("rejects a ciphertext that is too LONG", () => {
    // Not merely the mirror case: a longer-than-expected file means the writer
    // appended to an existing one rather than replacing it.
    const dest = path.join(dir, "long.db.enc");
    fs.writeFileSync(dest, Buffer.alloc(1_000 + ENCRYPT_OVERHEAD + 1));
    expect(() => assertCompleteCiphertext(dest, 1_000)).toThrow(/did not complete/);
  });
});
