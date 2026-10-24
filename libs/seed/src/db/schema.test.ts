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

describe("v16 → v17 update/reply dedup migration", () => {
  // A v16-era client_updates with monday_update_id but no update-dedup index —
  // the state where the non-destructive sync's plain INSERT re-inserted every
  // update/reply on each full run, accumulating duplicate copies.
  function makeV16Db(): DatabaseInstance {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE schema_version (version INTEGER PRIMARY KEY);
      INSERT INTO schema_version (version) VALUES (16);
      CREATE TABLE client_updates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        local_id TEXT,
        monday_update_id TEXT,
        monday_timeline_id TEXT,
        profile_local_id TEXT NOT NULL,
        board_item_local_id TEXT,
        author_name TEXT NOT NULL DEFAULT 'x',
        title TEXT,
        text_body TEXT NOT NULL DEFAULT '',
        source_type TEXT NOT NULL DEFAULT 'update',
        content_sig TEXT,
        created_at_source TEXT NOT NULL DEFAULT ''
      );
    `);
    return db;
  }
  const insUpd = (db: DatabaseInstance, o: { localId: string; profile: string; updateId: string; type?: string }) =>
    db
      .prepare(
        `INSERT INTO client_updates (local_id, monday_update_id, profile_local_id, source_type, created_at_source)
         VALUES (?, ?, ?, ?, '2026-06-20T00:00:00Z')`
      )
      .run(o.localId, o.updateId, o.profile, o.type ?? "update");

  test("collapses duplicate updates to the earliest, keeps distinct ones", () => {
    const db = makeV16Db();
    // Same update inserted 4× (four full syncs) under p1.
    insUpd(db, { localId: "a1", profile: "p1", updateId: "u1" });
    insUpd(db, { localId: "a2", profile: "p1", updateId: "u1" });
    insUpd(db, { localId: "a3", profile: "p1", updateId: "u1" });
    insUpd(db, { localId: "a4", profile: "p1", updateId: "u1" });
    // A distinct reply, and the same update id under a different profile.
    insUpd(db, { localId: "r1", profile: "p1", updateId: "u2", type: "reply" });
    insUpd(db, { localId: "b1", profile: "p2", updateId: "u1" });

    initializeSchema(db);

    const p1 = db.prepare("SELECT local_id FROM client_updates WHERE profile_local_id='p1' ORDER BY id").all() as { local_id: string }[];
    expect(p1.map((r) => r.local_id)).toEqual(["a1", "r1"]); // earliest copy of u1 + the distinct reply
    expect((db.prepare("SELECT COUNT(*) AS c FROM client_updates WHERE profile_local_id='p2'").get() as { c: number }).c).toBe(1);
    expect((db.prepare("SELECT version FROM schema_version").get() as { version: number }).version).toBe(SCHEMA_VERSION);
  });

  test("the update-dedup index blocks a re-insert of the same update", () => {
    const db = makeV16Db();
    initializeSchema(db);
    const ins = (localId: string) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO client_updates (local_id, monday_update_id, profile_local_id, source_type, created_at_source)
           VALUES (?, 'u9', 'p9', 'update', '2026-06-20T00:00:00Z')`
        )
        .run(localId);
    expect(ins("x").changes).toBe(1);
    expect(ins("y").changes).toBe(0); // same profile + monday_update_id → skipped
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

describe("v22 → v23 sync_runs failure reason", () => {
  // A v22-era ledger: sync_runs with no `error` column, which is the state in
  // which a crashed run left its row at 'running' forever with no explanation.
  function makeV22Db(): DatabaseInstance {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE schema_version (version INTEGER PRIMARY KEY);
      INSERT INTO schema_version (version) VALUES (22);
      CREATE TABLE sync_runs (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at  TEXT NOT NULL,
        finished_at TEXT,
        mode        TEXT NOT NULL,
        status      TEXT NOT NULL DEFAULT 'running'
      );
    `);
    return db;
  }
  const insRun = (db: DatabaseInstance, startedAt: string, status: string, finishedAt: string | null = null) =>
    db
      .prepare("INSERT INTO sync_runs (started_at, finished_at, mode, status) VALUES (?, ?, 'full', ?)")
      .run(startedAt, finishedAt, status);

  const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000).toISOString();

  test("adds the error column and bumps the version", () => {
    const db = makeV22Db();
    initializeSchema(db);
    const cols = db.prepare("SELECT name FROM pragma_table_info('sync_runs')").all() as { name: string }[];
    expect(cols.map((c) => c.name)).toContain("error");
    expect((db.prepare("SELECT version FROM schema_version").get() as { version: number }).version).toBe(SCHEMA_VERSION);
  });

  test("marks a long-dead 'running' row abandoned, with a reason", () => {
    const db = makeV22Db();
    insRun(db, daysAgo(21), "running"); // the process died three weeks ago
    initializeSchema(db);
    const row = db.prepare("SELECT status, error FROM sync_runs").get() as { status: string; error: string | null };
    expect(row.status).toBe("abandoned");
    expect(row.error).toMatch(/abandoned/i);
  });

  test("leaves a recent 'running' row alone — it may still be syncing", () => {
    const db = makeV22Db();
    insRun(db, new Date().toISOString(), "running");
    initializeSchema(db);
    const row = db.prepare("SELECT status, error FROM sync_runs").get() as { status: string; error: string | null };
    expect(row.status).toBe("running");
    expect(row.error).toBeNull();
  });

  test("does not touch runs that already reported a result", () => {
    const db = makeV22Db();
    insRun(db, daysAgo(30), "synced", daysAgo(30));
    insRun(db, daysAgo(30), "partial", daysAgo(30));
    initializeSchema(db);
    const statuses = (db.prepare("SELECT status FROM sync_runs ORDER BY id").all() as { status: string }[]).map((r) => r.status);
    expect(statuses).toEqual(["synced", "partial"]);
  });
});

describe("v23 → v24 mail intake tables", () => {
  test("a v23 database gains empty mail tables and keeps its data", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE schema_version (version INTEGER PRIMARY KEY);
      INSERT INTO schema_version (version) VALUES (23);
      CREATE TABLE profiles (id INTEGER PRIMARY KEY, local_id TEXT, name TEXT);
      INSERT INTO profiles (local_id, name) VALUES ('p1', 'Kept');
    `);
    initializeSchema(db);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(
      (t) => t.name,
    );
    expect(tables).toEqual(expect.arrayContaining(["mail_scans", "mail_documents"]));
    expect(db.prepare("SELECT COUNT(*) c FROM mail_documents").get()).toEqual({ c: 0 });
    expect(db.prepare("SELECT name FROM profiles").get()).toEqual({ name: "Kept" });
    expect((db.prepare("SELECT version FROM schema_version").get() as { version: number }).version).toBe(SCHEMA_VERSION);
  });

  test("deleting a scan removes its documents", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    initializeSchema(db);
    db.prepare("INSERT INTO mail_scans (file_name, total_pages) VALUES ('a.pdf', 1)").run();
    db.prepare(
      `INSERT INTO mail_documents (scan_id, pages, split_reason, fields, match, status, message)
       VALUES (1, '[1]', 'first_page', '{}', '{}', 'no_match', 'x')`,
    ).run();
    db.prepare("DELETE FROM mail_scans WHERE id = 1").run();
    expect(db.prepare("SELECT COUNT(*) c FROM mail_documents").get()).toEqual({ c: 0 });
  });
});

