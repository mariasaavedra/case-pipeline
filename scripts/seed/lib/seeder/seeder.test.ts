// =============================================================================
// Seeder Integration Tests
// =============================================================================
// Validates relationship integrity, extracted columns, FTS, and data quality.

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initializeSchema } from "../db/schema";
import { BoardItemFactory } from "../factory/board-item-factory";
import { UpdateFactory } from "../factory/update-factory";
import { setFakerSeed, faker } from "../factory/column-generators";
import type { BoardConfig } from "../../../../lib/config/types";

// =============================================================================
// Helpers
// =============================================================================

const STUB_BOARD_CONFIG: BoardConfig = {
  id: "test-board-123",
  name: "Test Board",
  columns: {
    notes: { resolve: "by_type" as const, type: "text" },
  },
};

function createTestDb(): Database {
  const db = new Database(":memory:");
  initializeSchema(db);
  db.prepare(
    "INSERT INTO seed_batches (id, batch_name, status) VALUES (1, 'test', 'generating')"
  ).run();
  return db;
}

// =============================================================================
// Relationship Integrity
// =============================================================================

describe("Seeder relationship integrity", () => {
  let db: Database;
  let factory: BoardItemFactory;

  beforeEach(() => {
    setFakerSeed(42);
    db = createTestDb();
    factory = new BoardItemFactory(db);
  });

  afterEach(() => {
    db.close();
  });

  test("direct-from-profile items use actual item localId in relationships", () => {
    const item = factory.create({
      batchId: 1,
      boardKey: "address_changes",
      boardConfig: STUB_BOARD_CONFIG,
      name: "Test Address Change",
      overrides: {},
    });

    const profileLocalId = faker.string.uuid();

    factory.createRelationship(1, {
      sourceTable: "board_items",
      sourceLocalId: item.localId,
      targetTable: "profiles",
      targetLocalId: profileLocalId,
      relationshipType: "profile",
      columnKey: "profiles",
    });

    const rel = db
      .prepare("SELECT source_local_id FROM item_relationships WHERE batch_id = 1")
      .get() as { source_local_id: string };

    const boardItem = db
      .prepare("SELECT local_id FROM board_items WHERE batch_id = 1")
      .get() as { local_id: string };

    expect(rel.source_local_id).toBe(boardItem.local_id);
    expect(rel.source_local_id).toBe(item.localId);
  });

  test("all relationships reference existing board_items or profiles", () => {
    const profileLocalId = "profile-001";

    db.prepare(
      "INSERT INTO profiles (batch_id, local_id, name) VALUES (1, ?, 'Test Person')"
    ).run(profileLocalId);

    for (const boardKey of ["address_changes", "_na_originals_cards_notices", "rfes_all"]) {
      const item = factory.create({
        batchId: 1,
        boardKey,
        boardConfig: STUB_BOARD_CONFIG,
        name: `Test ${boardKey}`,
        overrides: {},
      });

      factory.createRelationship(1, {
        sourceTable: "board_items",
        sourceLocalId: item.localId,
        targetTable: "profiles",
        targetLocalId: profileLocalId,
        relationshipType: "profile",
        columnKey: "profiles",
      });
    }

    const orphans = db
      .prepare(`
        SELECT r.source_local_id
        FROM item_relationships r
        WHERE r.source_table = 'board_items'
          AND r.source_local_id NOT IN (SELECT local_id FROM board_items)
      `)
      .all();

    expect(orphans).toHaveLength(0);
  });

  test("factory.create returns item with valid localId", () => {
    const item = factory.create({
      batchId: 1,
      boardKey: "court_cases",
      boardConfig: STUB_BOARD_CONFIG,
      name: "Test Court Case",
      overrides: {},
    });

    expect(item.localId).toBeDefined();
    expect(typeof item.localId).toBe("string");
    expect(item.localId.length).toBeGreaterThan(0);

    const row = db
      .prepare("SELECT local_id FROM board_items WHERE local_id = ?")
      .get(item.localId) as { local_id: string } | null;

    expect(row).not.toBeNull();
    expect(row!.local_id).toBe(item.localId);
  });
});

// =============================================================================
// Extracted Columns (Phase 1 - Schema v3)
// =============================================================================

