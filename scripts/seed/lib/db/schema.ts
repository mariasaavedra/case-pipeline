// =============================================================================
// Database Schema Initialization
// =============================================================================

import type { Database } from "bun:sqlite";

const SCHEMA_VERSION = 2;

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
    address TEXT,
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
    column_values TEXT NOT NULL,
    sync_status TEXT NOT NULL DEFAULT 'pending',
    sync_error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    synced_at TEXT
);

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

-- Indices for performance
CREATE INDEX IF NOT EXISTS idx_profiles_batch ON profiles(batch_id);
CREATE INDEX IF NOT EXISTS idx_profiles_sync ON profiles(sync_status);
CREATE INDEX IF NOT EXISTS idx_profiles_monday_id ON profiles(monday_item_id);
CREATE INDEX IF NOT EXISTS idx_contracts_batch ON contracts(batch_id);
CREATE INDEX IF NOT EXISTS idx_contracts_profile ON contracts(profile_local_id);
CREATE INDEX IF NOT EXISTS idx_contracts_sync ON contracts(sync_status);
CREATE INDEX IF NOT EXISTS idx_board_items_batch ON board_items(batch_id);
CREATE INDEX IF NOT EXISTS idx_board_items_board ON board_items(board_key);
CREATE INDEX IF NOT EXISTS idx_relationships_source ON item_relationships(source_local_id);
CREATE INDEX IF NOT EXISTS idx_relationships_target ON item_relationships(target_local_id);
`;

export function initializeSchema(db: Database): void {
  // Check if schema exists
  const versionRow = db
    .query("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'")
    .get();

  if (!versionRow) {
    // Fresh database - create schema
    db.exec(SCHEMA_SQL);
    db.exec(`INSERT INTO schema_version (version) VALUES (${SCHEMA_VERSION})`);
    console.log(`  Database schema initialized (v${SCHEMA_VERSION})`);
    return;
  }

  // Check version for migrations
  const currentVersion = db.query("SELECT version FROM schema_version").get() as { version: number } | null;

  if (!currentVersion || currentVersion.version < SCHEMA_VERSION) {
    const fromVersion = currentVersion?.version ?? 0;

    // Migration v1 → v2: add group_title to board_items
    if (fromVersion < 2) {
      const hasColumn = db
        .query("SELECT COUNT(*) as cnt FROM pragma_table_info('board_items') WHERE name='group_title'")
        .get() as { cnt: number };
      if (!hasColumn || hasColumn.cnt === 0) {
        db.exec("ALTER TABLE board_items ADD COLUMN group_title TEXT");
      }
    }

    db.exec(`UPDATE schema_version SET version = ${SCHEMA_VERSION}`);
    console.log(`  Database schema migrated to v${SCHEMA_VERSION}`);
  }
}

export function resetDatabase(db: Database): void {
  db.exec(`
    DROP TABLE IF EXISTS item_relationships;
    DROP TABLE IF EXISTS board_items;
    DROP TABLE IF EXISTS contracts;
    DROP TABLE IF EXISTS profiles;
    DROP TABLE IF EXISTS seed_batches;
    DROP TABLE IF EXISTS schema_version;
  `);
  initializeSchema(db);
}