describe("v24 → v25 mail write-back tracking", () => {
  test("adds the write-back columns to an existing mail_documents, keeping rows", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE schema_version (version INTEGER PRIMARY KEY);
      INSERT INTO schema_version (version) VALUES (24);
      CREATE TABLE mail_documents (id INTEGER PRIMARY KEY, message TEXT);
      INSERT INTO mail_documents (message) VALUES ('kept');
    `);
    initializeSchema(db);
    const cols = (db.prepare("SELECT name FROM pragma_table_info('mail_documents')").all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(cols).toEqual(expect.arrayContaining(["writeback_state", "writeback_steps", "writeback_error", "writeback_at"]));
    expect(db.prepare("SELECT message, writeback_state FROM mail_documents").get()).toEqual({
      message: "kept",
      writeback_state: "none",
    });
  });
});

describe("v25 → v26 mail field corrections", () => {
  test("adds the correction columns, keeping rows", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE schema_version (version INTEGER PRIMARY KEY);
      INSERT INTO schema_version (version) VALUES (25);
      CREATE TABLE mail_documents (id INTEGER PRIMARY KEY, fields TEXT);
      INSERT INTO mail_documents (fields) VALUES ('{}');
    `);
    initializeSchema(db);
    const cols = (db.prepare("SELECT name FROM pragma_table_info('mail_documents')").all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(["original_fields", "fields_edited_by", "fields_edited_by_name", "fields_edited_at"]));
    expect(db.prepare("SELECT fields, original_fields FROM mail_documents").get()).toEqual({ fields: "{}", original_fields: null });
  });
});

