import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "@case-pipeline/seed/db/connection";
import { backupEncryptionKey, encryptFileSync } from "../backup/crypto.js";
import { protect, isEncrypted } from "../crypto/secrets.js";

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
  {
    // Profile & identity fields, plus a one-time re-encryption of any legacy
    // plaintext Monday tokens now that column encryption exists.
    version: 3,
    up: () => {
      const addCol = (col: string, decl: string) => {
        if (!columnExists("users", col)) {
          usersDb.exec(`ALTER TABLE users ADD COLUMN ${col} ${decl}`);
        }
      };
      addCol("job_title", "TEXT");
      addCol("locale", "TEXT DEFAULT 'es'");
      addCol("timezone", "TEXT");
      addCol("active", "INTEGER NOT NULL DEFAULT 1"); // soft-delete flag
      addCol("paralegal_link", "TEXT"); // name as it appears on the boards
      addCol("phone_ext", "TEXT");
      addCol("login_count", "INTEGER NOT NULL DEFAULT 0");
      addCol("last_active_at", "TEXT");

      // Encrypt existing tokens in place. protect() is a no-op passthrough when
      // APP_ENCRYPTION_KEY is unset (tokens then self-heal on next OAuth
      // connect); isEncrypted() guards against double-encrypting on re-runs.
      const rows = usersDb
        .prepare("SELECT id, monday_access_token FROM users WHERE monday_access_token IS NOT NULL")
        .all() as { id: number; monday_access_token: string }[];
      const upd = usersDb.prepare("UPDATE users SET monday_access_token = ? WHERE id = ?");
      for (const r of rows) {
        if (!isEncrypted(r.monday_access_token)) upd.run(protect(r.monday_access_token), r.id);
      }
    },
  },
  {
    // Per-user UI preferences: a single JSON blob (theme, density, default page,
    // dashboard layout, column choices). JSON avoids a migration per new knob.
    version: 4,
    up: () => {
      usersDb.exec(`
        CREATE TABLE IF NOT EXISTS user_preferences (
          user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          prefs_json  TEXT NOT NULL DEFAULT '{}',
          updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
    },
  },
  {
    // Named, reusable filter sets per user (e.g. a saved clients query).
    version: 5,
    up: () => {
      usersDb.exec(`
        CREATE TABLE IF NOT EXISTS user_saved_views (
          id           INTEGER PRIMARY KEY,
          user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name         TEXT NOT NULL,
          kind         TEXT NOT NULL,
          filters_json TEXT NOT NULL DEFAULT '{}',
          created_at   TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      usersDb.exec(`CREATE INDEX IF NOT EXISTS idx_saved_views_user ON user_saved_views(user_id)`);
    },
  },
  {
    // Pinned clients (watchlist), one row per pinned profile per user.
    version: 6,
    up: () => {
      usersDb.exec(`
        CREATE TABLE IF NOT EXISTS user_watchlist (
          id               INTEGER PRIMARY KEY,
          user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          profile_local_id TEXT NOT NULL,
          note             TEXT,
          created_at       TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(user_id, profile_local_id)
        )
      `);
    },
  },
  {
    // Recently viewed clients — upsert viewed_at; caller rotates to keep N latest.
    version: 7,
    up: () => {
      usersDb.exec(`
        CREATE TABLE IF NOT EXISTS recently_viewed (
          id               INTEGER PRIMARY KEY,
          user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          profile_local_id TEXT NOT NULL,
          viewed_at        TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(user_id, profile_local_id)
        )
      `);
      usersDb.exec(
        `CREATE INDEX IF NOT EXISTS idx_recently_user_time ON recently_viewed(user_id, viewed_at DESC)`,
      );
    },
  },
  {
    // Re-key the watchlist and recently-viewed on monday_item_id.
    //
    // profiles.local_id is a PER-SYNC surrogate: the nightly sync does a full
    // replace (resetDatabase → DROP TABLE profiles) and re-inserts every profile
    // with a fresh randomUUID(). users.db survives that, so every stored
    // local_id dangled the next morning — names stopped resolving and the links
    // 404'd. monday_item_id is the stable identity (resetDatabase's own comment
    // says as much about the write queue).
    //
    // The existing rows point at local_ids that no longer map to anything, so
    // they can't be back-filled — drop them and let users re-pin.
    version: 8,
    up: () => {
      usersDb.exec(`
        CREATE TABLE IF NOT EXISTS audit_log (
          id            INTEGER PRIMARY KEY,
          actor_user_id INTEGER,
          actor_email   TEXT,
          action        TEXT NOT NULL,
          target_type   TEXT,
          target_id     TEXT,
          metadata_json TEXT,
          created_at    TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      usersDb.exec(`CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC)`);
    },
  },
  {
    // Re-key the watchlist and recently-viewed on monday_item_id.
    //
    // profiles.local_id is a PER-SYNC surrogate: the nightly sync does a full
    // replace (resetDatabase → DROP TABLE profiles) and re-inserts every profile
    // with a fresh randomUUID(). users.db survives that, so every stored
    // local_id dangled the next morning — names stopped resolving and the links
    // 404'd. monday_item_id is the stable identity (resetDatabase's own comment
    // says as much about the write queue).
    //
    // The existing rows point at local_ids that no longer map to anything, so
    // they can't be back-filled — drop them and let users re-pin.
    version: 9,
    up: () => {
      usersDb.exec(`DROP TABLE IF EXISTS user_watchlist`);
      usersDb.exec(`DROP TABLE IF EXISTS recently_viewed`);
      usersDb.exec(`
        CREATE TABLE user_watchlist (
          id             INTEGER PRIMARY KEY,
          user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          monday_item_id TEXT NOT NULL,
          note           TEXT,
          created_at     TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(user_id, monday_item_id)
        )
      `);
      usersDb.exec(`
        CREATE TABLE recently_viewed (
          id             INTEGER PRIMARY KEY,
          user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          monday_item_id TEXT NOT NULL,
          viewed_at      TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(user_id, monday_item_id)
        )
      `);
      usersDb.exec(
        `CREATE INDEX IF NOT EXISTS idx_recently_user_time ON recently_viewed(user_id, viewed_at DESC)`,
      );
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
  // v3 — profile & identity
  job_title: string | null;
  locale: string | null;
  timezone: string | null;
  active: number; // 1 = active, 0 = disabled (soft-delete)
  paralegal_link: string | null;
  phone_ext: string | null;
  login_count: number;
  last_active_at: string | null;
}
