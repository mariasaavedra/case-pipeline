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
 * - synchronous  = NORMAL safe with WAL, far fewer fsyncs than the FULL default.
 * - busy_timeout = 5000   wait up to 5s for a lock instead of throwing SQLITE_BUSY
 *                         (lets the sync process and the API coexist on live.db).
 * - foreign_keys = ON     SQLite enforces FK constraints per-connection; OFF by default.
 * - cache_size   = -32000 32MB page cache for multi-table JOINs (e.g. case-summary).
 * - temp_store   = MEMORY ORDER BY / GROUP BY temporaries stay in RAM, not on disk.
 *
 * WAL/synchronous are skipped for read-only handles (they cannot change the
 * journal mode of a DB they only opened for reading).
 */
export function applyPragmas(db: DatabaseInstance, readonly = false): void {
  if (!readonly) {
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
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
 */
export function openDatabase(dbPath: string, options: { readonly?: boolean } = {}): DatabaseInstance {
  const readonly = options.readonly ?? false;
  const db = new Database(dbPath, { readonly });
  applyPragmas(db, readonly);
  return db;
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