describe("v26 → v27 email participants", () => {
  // Production is at v26 (mail field corrections) when this ships.
  test("adds email_participants to an existing client_updates, keeping rows", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE schema_version (version INTEGER PRIMARY KEY);
      INSERT INTO schema_version (version) VALUES (26);
      CREATE TABLE client_updates (id INTEGER PRIMARY KEY, local_id TEXT, text_body TEXT);
      INSERT INTO client_updates (local_id, text_body) VALUES ('u1', 'kept');
    `);
    initializeSchema(db);
    expect(db.prepare("SELECT local_id, text_body, email_participants FROM client_updates").get()).toEqual({
      local_id: "u1",
      text_body: "kept",
      email_participants: null,
    });
    expect((db.prepare("SELECT version FROM schema_version").get() as { version: number }).version).toBe(SCHEMA_VERSION);
  });

  test("is a no-op when the column already exists", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE schema_version (version INTEGER PRIMARY KEY);
      INSERT INTO schema_version (version) VALUES (26);
      CREATE TABLE client_updates (id INTEGER PRIMARY KEY, email_participants TEXT);
    `);
    expect(() => initializeSchema(db)).not.toThrow();
  });
});

describe("v27 → v28 SharePoint folder index", () => {
  test("creates sp_folders on an existing database", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE schema_version (version INTEGER PRIMARY KEY);
      INSERT INTO schema_version (version) VALUES (27);
    `);
    initializeSchema(db);
    const cols = (db.prepare("SELECT name FROM pragma_table_info('sp_folders')").all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(["item_id", "site", "path", "web_url", "case_no", "year", "missing_since"]));
    expect((db.prepare("SELECT version FROM schema_version").get() as { version: number }).version).toBe(SCHEMA_VERSION);
  });

  test("a fresh database has it too", () => {
    const db = new Database(":memory:");
    initializeSchema(db);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'sp_folders'").get()).toBeTruthy();
  });
});

describe("v28 → v29 consult preps", () => {
  test("creates consult_preps on an existing database", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE schema_version (version INTEGER PRIMARY KEY);
      INSERT INTO schema_version (version) VALUES (28);
    `);
    initializeSchema(db);
    const cols = (db.prepare("SELECT name FROM pragma_table_info('consult_preps')").all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(["appointment_local_id", "appt_type", "method", "fields", "note_text", "pending"]));
    expect((db.prepare("SELECT version FROM schema_version").get() as { version: number }).version).toBe(SCHEMA_VERSION);
  });

  test("a fresh database has it too", () => {
    const db = new Database(":memory:");
    initializeSchema(db);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'consult_preps'").get()).toBeTruthy();
  });
});