describe("Extracted queryable columns", () => {
  let db: Database;
  let factory: BoardItemFactory;

  beforeEach(() => {
    setFakerSeed(42);
    db = createTestDb();
    factory = new BoardItemFactory(db);
  });

  afterEach(() => {
    db.close();
  });

  test("status is extracted from overrides into first-class column", () => {
    const item = factory.create({
      batchId: 1,
      boardKey: "court_cases",
      boardConfig: STUB_BOARD_CONFIG,
      name: "Test Court Case",
      overrides: {
        status: { label: "Set for Hearing" },
        x_next_hearing_date: { date: "2026-05-15" },
      },
    });

    expect(item.status).toBe("Set for Hearing");

    const row = db
      .prepare("SELECT status FROM board_items WHERE local_id = ?")
      .get(item.localId) as { status: string };

    expect(row.status).toBe("Set for Hearing");
  });

  test("next_date is extracted based on board-specific key", () => {
    const courtCase = factory.create({
      batchId: 1,
      boardKey: "court_cases",
      boardConfig: STUB_BOARD_CONFIG,
      name: "Court Case",
      overrides: {
        status: { label: "Active" },
        x_next_hearing_date: { date: "2026-05-15" },
      },
    });

    expect(courtCase.nextDate).toBe("2026-05-15");

    const motion = factory.create({
      batchId: 1,
      boardKey: "motions",
      boardConfig: STUB_BOARD_CONFIG,
      name: "Motion",
      overrides: {
        status: { label: "Pending" },
        next_hearing_date: { date: "2026-06-01" },
      },
    });

    expect(motion.nextDate).toBe("2026-06-01");

    const rfe = factory.create({
      batchId: 1,
      boardKey: "rfes_all",
      boardConfig: STUB_BOARD_CONFIG,
      name: "RFE",
      overrides: {
        status: { label: "Received" },
        due_date: { date: "2026-04-30" },
      },
    });

    expect(rfe.nextDate).toBe("2026-04-30");

    // Verify persisted to DB
    const rows = db
      .prepare("SELECT board_key, next_date FROM board_items WHERE next_date IS NOT NULL ORDER BY next_date")
      .all() as Array<{ board_key: string; next_date: string }>;

    expect(rows).toHaveLength(3);
    expect(rows[0]!.next_date).toBe("2026-04-30");
  });

  test("attorney and profileLocalId are persisted", () => {
    const item = factory.create({
      batchId: 1,
      boardKey: "court_cases",
      boardConfig: STUB_BOARD_CONFIG,
      name: "WH - Test Person",
      overrides: { status: { label: "Active" } },
      profileLocalId: "profile-123",
      attorney: "WH",
    });

    expect(item.attorney).toBe("WH");
    expect(item.profileLocalId).toBe("profile-123");

    const row = db
      .prepare("SELECT attorney, profile_local_id FROM board_items WHERE local_id = ?")
      .get(item.localId) as { attorney: string; profile_local_id: string };

    expect(row.attorney).toBe("WH");
    expect(row.profile_local_id).toBe("profile-123");
  });

  test("items without status override have null status", () => {
    const item = factory.create({
      batchId: 1,
      boardKey: "court_cases",
      boardConfig: STUB_BOARD_CONFIG,
      name: "No Status Item",
      overrides: {},
    });

    expect(item.status).toBeUndefined();

    const row = db
      .prepare("SELECT status FROM board_items WHERE local_id = ?")
      .get(item.localId) as { status: string | null };

    expect(row.status).toBeNull();
  });
});

// =============================================================================
// Override-Only Column Values (no auto-generated noise)
// =============================================================================

describe("Override-only column values", () => {
  let db: Database;
  let factory: BoardItemFactory;

  beforeEach(() => {
    setFakerSeed(42);
    db = createTestDb();
    factory = new BoardItemFactory(db);
  });

  afterEach(() => {
    db.close();
  });

  test("column_values contains only explicit overrides, no auto-generated noise", () => {
    const overrides = {
      status: { label: "Set for Hearing" },
      x_next_hearing_date: { date: "2026-05-15" },
      hearing_type: { label: "Master" },
    };

    const item = factory.create({
      batchId: 1,
      boardKey: "court_cases",
      boardConfig: {
        id: "board-123",
        name: "Court Cases",
        columns: {
          status: { resolve: "by_type" as const, type: "status" },
          x_next_hearing_date: { resolve: "by_type" as const, type: "date" },
          hearing_type: { resolve: "by_type" as const, type: "status" },
          // These should NOT appear in column_values (no override provided)
          some_text_field: { resolve: "by_type" as const, type: "text" },
          some_number: { resolve: "by_type" as const, type: "numbers" },
        },
      },
      name: "Test Court Case",
      overrides,
    });

    // column_values should only contain the 3 override keys
    expect(Object.keys(item.columnValues)).toHaveLength(3);
    expect(item.columnValues.status).toEqual({ label: "Set for Hearing" });
    expect(item.columnValues.some_text_field).toBeUndefined();
    expect(item.columnValues.some_number).toBeUndefined();
  });
});

