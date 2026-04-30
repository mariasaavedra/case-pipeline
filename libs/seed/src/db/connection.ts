// =============================================================================
// SQLite Database Connection Manager
// =============================================================================

import Database from "better-sqlite3";

type DatabaseInstance = InstanceType<typeof Database>;

export interface DatabaseOptions {
  path: string;
  readonly?: boolean;
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

  instance = new Database(options.path, {
    readonly: options.readonly ?? false,
  });

  // Enable WAL mode for better concurrent access (only for writable databases)
  if (!options.readonly) {
    instance.exec("PRAGMA journal_mode = WAL");
  }
  // Enable foreign key constraints
  instance.exec("PRAGMA foreign_keys = ON");

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
