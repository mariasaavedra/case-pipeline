// =============================================================================
// Database Schema Initialization
// =============================================================================

import type BetterSqlite3 from "better-sqlite3";
type Database = BetterSqlite3.Database;

const SCHEMA_VERSION = 7;

const SCHEMA_SQL = `
-- =============================================================================
-- Seed Data Factory Schema
-- =============================================================================

-- Track generation runs for reproducibility
CREATE TABLE IF NOT EXISTS seed_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_name TEXT NOT NULL,
    seed_value INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    config_hash TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    metadata TEXT
);

-- Profiles with local + Monday.com IDs
CREATE TABLE IF NOT EXISTS profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER NOT NULL REFERENCES seed_batches(id) ON DELETE CASCADE,
    local_id TEXT NOT NULL UNIQUE,
    monday_item_id TEXT,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    notes TEXT,
    next_interaction TEXT,
    priority TEXT,
    group_title TEXT,
    address TEXT,
    date_of_birth TEXT,
    place_of_birth TEXT,
    a_number TEXT,
    raw_column_values TEXT,
    sync_status TEXT NOT NULL DEFAULT 'pending',
    sync_error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    synced_at TEXT
);

-- Contracts linked to profiles
CREATE TABLE IF NOT EXISTS contracts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER NOT NULL REFERENCES seed_batches(id) ON DELETE CASCADE,
    local_id TEXT NOT NULL UNIQUE,
    monday_item_id TEXT,
    profile_local_id TEXT NOT NULL,
    profile_monday_id TEXT,
    name TEXT NOT NULL,
    case_type TEXT,
    value INTEGER,
    contract_id TEXT,
    status TEXT,
    raw_column_values TEXT,
    sync_status TEXT NOT NULL DEFAULT 'pending',
    sync_error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    synced_at TEXT
);

-- Generic items for other boards (RFEs, Court Cases, etc.)
CREATE TABLE IF NOT EXISTS board_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER NOT NULL REFERENCES seed_batches(id) ON DELETE CASCADE,
    local_id TEXT NOT NULL UNIQUE,
    monday_item_id TEXT,
    board_key TEXT NOT NULL,
    group_title TEXT,
    name TEXT NOT NULL,
    status TEXT,
    next_date TEXT,
    attorney TEXT,
    profile_local_id TEXT,
    column_values TEXT NOT NULL,
    sync_status TEXT NOT NULL DEFAULT 'pending',
    sync_error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    synced_at TEXT
);

-- Client updates (case notes, replies) from Monday.com updates
CREATE TABLE IF NOT EXISTS client_updates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER NOT NULL REFERENCES seed_batches(id) ON DELETE CASCADE,
    local_id TEXT NOT NULL UNIQUE,
    monday_update_id TEXT,
    profile_local_id TEXT NOT NULL,
    board_item_local_id TEXT,
    board_key TEXT,
    author_name TEXT NOT NULL,
    author_email TEXT,
    text_body TEXT NOT NULL,
    body_html TEXT,
    source_type TEXT NOT NULL DEFAULT 'update',
    reply_to_update_id TEXT,
    created_at_source TEXT NOT NULL,
    raw_json TEXT,
    sync_status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_updates_profile ON client_updates(profile_local_id);
CREATE INDEX IF NOT EXISTS idx_updates_board_item ON client_updates(board_item_local_id);
CREATE INDEX IF NOT EXISTS idx_updates_created ON client_updates(created_at_source);

-- Relationships between items
CREATE TABLE IF NOT EXISTS item_relationships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER NOT NULL REFERENCES seed_batches(id) ON DELETE CASCADE,
    source_table TEXT NOT NULL,
    source_local_id TEXT NOT NULL,
    target_table TEXT NOT NULL,
    target_local_id TEXT NOT NULL,
    relationship_type TEXT NOT NULL,
    column_key TEXT NOT NULL,
    synced INTEGER NOT NULL DEFAULT 0,
    UNIQUE(source_local_id, target_local_id, relationship_type)
);

-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY
);

-- FTS5 for client search (name, email, phone, address)
CREATE VIRTUAL TABLE IF NOT EXISTS profiles_fts USING fts5(
    name, email, phone, address,
    content='profiles',
    content_rowid='id'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS profiles_ai AFTER INSERT ON profiles BEGIN
    INSERT INTO profiles_fts(rowid, name, email, phone, address)
    VALUES (new.id, new.name, new.email, new.phone, new.address);
END;
CREATE TRIGGER IF NOT EXISTS profiles_ad AFTER DELETE ON profiles BEGIN
    INSERT INTO profiles_fts(profiles_fts, rowid, name, email, phone, address)
    VALUES ('delete', old.id, old.name, old.email, old.phone, old.address);
END;
CREATE TRIGGER IF NOT EXISTS profiles_au AFTER UPDATE ON profiles BEGIN
    INSERT INTO profiles_fts(profiles_fts, rowid, name, email, phone, address)
    VALUES ('delete', old.id, old.name, old.email, old.phone, old.address);
    INSERT INTO profiles_fts(rowid, name, email, phone, address)
    VALUES (new.id, new.name, new.email, new.phone, new.address);
END;

-- Indices for performance
CREATE INDEX IF NOT EXISTS idx_profiles_batch ON profiles(batch_id);
CREATE INDEX IF NOT EXISTS idx_profiles_sync ON profiles(sync_status);
CREATE INDEX IF NOT EXISTS idx_profiles_monday_id ON profiles(monday_item_id);
CREATE INDEX IF NOT EXISTS idx_contracts_batch ON contracts(batch_id);
CREATE INDEX IF NOT EXISTS idx_contracts_profile ON contracts(profile_local_id);
CREATE INDEX IF NOT EXISTS idx_contracts_sync ON contracts(sync_status);
CREATE INDEX IF NOT EXISTS idx_board_items_batch ON board_items(batch_id);
CREATE INDEX IF NOT EXISTS idx_board_items_board ON board_items(board_key);
CREATE INDEX IF NOT EXISTS idx_board_items_status ON board_items(status);
CREATE INDEX IF NOT EXISTS idx_board_items_profile ON board_items(profile_local_id);
CREATE INDEX IF NOT EXISTS idx_board_items_next_date ON board_items(next_date);
CREATE INDEX IF NOT EXISTS idx_board_items_group ON board_items(board_key, group_title);
CREATE INDEX IF NOT EXISTS idx_profiles_group ON profiles(group_title);
CREATE INDEX IF NOT EXISTS idx_relationships_source ON item_relationships(source_local_id);
CREATE INDEX IF NOT EXISTS idx_relationships_target ON item_relationships(target_local_id);
`;