// =============================================================================
// FTS5 Search
// =============================================================================

describe("FTS5 profile search", () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  test("profiles are searchable via FTS5", () => {
    db.prepare(
      "INSERT INTO profiles (batch_id, local_id, name, email, phone) VALUES (1, ?, ?, ?, ?)"
    ).run("p1", "Maria Garcia", "maria@example.com", "5551234567");

    db.prepare(
      "INSERT INTO profiles (batch_id, local_id, name, email, phone) VALUES (1, ?, ?, ?, ?)"
    ).run("p2", "Jose Martinez", "jose@example.com", "5559876543");

    // Search by name
    const byName = db
      .prepare("SELECT name FROM profiles_fts WHERE profiles_fts MATCH ?")
      .all("garcia") as Array<{ name: string }>;

    expect(byName).toHaveLength(1);
    expect(byName[0]!.name).toBe("Maria Garcia");

    // Search by email
    const byEmail = db
      .prepare("SELECT name FROM profiles_fts WHERE profiles_fts MATCH ?")
      .all("jose") as Array<{ name: string }>;

    expect(byEmail).toHaveLength(1);
    expect(byEmail[0]!.name).toBe("Jose Martinez");
  });
});

// =============================================================================
// Update Factory Tests
// =============================================================================

describe("UpdateFactory", () => {
  let db: Database;

  beforeEach(() => {
    setFakerSeed(42);
    db = createTestDb();
    // Insert a profile and board items to link against
    db.prepare(
      "INSERT INTO profiles (batch_id, local_id, name) VALUES (1, ?, ?)"
    ).run("p1", "Test Client");
    db.prepare(
      "INSERT INTO board_items (batch_id, local_id, board_key, name, profile_local_id, column_values) VALUES (1, ?, ?, ?, ?, ?)"
    ).run("bi1", "court_cases", "Test Court Case", "p1", "{}");
  });

  afterEach(() => {
    db.close();
  });

  test("generates updates with valid references", () => {
    const factory = new UpdateFactory(db);
    const updates = factory.generateBatchForProfile(1, "p1", [
      { localId: "bi1", boardKey: "court_cases" },
    ]);

    expect(updates.length).toBeGreaterThanOrEqual(2);

    // All updates reference the correct profile
    for (const u of updates) {
      expect(u.profileLocalId).toBe("p1");
    }

    // Verify persisted in DB
    const rows = db.prepare("SELECT COUNT(*) as cnt FROM client_updates WHERE batch_id = 1").get() as { cnt: number };
    expect(rows.cnt).toBe(updates.length);
  });

  test("generates replies with replyToUpdateId", () => {
    const factory = new UpdateFactory(db);
    // Run with a seed that produces replies
    setFakerSeed(7);
    const updates = factory.generateBatchForProfile(1, "p1", [
      { localId: "bi1", boardKey: "court_cases" },
    ]);

    const replies = updates.filter((u) => u.sourceType === "reply");
    for (const reply of replies) {
      expect(reply.replyToUpdateId).not.toBeNull();
      // The parent update should exist
      const parent = updates.find((u) => u.localId === reply.replyToUpdateId);
      expect(parent).toBeDefined();
    }
  });

  test("linked updates reference valid board items", () => {
    const factory = new UpdateFactory(db);
    const updates = factory.generateBatchForProfile(1, "p1", [
      { localId: "bi1", boardKey: "court_cases" },
    ]);

    const linked = updates.filter((u) => u.boardItemLocalId !== null);
    for (const u of linked) {
      expect(u.boardItemLocalId).toBe("bi1");
      expect(u.boardKey).toBe("court_cases");
    }
  });
});
