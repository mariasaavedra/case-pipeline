// =============================================================================
// SQLite Database Connection Manager
// =============================================================================

import { Database } from "bun:sqlite";

export interface DatabaseOptions {
  path: string;
  readonly?: boolean;
}

let instance: Database | null = null;
let instancePath: string | null = null;

export function initializeDatabase(options: DatabaseOptions): Database {
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

  // Bun's SQLite: use create: true to allow database creation
  instance = new Database(options.path, {
    create: !options.readonly,
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

export function getDatabase(): Database {
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
