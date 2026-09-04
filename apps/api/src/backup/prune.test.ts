// =============================================================================
// Backup pruning tests
// =============================================================================
// The pre-migration series was never pruned by anything. Four full copies of
// live.db (v16 → v21) were still on disk when it reached 100% on 2026-08-17.

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pruneBackupSeries, premigratePattern, pruneOrphanedSidecars } from "./prune";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "prune-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const touch = (name: string) => fs.writeFileSync(path.join(dir, name), "x");
const listing = () => fs.readdirSync(dir).sort();

describe("premigratePattern", () => {
  const re = premigratePattern("live");

  test("matches a plain snapshot", () => {
    expect(re.test("live-premigrate-v21-2026-08-06T20-27-12-433Z.db")).toBe(true);
  });

  test("matches an ENCRYPTED snapshot", () => {
    // Snapshots are encrypted after being written, so by the time a later run
    // looks for them the name ends in .enc. Missing this is what made the other
    // retention path a silent no-op.
    expect(re.test("live-premigrate-v21-2026-08-06T20-27-12-433Z.db.enc")).toBe(true);
  });

  test("does not match the daily or presync series", () => {
    expect(re.test("live-2026-08-10T05-30-00-023Z.db.enc")).toBe(false);
    expect(re.test("live-presync-2026-08-10T05-03-01-212Z.db")).toBe(false);
  });

  test("keeps the users series separate from the mirror series", () => {
    expect(premigratePattern("users").test("live-premigrate-v21-2026-08-06T20-27-12-433Z.db")).toBe(false);
    expect(premigratePattern("users").test("users-premigrate-v10-2026-08-07T20-53-55-075Z.db")).toBe(true);
  });
});

describe("pruneBackupSeries", () => {
  test("keeps the N most recent and deletes the rest", () => {
    touch("live-premigrate-v19-2026-08-04T21-12-04-676Z.db.enc");
    touch("live-premigrate-v20-2026-08-05T15-31-12-413Z.db.enc");
    touch("live-premigrate-v21-2026-08-06T20-27-12-433Z.db.enc");

    const removed = pruneBackupSeries(dir, premigratePattern("live"), 2);

    expect(removed).toEqual(["live-premigrate-v19-2026-08-04T21-12-04-676Z.db.enc"]);
    expect(listing()).toEqual([
      "live-premigrate-v20-2026-08-05T15-31-12-413Z.db.enc",
      "live-premigrate-v21-2026-08-06T20-27-12-433Z.db.enc",
    ]);
  });

  test("orders by timestamp, not filename — v9 is OLDER than v16", () => {
    // The regression a plain .sort() would cause: lexicographically "v16" sorts
    // before "v9", so the newest snapshot would be the one deleted.
    touch("live-premigrate-v9-2026-06-29T01-36-05-993Z.db");
    touch("live-premigrate-v16-2026-07-30T21-16-12-197Z.db");

    pruneBackupSeries(dir, premigratePattern("live"), 1);

    expect(listing()).toEqual(["live-premigrate-v16-2026-07-30T21-16-12-197Z.db"]);
  });

  test("never touches files outside the pattern", () => {
    touch("live-premigrate-v19-2026-08-04T21-12-04-676Z.db.enc");
    touch("live-premigrate-v21-2026-08-06T20-27-12-433Z.db.enc");
    touch("live-2026-08-10T05-30-00-023Z.db.enc"); // the daily restore point
    touch("live-presync-2026-08-10T05-03-01-212Z.db");

    pruneBackupSeries(dir, premigratePattern("live"), 1);

    expect(listing()).toEqual([
      "live-2026-08-10T05-30-00-023Z.db.enc",
      "live-premigrate-v21-2026-08-06T20-27-12-433Z.db.enc",
      "live-presync-2026-08-10T05-03-01-212Z.db",
    ]);
  });

  test("does nothing when the series is already within the limit", () => {
    touch("live-premigrate-v21-2026-08-06T20-27-12-433Z.db");
    expect(pruneBackupSeries(dir, premigratePattern("live"), 2)).toEqual([]);
    expect(listing()).toHaveLength(1);
  });

  test("keep < 1 is refused — it would delete the whole series", () => {
    touch("live-premigrate-v21-2026-08-06T20-27-12-433Z.db");
    expect(pruneBackupSeries(dir, premigratePattern("live"), 0)).toEqual([]);
    expect(listing()).toHaveLength(1);
  });

  test("a missing directory is survivable, not fatal", () => {
    // Pruning is housekeeping; it runs during a migration and at boot. Throwing
    // here would cost the startup to save some disk.
    expect(() => pruneBackupSeries(path.join(dir, "nope"), /x/, 2)).not.toThrow();
  });
});

describe("pruneOrphanedSidecars", () => {
  // Every retention pattern ends at `\.db(\.enc)?$`, so a `-journal` has never
  // matched anything. On 2026-09-04 production held 550 of them, oldest in July.
  test("removes a journal whose database is gone", () => {
    touch("live-presync-2026-07-29T09-00-01-028Z.db-journal");
    expect(pruneOrphanedSidecars(dir)).toEqual([
      "live-presync-2026-07-29T09-00-01-028Z.db-journal",
    ]);
    expect(listing()).toEqual([]);
  });

  test("keeps a journal that still has its plaintext database", () => {
    touch("live-2026-09-04T05-30-00-017Z.db");
    touch("live-2026-09-04T05-30-00-017Z.db-journal");
    expect(pruneOrphanedSidecars(dir)).toEqual([]);
    expect(listing()).toHaveLength(2);
  });

  test("keeps a journal whose database has since been ENCRYPTED", () => {
    // The parent is `X.db.enc` by the time the sweep runs, but the sidecar is
    // still named after `X.db` — treating that as an orphan would delete a
    // journal belonging to a backup that is very much still retained.
    touch("live-2026-09-04T05-30-00-017Z.db.enc");
    touch("live-2026-09-04T05-30-00-017Z.db-journal");
    expect(pruneOrphanedSidecars(dir)).toEqual([]);
    expect(listing()).toHaveLength(2);
  });

  test("handles -wal and -shm too, and leaves real backups alone", () => {
    touch("live-presync-2026-07-27T17-09-00-158Z.db-wal");
    touch("live-presync-2026-07-27T17-09-00-158Z.db-shm");
    touch("live-2026-09-04T05-30-00-017Z.db.enc");
    expect(pruneOrphanedSidecars(dir).sort()).toEqual([
      "live-presync-2026-07-27T17-09-00-158Z.db-shm",
      "live-presync-2026-07-27T17-09-00-158Z.db-wal",
    ]);
    expect(listing()).toEqual(["live-2026-09-04T05-30-00-017Z.db.enc"]);
  });

  test("never throws on a missing directory", () => {
    expect(pruneOrphanedSidecars(path.join(dir, "nope"))).toEqual([]);
  });
});
