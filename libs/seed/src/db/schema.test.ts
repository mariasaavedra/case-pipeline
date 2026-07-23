// =============================================================================
// Schema migration tests — v12 → v13 (Emails & Activities unification)
// =============================================================================

import { test, expect, describe } from "vitest";
import Database from "better-sqlite3";
type DatabaseInstance = InstanceType<typeof Database>;
import { initializeSchema, SCHEMA_VERSION } from "./schema";

function columns(db: DatabaseInstance, table: string): string[] {
  return (db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all() as { name: string }[]).map((r) => r.name);
}

describe("fresh schema", () => {
  test("client_updates has the E&A columns and dedup index", () => {
    const db = new Database(":memory:");
    initializeSchema(db);

    const cols = columns(db, "client_updates");
    expect(cols).toEqual(expect.arrayContaining(["monday_timeline_id", "title", "activity_type_name", "content_sig"]));

    const idx = (db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as { name: string }[]).map((r) => r.name);
    expect(idx).toContain("idx_updates_timeline_dedup");
    expect(idx).toContain("idx_updates_content_dedup");

    const version = (db.prepare("SELECT version FROM schema_version").get() as { version: number }).version;
    expect(version).toBe(SCHEMA_VERSION);
  });

  test("initializeSchema is idempotent", () => {
    const db = new Database(":memory:");
    initializeSchema(db);
    expect(() => initializeSchema(db)).not.toThrow();
  });
});