export function initializeSchema(db: Database): void {
  // Check if schema exists
  const versionRow = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'")
    .get();

  if (!versionRow) {
    // Fresh database - create schema
    db.exec(SCHEMA_SQL);
    db.exec(`INSERT INTO schema_version (version) VALUES (${SCHEMA_VERSION})`);
    console.log(`  Database schema initialized (v${SCHEMA_VERSION})`);
    return;
  }

  // Check version for migrations
  const currentVersion = db.prepare("SELECT version FROM schema_version").get() as { version: number } ?? null;

  if (!currentVersion || currentVersion.version < SCHEMA_VERSION) {
    const fromVersion = currentVersion?.version ?? 0;

    // Migration v1 → v2: add group_title to board_items
    if (fromVersion < 2) {
      const hasColumn = db
        .prepare("SELECT COUNT(*) as cnt FROM pragma_table_info('board_items') WHERE name='group_title'")
        .get() as { cnt: number };
      if (!hasColumn || hasColumn.cnt === 0) {
        db.exec("ALTER TABLE board_items ADD COLUMN group_title TEXT");
      }
    }

    // Migration v2 → v3: extracted queryable columns + FTS5
    if (fromVersion < 3) {
      const cols = ["status", "next_date", "attorney", "profile_local_id"];
      for (const col of cols) {
        const has = db
          .prepare(`SELECT COUNT(*) as cnt FROM pragma_table_info('board_items') WHERE name='${col}'`)
          .get() as { cnt: number };
        if (!has || has.cnt === 0) {
          db.exec(`ALTER TABLE board_items ADD COLUMN ${col} TEXT`);
        }
      }

      // Add new indices (IF NOT EXISTS is safe for re-runs)
      db.exec("CREATE INDEX IF NOT EXISTS idx_board_items_status ON board_items(status)");
      db.exec("CREATE INDEX IF NOT EXISTS idx_board_items_profile ON board_items(profile_local_id)");
      db.exec("CREATE INDEX IF NOT EXISTS idx_board_items_next_date ON board_items(next_date)");

      // FTS5 virtual table for client search
      const hasFts = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='profiles_fts'")
        .get();
      if (!hasFts) {
        db.exec(`
          CREATE VIRTUAL TABLE profiles_fts USING fts5(
            name, email, phone,
            content='profiles',
            content_rowid='id'
          );
          -- Populate FTS from existing profiles
          INSERT INTO profiles_fts(rowid, name, email, phone)
            SELECT id, name, email, phone FROM profiles;
          -- Sync triggers
          CREATE TRIGGER IF NOT EXISTS profiles_ai AFTER INSERT ON profiles BEGIN
            INSERT INTO profiles_fts(rowid, name, email, phone)
            VALUES (new.id, new.name, new.email, new.phone);
          END;
          CREATE TRIGGER IF NOT EXISTS profiles_ad AFTER DELETE ON profiles BEGIN
            INSERT INTO profiles_fts(profiles_fts, rowid, name, email, phone)
            VALUES ('delete', old.id, old.name, old.email, old.phone);
          END;
          CREATE TRIGGER IF NOT EXISTS profiles_au AFTER UPDATE ON profiles BEGIN
            INSERT INTO profiles_fts(profiles_fts, rowid, name, email, phone)
            VALUES ('delete', old.id, old.name, old.email, old.phone);
            INSERT INTO profiles_fts(rowid, name, email, phone)
            VALUES (new.id, new.name, new.email, new.phone);
          END;
        `);
      }

      // Backfill extracted columns from existing JSON data
      db.exec(`
        UPDATE board_items
        SET
          status = COALESCE(status, json_extract(column_values, '$.status.label')),
          next_date = COALESCE(next_date,
            json_extract(column_values, '$.x_next_hearing_date.date'),
            json_extract(column_values, '$.next_hearing_date.date'),
            json_extract(column_values, '$.due_date.date')
          ),
          attorney = COALESCE(attorney, json_extract(column_values, '$.attorney.label')),
          profile_local_id = COALESCE(profile_local_id, json_extract(column_values, '$.profiles.value'))
        WHERE status IS NULL
           OR next_date IS NULL
           OR attorney IS NULL
           OR profile_local_id IS NULL
      `);
    }

    // Migration v3 → v4: client_updates table
    if (fromVersion < 4) {
      const hasTable = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='client_updates'")
        .get();
      if (!hasTable) {
        db.exec(`
          CREATE TABLE IF NOT EXISTS client_updates (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              batch_id INTEGER NOT NULL REFERENCES seed_batches(id) ON DELETE CASCADE,
              local_id TEXT NOT NULL UNIQUE,
              monday_update_id TEXT,
              profile_local_id TEXT NOT NULL,
              board_item_local_id TEXT,
              board_key TEXT,
              author_name TEXT NOT NULL,
              author_email TEXT,
              text_body TEXT NOT NULL,
              body_html TEXT,
              source_type TEXT NOT NULL DEFAULT 'update',
              reply_to_update_id TEXT,
              created_at_source TEXT NOT NULL,
              raw_json TEXT,
              sync_status TEXT NOT NULL DEFAULT 'pending',
              created_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          CREATE INDEX IF NOT EXISTS idx_updates_profile ON client_updates(profile_local_id);
          CREATE INDEX IF NOT EXISTS idx_updates_board_item ON client_updates(board_item_local_id);
          CREATE INDEX IF NOT EXISTS idx_updates_created ON client_updates(created_at_source);
        `);
      }
    }

    // Migration v4 → v5: add address to FTS5 index
    if (fromVersion < 5) {
      db.exec(`
        DROP TRIGGER IF EXISTS profiles_ai;
        DROP TRIGGER IF EXISTS profiles_ad;
        DROP TRIGGER IF EXISTS profiles_au;
        DROP TABLE IF EXISTS profiles_fts;

        CREATE VIRTUAL TABLE profiles_fts USING fts5(
          name, email, phone, address,
          content='profiles',
          content_rowid='id'
        );

        INSERT INTO profiles_fts(rowid, name, email, phone, address)
          SELECT id, name, email, phone, address FROM profiles;

        CREATE TRIGGER profiles_ai AFTER INSERT ON profiles BEGIN
          INSERT INTO profiles_fts(rowid, name, email, phone, address)
          VALUES (new.id, new.name, new.email, new.phone, new.address);
        END;
        CREATE TRIGGER profiles_ad AFTER DELETE ON profiles BEGIN
          INSERT INTO profiles_fts(profiles_fts, rowid, name, email, phone, address)
          VALUES ('delete', old.id, old.name, old.email, old.phone, old.address);
        END;
        CREATE TRIGGER profiles_au AFTER UPDATE ON profiles BEGIN
          INSERT INTO profiles_fts(profiles_fts, rowid, name, email, phone, address)
          VALUES ('delete', old.id, old.name, old.email, old.phone, old.address);
          INSERT INTO profiles_fts(rowid, name, email, phone, address)
          VALUES (new.id, new.name, new.email, new.phone, new.address);
        END;
      `);
    }

    // Migration v5 → v6: add group_title to profiles + index on board_items group
    if (fromVersion < 6) {
      const hasColumn = db
        .prepare("SELECT COUNT(*) as cnt FROM pragma_table_info('profiles') WHERE name='group_title'")
        .get() as { cnt: number };
      if (!hasColumn || hasColumn.cnt === 0) {
        db.exec("ALTER TABLE profiles ADD COLUMN group_title TEXT");
      }
      db.exec("CREATE INDEX IF NOT EXISTS idx_board_items_group ON board_items(board_key, group_title)");
      db.exec("CREATE INDEX IF NOT EXISTS idx_profiles_group ON profiles(group_title)");
    }

    // Migration v6 → v7: add date_of_birth, place_of_birth, a_number to profiles
    if (fromVersion < 7) {
      for (const col of ["date_of_birth", "place_of_birth", "a_number"]) {
        const has = db
          .prepare(`SELECT COUNT(*) as cnt FROM pragma_table_info('profiles') WHERE name='${col}'`)
          .get() as { cnt: number };
        if (!has || has.cnt === 0) {
          db.exec(`ALTER TABLE profiles ADD COLUMN ${col} TEXT`);
        }
      }
    }

    db.exec(`UPDATE schema_version SET version = ${SCHEMA_VERSION}`);
    console.log(`  Database schema migrated to v${SCHEMA_VERSION}`);
  }
}

