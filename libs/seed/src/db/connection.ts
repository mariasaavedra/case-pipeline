// =============================================================================
// SQLite Database Connection Manager
// =============================================================================

import Database from "better-sqlite3";

type DatabaseInstance = InstanceType<typeof Database>;

export interface DatabaseOptions {
  path: string;
  readonly?: boolean;
}

/**
 * Apply the production-hardening pragmas to a connection. These are set
 * per-connection (SQLite does not persist most of them), so every place that
 * opens a database must call this — which is why `openDatabase()` exists.
 *
 * - journal_mode = WAL    readers never block the single writer (sync / write-back).
 * - synchronous  = NORMAL|FULL  see `durable` below.
 * - busy_timeout = 5000   wait up to 5s for a lock instead of throwing SQLITE_BUSY
 *                         (lets the sync process and the API coexist on live.db).
 * - foreign_keys = ON     SQLite enforces FK constraints per-connection; OFF by default.
 * - cache_size   = -32000 32MB page cache for multi-table JOINs (e.g. case-summary).
 * - temp_store   = MEMORY ORDER BY / GROUP BY temporaries stay in RAM, not on disk.
 *
 * `durable` (synchronous=FULL): in WAL mode, synchronous=NORMAL leaves a real
 * corruption window — a power loss or host reset DURING a checkpoint can tear the
 * main database file (a DigitalOcean host failure / live-migration counts as a
 * reset). FULL fsyncs so that window is closed. It costs extra fsyncs, negligible
 * on this low-write workload, and worth it for live.db which is the ONLY copy of
 * real client data. Regenerable databases (seed.db) stay NORMAL for speed.
 *
 * WAL/synchronous are skipped for read-only handles (they cannot change the
 * journal mode of a DB they only opened for reading).
 */
export function applyPragmas(db: DatabaseInstance, readonly = false, durable = false): void {
  if (!readonly) {
    db.pragma("journal_mode = WAL");
    db.pragma(durable ? "synchronous = FULL" : "synchronous = NORMAL");
  }
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  db.pragma("cache_size = -32000");
  db.pragma("temp_store = MEMORY");
}

/**
 * Open a SQLite database with the standard hardening pragmas applied. This is
 * the single entry point every process should use (API, sync, seeder, scripts)
 * so connection settings can never drift between them.
 *
 * Pass `durable: true` for the live production DB (synchronous=FULL). Leave it
 * off for regenerable data (seed) where speed matters more than the last-commit
 * durability.
 */
export function openDatabase(
  dbPath: string,
  options: { readonly?: boolean; durable?: boolean } = {},
): DatabaseInstance {
  const readonly = options.readonly ?? false;
  const db = new Database(dbPath, { readonly });
  applyPragmas(db, readonly, options.durable ?? false);
  return db;
}

/**
 * Page-level integrity check. Returns true when the DB reports "ok".
 *
 * Deliberately `quick_check`, not `integrity_check`: it does the same page and
 * b-tree verification but skips re-deriving every index from its table, which is
 * the expensive half. Every caller is a gate on a hot path — API boot
 * (`apps/api/src/server.ts`), the sync run, `npm run health`, and backup
 * verification — where the job is "is this file readable or torn?", not "is an
 * index subtly stale?". A torn page from a half-checkpointed WAL, which is the
 * failure this guards against, is caught by both.
 *
 * Note this returns false in two ways: `quick_check` yields error rows on a
 * recoverable inconsistency, but THROWS outright on a badly-malformed file
 * (a clobbered page 1 never even parses as a schema) — hence the catch.
 */
export function isDatabaseHealthy(db: DatabaseInstance): boolean {
  return checkIntegrity(db) === "ok";
}

/**
 * What `quick_check` was able to establish.
 *
 *   ok      — verified sound
 *   corrupt — verified damaged, or unreadable in a way only damage explains
 *   busy    — could NOT be established, because something else holds the lock
 *
 * The third state exists because collapsing it into `corrupt` disabled backup
 * retention in production for a week. `pruneBackups` runs inside runBackup's
 * `finally`, moments after `db.backup()`, and a webhook-triggered sync holding
 * a write lock at that instant makes `quick_check` throw SQLITE_BUSY. That was
 * read as "the database is corrupt", which takes the deliberately conservative
 * branch — keep every backup, prune nothing — and it never recovered on its own.
 * By 2026-09-09 the daily series held 9 copies against a BACKUP_KEEP of 4, on a
 * disk at 75%. A full disk is what corrupted this database in July, so treating
 * "I could not check" as "it is broken" ends up causing the very thing the
 * caution was protecting against.
 *
 * A lock says nothing about integrity. Damage and contention are different
 * facts and callers need to tell them apart.
 */
export type IntegrityResult = "ok" | "corrupt" | "busy";

/**
 * SQLite codes that mean "someone else has it", not "it is damaged".
 *
 * The busy/locked family has extended variants that carry their own codes, and
 * every one of them missing from this set used to be reported as corruption.
 * On production that verdict blocked the nightly prune (a corrupt database must
 * never age out the last known-good copy), so twelve 1.5 GB backups piled up
 * where four were configured — while `quick_check` run by hand on the very same
 * file answered "ok".
 */
const LOCK_CODES = new Set([
  "SQLITE_BUSY",
  "SQLITE_BUSY_RECOVERY",
  "SQLITE_BUSY_SNAPSHOT",
  "SQLITE_BUSY_TIMEOUT",
  "SQLITE_LOCKED",
  "SQLITE_LOCKED_SHAREDCACHE",
  "SQLITE_PROTOCOL",
  "SQLITE_INTERRUPT",
]);

export function checkIntegrity(db: DatabaseInstance): IntegrityResult {
  try {
    const rows = db.pragma("quick_check") as Array<{ quick_check: string }>;
    return rows.length === 1 && rows[0]?.quick_check === "ok" ? "ok" : "corrupt";
  } catch (err) {
    // A clobbered page 1 never parses as a schema and throws rather than
    // returning error rows, so an unrecognised throw still means corrupt —
    // that half of the original behaviour is load-bearing and stays.
    const code = (err as { code?: string } | null)?.code;
    if (code && LOCK_CODES.has(code)) return "busy";
    // Name the code on the way out. A "corrupt" verdict from a throw is either
    // real damage or a contention variant this set does not know about yet, and
    // those two need opposite responses — silence made them indistinguishable
    // and cost a fortnight of disk.
    console.warn(
      `[integrity] quick_check threw ${code ?? "an error with no code"}; ` +
        `treating as corrupt. If the database checks out by hand, this code belongs in LOCK_CODES.`,
      err,
    );
    return "corrupt";
  }
}

let instance: DatabaseInstance | null = null;
let instancePath: string | null = null;

export function initializeDatabase(options: DatabaseOptions): DatabaseInstance {
  if (instance) {
    if (options.path !== instancePath) {
      throw new Error(
        `Database already initialized with path "${instancePath}". ` +
        `Refusing to silently ignore new path "${options.path}".`
      );
    }
    return instance;
  }

  instancePath = options.path;
  instance = openDatabase(options.path, { readonly: options.readonly });
  return instance;
}

export function getDatabase(): DatabaseInstance {
  if (!instance) {
    throw new Error("Database not initialized. Call initializeDatabase() first.");
  }
  return instance;
}

export function closeDatabase(): void {
  if (instance) {
    instance.close();
    instance = null;
    instancePath = null;
  }
}