describe("v12 → v13 migration", () => {
  function makeV12Db(): DatabaseInstance {
    const db = new Database(":memory:");
    // Minimal pre-v13 shape: schema_version at 12 + a client_updates without the E&A columns.
    db.exec(`
      CREATE TABLE schema_version (version INTEGER PRIMARY KEY);
      INSERT INTO schema_version (version) VALUES (12);
      CREATE TABLE client_updates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        local_id TEXT,
        profile_local_id TEXT NOT NULL,
        author_name TEXT NOT NULL DEFAULT 'x',
        text_body TEXT NOT NULL DEFAULT '',
        source_type TEXT NOT NULL DEFAULT 'update',
        created_at_source TEXT NOT NULL DEFAULT ''
      );
    `);
    return db;
  }

  test("adds the E&A columns and bumps the version", () => {
    const db = makeV12Db();
    initializeSchema(db);

    const cols = columns(db, "client_updates");
    expect(cols).toEqual(expect.arrayContaining(["monday_timeline_id", "title", "activity_type_name"]));
    expect((db.prepare("SELECT version FROM schema_version").get() as { version: number }).version).toBe(SCHEMA_VERSION);
  });

  test("dedup index is enforced after migration", () => {
    const db = makeV12Db();
    initializeSchema(db);

    const ins = (localId: string) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO client_updates (local_id, profile_local_id, monday_timeline_id, source_type, created_at_source)
           VALUES (?, 'p1', 'tl-1', 'email', '2026-01-01')`
        )
        .run(localId);

    expect(ins("a").changes).toBe(1);
    expect(ins("b").changes).toBe(0); // deduped by (profile, timeline id)
  });

  test("migration does not disturb existing update rows (NULL timeline id)", () => {
    const db = makeV12Db();
    db.prepare(
      "INSERT INTO client_updates (local_id, profile_local_id, source_type, created_at_source) VALUES ('old1','p1','update','2025-01-01')"
    ).run();
    db.prepare(
      "INSERT INTO client_updates (local_id, profile_local_id, source_type, created_at_source) VALUES ('old2','p1','update','2025-01-02')"
    ).run();

    initializeSchema(db);

    // Two update rows with NULL timeline id must coexist (partial index excludes NULLs).
    const count = (db.prepare("SELECT COUNT(*) AS c FROM client_updates").get() as { c: number }).c;
    expect(count).toBe(2);
  });
});

describe("v13 → v14 content-signature dedup", () => {
  // A v13-era client_updates: has the E&A columns but no content_sig and no
  // content index — the state where connected-item duplicates could accumulate.
  function makeV13Db(): DatabaseInstance {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE schema_version (version INTEGER PRIMARY KEY);
      INSERT INTO schema_version (version) VALUES (13);
      CREATE TABLE client_updates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        local_id TEXT,
        monday_timeline_id TEXT,
        profile_local_id TEXT NOT NULL,
        board_item_local_id TEXT,
        author_name TEXT NOT NULL DEFAULT 'x',
        title TEXT,
        text_body TEXT NOT NULL DEFAULT '',
        source_type TEXT NOT NULL DEFAULT 'update',
        activity_type_name TEXT,
        created_at_source TEXT NOT NULL DEFAULT ''
      );
    `);
    return db;
  }

  const insEA = (db: DatabaseInstance, o: { localId: string; profile: string; tlId: string; boardItem?: string | null; author?: string; body?: string; created?: string }) =>
    db
      .prepare(
        `INSERT INTO client_updates (local_id, monday_timeline_id, profile_local_id, board_item_local_id, author_name, text_body, source_type, created_at_source)
         VALUES (?, ?, ?, ?, ?, ?, 'email', ?)`
      )
      .run(o.localId, o.tlId, o.profile, o.boardItem ?? null, o.author ?? "Claire McKeon", o.body ?? "Interview scheduled for Jul 7", o.created ?? "2026-06-20T00:15:57.000Z");

  test("collapses the same event surfaced with different timeline ids", () => {
    const db = makeV13Db();
    // Same event, once via the profile and once via a connected board item —
    // DIFFERENT timeline ids (the exact case the timeline-id index missed).
    insEA(db, { localId: "a", profile: "p1", tlId: "tl-profile", boardItem: null });
    insEA(db, { localId: "b", profile: "p1", tlId: "tl-boarditem", boardItem: "bi-1" });
    // A genuinely different event for the same profile must survive.
    insEA(db, { localId: "c", profile: "p1", tlId: "tl-other", body: "Payment received", created: "2026-06-18T19:30:00.000Z" });

    initializeSchema(db);

    const rows = db.prepare("SELECT local_id FROM client_updates WHERE profile_local_id='p1' ORDER BY id").all() as { local_id: string }[];
    // The duplicate (b) is gone; the earliest surface (a) and the distinct event (c) remain.
    expect(rows.map((r) => r.local_id)).toEqual(["a", "c"]);
    expect((db.prepare("SELECT version FROM schema_version").get() as { version: number }).version).toBe(SCHEMA_VERSION);
  });

  test("keeps the same event for different profiles", () => {
    const db = makeV13Db();
    insEA(db, { localId: "a", profile: "p1", tlId: "tl-1" });
    insEA(db, { localId: "b", profile: "p2", tlId: "tl-2" }); // same content, other profile
    initializeSchema(db);
    expect((db.prepare("SELECT COUNT(*) AS c FROM client_updates").get() as { c: number }).c).toBe(2);
  });

  test("the content index blocks a duplicate insert after migration", () => {
    const db = makeV13Db();
    initializeSchema(db);
    const sig = "2026-06-20T00:15:57.000Z\x1fClaire McKeon\x1fInterview scheduled for Jul 7";
    const ins = (localId: string, tlId: string) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO client_updates (local_id, monday_timeline_id, profile_local_id, author_name, text_body, source_type, content_sig, created_at_source)
           VALUES (?, ?, 'p9', 'Claire McKeon', 'Interview scheduled for Jul 7', 'email', ?, '2026-06-20T00:15:57.000Z')`
        )
        .run(localId, tlId, sig);
    expect(ins("x", "tl-a").changes).toBe(1);
    expect(ins("y", "tl-b").changes).toBe(0); // different timeline id, same content → skipped
  });
});

describe("v14 → v15 stable-identity migration", () => {
  // Minimal pre-v15 shape: the three client tables with the old
  // NOT NULL + ON DELETE CASCADE batch_id, plus seed_batches.
  function makeV14Db(): DatabaseInstance {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    db.exec(`
      CREATE TABLE schema_version (version INTEGER PRIMARY KEY);
      INSERT INTO schema_version (version) VALUES (14);
      CREATE TABLE seed_batches (id INTEGER PRIMARY KEY AUTOINCREMENT, batch_name TEXT NOT NULL);
      INSERT INTO seed_batches (id, batch_name) VALUES (1, 'b1');
      CREATE TABLE profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id INTEGER NOT NULL REFERENCES seed_batches(id) ON DELETE CASCADE,
        local_id TEXT NOT NULL UNIQUE, monday_item_id TEXT, name TEXT NOT NULL,
        email TEXT, phone TEXT, notes TEXT, next_interaction TEXT, priority TEXT,
        group_title TEXT, address TEXT, date_of_birth TEXT, place_of_birth TEXT,
        a_number TEXT, raw_column_values TEXT, sync_status TEXT NOT NULL DEFAULT 'pending',
        sync_error TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), synced_at TEXT
      );
      CREATE TABLE contracts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id INTEGER NOT NULL REFERENCES seed_batches(id) ON DELETE CASCADE,
        local_id TEXT NOT NULL UNIQUE, monday_item_id TEXT, profile_local_id TEXT NOT NULL,
        profile_monday_id TEXT, name TEXT NOT NULL, case_type TEXT, value INTEGER,
        contract_id TEXT, status TEXT, group_title TEXT, raw_column_values TEXT,
        sync_status TEXT NOT NULL DEFAULT 'pending', sync_error TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')), synced_at TEXT
      );
      CREATE TABLE board_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id INTEGER NOT NULL REFERENCES seed_batches(id) ON DELETE CASCADE,
        local_id TEXT NOT NULL UNIQUE, monday_item_id TEXT, board_key TEXT NOT NULL,
        group_title TEXT, name TEXT NOT NULL, status TEXT, next_date TEXT, next_time TEXT,
        attorney TEXT, paralegals TEXT, profile_local_id TEXT, column_values TEXT NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'pending', sync_error TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')), synced_at TEXT
      );
      -- External-content FTS + triggers, exactly as a real v3+ DB carries them,
      -- so the migration's trigger-recreation + FTS-survival path is exercised.
      CREATE VIRTUAL TABLE profiles_fts USING fts5(
        name, email, phone, address, content='profiles', content_rowid='id'
      );
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
      INSERT INTO profiles (batch_id, local_id, monday_item_id, name, synced_at)
        VALUES (1, 'p1', 'M1', 'Ada', '2026-01-01'), (1, 'p2', 'M2', 'Bo', '2026-01-02');
      INSERT INTO board_items (batch_id, local_id, monday_item_id, board_key, name, column_values)
        VALUES (1, 'b1', 'BM1', 'court_cases', 'Case', '{}');
    `);
    return db;
  }

  test("adds identity columns, preserves rows, backfills last_seen_at", () => {
    const db = makeV14Db();
    initializeSchema(db);
    expect((db.prepare("SELECT version FROM schema_version").get() as { version: number }).version).toBe(SCHEMA_VERSION);
    expect(columns(db, "profiles")).toEqual(
      expect.arrayContaining(["updated_at_source", "last_seen_at", "deleted_at"]),
    );
    expect((db.prepare("SELECT COUNT(*) c FROM profiles").get() as { c: number }).c).toBe(2);
    // last_seen_at backfilled from the old synced_at.
    expect((db.prepare("SELECT last_seen_at FROM profiles WHERE local_id='p1'").get() as { last_seen_at: string }).last_seen_at).toBe("2026-01-01");
    // FTS survives the table rebuild (content_rowid=id preserved, triggers recreated).
    const hit = db.prepare("SELECT p.name FROM profiles_fts f JOIN profiles p ON p.id=f.rowid WHERE profiles_fts MATCH 'Ada'").get() as { name: string } | undefined;
    expect(hit?.name).toBe("Ada");
    // And the recreated triggers keep FTS in sync on new inserts.
    db.prepare("INSERT INTO profiles (batch_id, local_id, monday_item_id, name) VALUES (NULL, 'p3', 'M3', 'Zephyr')").run();
    const hit2 = db.prepare("SELECT p.name FROM profiles_fts f JOIN profiles p ON p.id=f.rowid WHERE profiles_fts MATCH 'Zephyr'").get() as { name: string } | undefined;
    expect(hit2?.name).toBe("Zephyr");
  });

  test("batch_id becomes ON DELETE SET NULL — deleting a batch no longer wipes client rows", () => {
    const db = makeV14Db();
    initializeSchema(db);
    db.pragma("foreign_keys = ON");
    db.prepare("DELETE FROM seed_batches WHERE id = 1").run();
    // The footgun is gone: rows survive with a nulled provenance pointer.
    expect((db.prepare("SELECT COUNT(*) c FROM profiles").get() as { c: number }).c).toBe(2);
    expect((db.prepare("SELECT COUNT(*) c FROM profiles WHERE batch_id IS NULL").get() as { c: number }).c).toBe(2);
    expect((db.prepare("SELECT COUNT(*) c FROM board_items WHERE batch_id IS NULL").get() as { c: number }).c).toBe(1);
  });

  test("UNIQUE(monday_item_id) is enforced after migration (multiple NULLs still allowed)", () => {
    const db = makeV14Db();
    initializeSchema(db);
    expect(() =>
      db.prepare("INSERT INTO profiles (batch_id, local_id, monday_item_id, name) VALUES (NULL, 'dup', 'M1', 'X')").run(),
    ).toThrow(/UNIQUE constraint failed/);
    // Two NULL monday_item_ids coexist — seed data (no Monday ids) must still load.
    db.prepare("INSERT INTO profiles (batch_id, local_id, monday_item_id, name) VALUES (NULL, 'n1', NULL, 'X')").run();
    db.prepare("INSERT INTO profiles (batch_id, local_id, monday_item_id, name) VALUES (NULL, 'n2', NULL, 'Y')").run();
    expect((db.prepare("SELECT COUNT(*) c FROM profiles WHERE monday_item_id IS NULL").get() as { c: number }).c).toBe(2);
  });
});
