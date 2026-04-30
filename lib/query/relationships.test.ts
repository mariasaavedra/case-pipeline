import { test, expect, describe, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
type DatabaseInstance = InstanceType<typeof Database>;

function run(db: DatabaseInstance, sql: string, params: unknown[] = []): void {
  db.prepare(sql).run(...(params as any[]));
}
import { initializeSchema } from "../../scripts/seed/lib/db/schema";
import { getClientRelationships } from "./relationships";

let db: DatabaseInstance;
let batchId: number;

beforeAll(() => {
  db = new Database(":memory:");
  initializeSchema(db);

  run(db, "INSERT INTO seed_batches (batch_name, seed_value, status) VALUES ('test', 1, 'complete')");
  batchId = (db.prepare("SELECT id FROM seed_batches ORDER BY id DESC LIMIT 1").get() as { id: number }).id;

  // Profile p1
  run(db, 
    `INSERT INTO profiles (batch_id, local_id, name, email, phone, priority, address)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [batchId, "p1", "Maria Garcia", "maria@test.com", "555-1234", "High", "123 Main St"]
  );

  // Profile p2
  run(db, 
    `INSERT INTO profiles (batch_id, local_id, name, email, phone, priority, address)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [batchId, "p2", "Carlos Lopez", "carlos@test.com", "555-5678", null, null]
  );

  // Board items for p1
  run(db, 
    `INSERT INTO board_items (batch_id, local_id, board_key, name, status, profile_local_id, column_values)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [batchId, "bi1", "court_cases", "WH - Maria Garcia [A123]", "Set for Hearing", "p1", "{}"]
  );
  run(db, 
    `INSERT INTO board_items (batch_id, local_id, board_key, name, status, profile_local_id, column_values)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [batchId, "bi2", "motions", "Motion to Reopen - Maria", "Filed", "p1", "{}"]
  );

  // Board item for p2
  run(db, 
    `INSERT INTO board_items (batch_id, local_id, board_key, name, status, profile_local_id, column_values)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [batchId, "bi3", "court_cases", "WH - Carlos Lopez", "Active", "p2", "{}"]
  );

  // Relationship: motion bi2 linked to court case bi1 (both p1)
  run(db, 
    `INSERT INTO item_relationships (batch_id, source_table, source_local_id, target_table, target_local_id, relationship_type, column_key)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [batchId, "board_items", "bi2", "board_items", "bi1", "linked_to", "court_case"]
  );

  // Relationship for p2 only (should not appear in p1 results)
  run(db, 
    `INSERT INTO item_relationships (batch_id, source_table, source_local_id, target_table, target_local_id, relationship_type, column_key)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [batchId, "board_items", "bi3", "board_items", "bi3", "self_ref", "test"]
  );
});

afterAll(() => {
  db.close();
});

describe("getClientRelationships", () => {
  test("returns relationships for client's board items", () => {
    const rels = getClientRelationships(db, "p1");
    expect(rels.length).toBe(1);
    expect(rels[0]!.sourceLocalId).toBe("bi2");
    expect(rels[0]!.targetLocalId).toBe("bi1");
    expect(rels[0]!.relationshipType).toBe("linked_to");
    expect(rels[0]!.sourceName).toBe("Motion to Reopen - Maria");
    expect(rels[0]!.targetName).toBe("WH - Maria Garcia [A123]");
    expect(rels[0]!.sourceBoardKey).toBe("motions");
    expect(rels[0]!.targetBoardKey).toBe("court_cases");
  });

  test("returns empty array when no relationships exist", () => {
    // Profile p1 relationships don't include p2-only ones
    const rels = getClientRelationships(db, "nonexistent");
    expect(rels).toEqual([]);
  });

  test("does not leak relationships from other profiles", () => {
    const rels = getClientRelationships(db, "p1");
    // Should not include p2's self-ref relationship
    const hasP2Rel = rels.some((r) => r.sourceLocalId === "bi3" || r.targetLocalId === "bi3");
    expect(hasP2Rel).toBe(false);
  });

  test("returns p2 relationships correctly", () => {
    const rels = getClientRelationships(db, "p2");
    expect(rels.length).toBe(1);
    expect(rels[0]!.relationshipType).toBe("self_ref");
  });
});