describe("v31 → v32 consult fee quotes", () => {
  test("creates consult_fee_quotes on an existing database", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE schema_version (version INTEGER PRIMARY KEY);
      INSERT INTO schema_version (version) VALUES (31);
    `);
    initializeSchema(db);
    const cols = (db.prepare("SELECT name FROM pragma_table_info('consult_fee_quotes')").all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining([
      "appointment_monday_id", "profile_monday_id", "case_type", "new_case_type", "af", "ff", "pf", "fee_k_monday_id", "applied_at", "applied_note",
    ]));
    expect((db.prepare("SELECT version FROM schema_version").get() as { version: number }).version).toBe(SCHEMA_VERSION);
  });

  test("a fresh database has it too", () => {
    const db = new Database(":memory:");
    initializeSchema(db);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'consult_fee_quotes'").get()).toBeTruthy();
  });
});

describe("v34 → v35 item activity log", () => {
  test("creates item_events + its cursor on an existing database", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE schema_version (version INTEGER PRIMARY KEY);
      INSERT INTO schema_version (version) VALUES (34);
    `);
    initializeSchema(db);
    expect(columns(db, "item_events")).toEqual(expect.arrayContaining([
      "webhook_event_id", "trigger_uuid", "monday_item_id", "column_id", "value_text", "previous_text", "monday_user_id", "changed_at",
    ]));
    expect(columns(db, "item_events_cursor")).toEqual(["id", "last_webhook_event_id"]);
    expect((db.prepare("SELECT version FROM schema_version").get() as { version: number }).version).toBe(SCHEMA_VERSION);
  });

  test("a fresh database has it too", () => {
    const db = new Database(":memory:");
    initializeSchema(db);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'item_events'").get()).toBeTruthy();
  });
});

describe("v35 → v36 item activity log takes Monday history", () => {
  // A v35 item_events, exactly as production has it, with one webhook row.
  function makeV35Db(): DatabaseInstance {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE schema_version (version INTEGER PRIMARY KEY);
      INSERT INTO schema_version (version) VALUES (35);
      CREATE TABLE item_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT, webhook_event_id INTEGER NOT NULL UNIQUE, trigger_uuid TEXT,
          event_type TEXT NOT NULL, monday_board_id TEXT, board_key TEXT, monday_item_id TEXT, item_name TEXT,
          column_id TEXT, column_title TEXT, column_type TEXT, value_text TEXT, previous_text TEXT,
          value_json TEXT, previous_json TEXT, monday_user_id TEXT, changed_at TEXT NOT NULL,
          recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE UNIQUE INDEX idx_item_events_trigger ON item_events(trigger_uuid) WHERE trigger_uuid IS NOT NULL;
      INSERT INTO item_events (id, webhook_event_id, trigger_uuid, event_type, monday_item_id, value_text, previous_text, changed_at, recorded_at)
        VALUES (7, 4242, 't1', 'update_column_value', '555', 'ATTENDED', 'Added on Cal', '2026-10-17T14:31:30.085Z', '2026-10-19 14:16:00');
    `);
    return db;
  }

  test("keeps every webhook row (ids included) and marks it source = webhook", () => {
    const db = makeV35Db();
    initializeSchema(db);
    expect(db.prepare("SELECT id, source, webhook_event_id, activity_log_id, trigger_uuid, value_text, previous_text, recorded_at FROM item_events").all()).toEqual([
      { id: 7, source: "webhook", webhook_event_id: 4242, activity_log_id: null, trigger_uuid: "t1", value_text: "ATTENDED", previous_text: "Added on Cal", recorded_at: "2026-10-19 14:16:00" },
    ]);
    expect((db.prepare("SELECT version FROM schema_version").get() as { version: number }).version).toBe(SCHEMA_VERSION);
  });

  test("history rows need no webhook event; each activity log entry is stored once; the indexes are back", () => {
    const db = makeV35Db();
    initializeSchema(db);
    const ins = db.prepare(
      "INSERT OR IGNORE INTO item_events (source, activity_log_id, event_type, changed_at) VALUES ('activity_log', ?, 'update_name', '2025-01-01T00:00:00Z')",
    );
    expect(ins.run("log-1").changes).toBe(1);
    expect(ins.run("log-1").changes).toBe(0);
    const idx = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'item_events'").all() as { name: string }[]).map((r) => r.name);
    expect(idx).toEqual(expect.arrayContaining(["idx_item_events_trigger", "idx_item_events_item", "idx_item_events_board"]));
  });
});

describe("v36 → v37 client upload links", () => {
  test("a v36 database gets both tables; one file per link once", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE schema_version (version INTEGER PRIMARY KEY);
      INSERT INTO schema_version (version) VALUES (36);
    `);
    initializeSchema(db);
    expect((db.prepare("SELECT version FROM schema_version").get() as { version: number }).version).toBe(SCHEMA_VERSION);
    const link = db.prepare(
      "INSERT INTO upload_links (profile_local_id, token_hash, language, expires_at) VALUES ('p1', 'h1', 'es', '2030-01-01 00:00:00')",
    ).run().lastInsertRowid;
    const ins = db.prepare(
      "INSERT OR IGNORE INTO client_uploads (link_id, original_name, stored_name, size, content_type, sha256, kind) VALUES (?, 'a.pdf', 'a.pdf', 1, 'application/pdf', 's1', 'other')",
    );
    expect(ins.run(link).changes).toBe(1);
    expect(ins.run(link).changes).toBe(0);
  });

  test("a fresh database has them too", () => {
    const db = new Database(":memory:");
    initializeSchema(db);
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(["upload_links", "client_uploads"]));
  });
});

