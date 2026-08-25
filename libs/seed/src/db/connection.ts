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
  try {
    const rows = db.pragma("quick_check") as Array<{ quick_check: string }>;
    return rows.length === 1 && rows[0]?.quick_check === "ok";
  } catch {
    return false;
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
