import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "@case-pipeline/seed/db/connection";
import { backupEncryptionKey, encryptFileSync } from "../backup/crypto.js";

const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const USERS_DB_PATH = path.join(DATA_DIR, "users.db");
const usersDb = openDatabase(USERS_DB_PATH);

// =============================================================================
// Versioned schema for users.db
// -----------------------------------------------------------------------------
// This DB holds roles, permissions, and Monday.com tokens — small but critical,
// and the home of the planned user-customization system. It gets the same
// safety guarantees as live.db: an ordered, versioned migration chain and a
// VACUUM INTO snapshot before any structural change, so a schema edit to real
// user data is never a one-way door.
//
// Versioning uses SQLite's built-in `PRAGMA user_version` (independent of
// live.db's schema-version table). Migrations are idempotent so they apply
// cleanly to a pre-existing DB created before this framework (user_version 0
// but already carrying the columns below).
// =============================================================================

interface Migration {
  version: number;
  up: () => void;
}

function tableExists(name: string): boolean {
  return !!usersDb
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name);
}

function columnExists(table: string, col: string): boolean {
  const rows = usersDb.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return rows.some((r) => r.name === col);
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    up: () => {
      usersDb.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id          INTEGER PRIMARY KEY,
          azure_oid   TEXT UNIQUE NOT NULL,
          email       TEXT NOT NULL,
          name        TEXT NOT NULL,
          role        TEXT NOT NULL DEFAULT 'user',
          created_at  TEXT NOT NULL DEFAULT (datetime('now')),
          last_login  TEXT
        )
      `);
    },
  },
  {
    version: 2,
    up: () => {
      if (!columnExists("users", "monday_access_token")) {
        usersDb.exec(`ALTER TABLE users ADD COLUMN monday_access_token TEXT`);
      }
      if (!columnExists("users", "monday_name")) {
        usersDb.exec(`ALTER TABLE users ADD COLUMN monday_name TEXT`);
      }
    },
  },
];

const TARGET_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;

function backupBeforeMigrate(fromVersion: number): void {
  const backupDir = path.join(DATA_DIR, "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.join(backupDir, `users-premigrate-v${fromVersion}-${stamp}.db`);
  // VACUUM INTO is a synchronous, consistent snapshot — safe on the live handle.
  usersDb.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  // users.db is tiny (KBs); encrypt in-memory synchronously if a key is set so
  // the snapshot never sits on disk with plaintext Monday tokens.
  const key = backupEncryptionKey();
  const final = key ? encryptFileSync(dest, key) : dest;
  console.log(`[users-db] Backed up users.db (v${fromVersion}) → ${final}`);
}

function migrate(): void {
  const current = usersDb.pragma("user_version", { simple: true }) as number;
  if (current >= TARGET_VERSION) return;

  // Snapshot first when an existing users table holds real roles/tokens.
  if (tableExists("users")) backupBeforeMigrate(current);

  const run = usersDb.transaction(() => {
    for (const m of MIGRATIONS) {
      if (m.version > current) m.up();
    }
    usersDb.pragma(`user_version = ${TARGET_VERSION}`);
  });
  run();

  console.log(`[users-db] Migrated users.db v${current} → v${TARGET_VERSION}`);
}

migrate();

export { usersDb };

export interface UserRow {
  id: number;
  azure_oid: string;
  email: string;
  name: string;
  role: "admin" | "user";
  created_at: string;
  last_login: string | null;
  monday_access_token: string | null;
  monday_name: string | null;
}