describe("v38 → v39 Buzón checklist", () => {
  test("a v38 database gets the checklist table and client_uploads.item_id, keeping its uploads", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE schema_version (version INTEGER PRIMARY KEY);
      INSERT INTO schema_version (version) VALUES (36);
    `);
    initializeSchema(db);
    db.exec("UPDATE schema_version SET version = 38");
    db.exec("ALTER TABLE client_uploads DROP COLUMN item_id");
    const link = db.prepare(
      "INSERT INTO upload_links (profile_local_id, token_hash, language, expires_at) VALUES ('p1', 'h1', 'es', '2030-01-01 00:00:00')",
    ).run().lastInsertRowid;
    db.prepare(
      "INSERT INTO client_uploads (link_id, original_name, stored_name, size, content_type, sha256, kind) VALUES (?, 'a.pdf', 'a.pdf', 1, 'application/pdf', 's1', 'other')",
    ).run(link);
    initializeSchema(db);
    expect((db.prepare("SELECT version FROM schema_version").get() as { version: number }).version).toBe(SCHEMA_VERSION);
    expect(db.prepare("SELECT item_id FROM client_uploads").get()).toEqual({ item_id: null });
    const item = db.prepare(
      "INSERT INTO upload_checklist_items (profile_local_id, label_en, label_es) VALUES ('p1', 'Passport', 'Pasaporte')",
    ).run().lastInsertRowid;
    expect(db.prepare("SELECT status, required FROM upload_checklist_items WHERE id = ?").get(item)).toEqual({ status: "missing", required: 1 });
  });

  test("a checklist table from an earlier v39 build gets the consult columns and the Buzón tables", () => {
    const db = new Database(":memory:");
    initializeSchema(db);
    db.exec(`
      DROP INDEX idx_upload_checklist_appointment;
      ALTER TABLE upload_checklist_items DROP COLUMN appointment_monday_id;
      ALTER TABLE upload_checklist_items DROP COLUMN consult_list;
      DROP TABLE buzon_texts;
      UPDATE schema_version SET version = 38;
    `);
    initializeSchema(db);
    const cols = (db.prepare("SELECT name FROM pragma_table_info('upload_checklist_items')").all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(["appointment_monday_id", "consult_list"]));
    expect(db.prepare("SELECT COUNT(*) AS n FROM buzon_texts").get()).toEqual({ n: 0 });
  });
});