/**
 * Validate that a read-only DB has the expected schema version.
 * Throws if the schema is missing or outdated (requires re-seeding).
 */
export function validateSchema(db: Database): void {
  const versionRow = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'")
    .get();

  if (!versionRow) {
    throw new Error(
      `Database has no schema. Run the seeder first: bun scripts/seed/index.ts`
    );
  }

  const row = db.prepare("SELECT version FROM schema_version").get() as { version: number } ?? null;
  const current = row?.version ?? 0;

  if (current < SCHEMA_VERSION) {
    throw new Error(
      `Database schema is v${current}, expected v${SCHEMA_VERSION}. Re-seed to upgrade: bun scripts/seed/index.ts`
    );
  }
}

export function resetDatabase(db: Database): void {
  db.exec(`
    DROP TABLE IF EXISTS profiles_fts;
    DROP TRIGGER IF EXISTS profiles_ai;
    DROP TRIGGER IF EXISTS profiles_ad;
    DROP TRIGGER IF EXISTS profiles_au;
    DROP TABLE IF EXISTS client_updates;
    DROP TABLE IF EXISTS item_relationships;
    DROP TABLE IF EXISTS board_items;
    DROP TABLE IF EXISTS contracts;
    DROP TABLE IF EXISTS profiles;
    DROP TABLE IF EXISTS seed_batches;
    DROP TABLE IF EXISTS schema_version;
  `);
  initializeSchema(db);
}
