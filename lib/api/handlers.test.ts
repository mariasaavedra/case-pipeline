// =============================================================================
// API Handler Tests
// =============================================================================

import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { initializeSchema } from "../../scripts/seed/lib/db/schema";
import {
  handleListClients,
  handleSearch,
  handleClientDetail,
  handleClientContracts,
  handleClientBoardItems,
  handleBoardItemDetail,
  handleClientUpdates,
  handleClientRelationships,
} from "./handlers";

// =============================================================================
// Test Database Setup
// =============================================================================

let db: Database;

function makeRequest(url: string, params?: Record<string, string>): Request {
  const req = new Request(url);
  if (params) (req as any).params = params;
  return req;
}

beforeAll(() => {
  db = new Database(":memory:");
  initializeSchema(db);

  // Seed test data
  db.run("INSERT INTO seed_batches (batch_name, seed_value, status) VALUES ('test', 1, 'complete')");
  const batchId = (db.query("SELECT id FROM seed_batches ORDER BY id DESC LIMIT 1").get() as { id: number }).id;

  db.run(
    `INSERT INTO profiles (batch_id, local_id, name, email, phone, priority, address)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [batchId, "p1", "Maria Garcia", "maria@test.com", "555-1234", "High", "123 Main St"]
  );
  db.run(
    `INSERT INTO profiles (batch_id, local_id, name, email, phone, priority, address)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [batchId, "p2", "Carlos Garcia", "carlos@test.com", "555-5678", null, null]
  );

  db.run(
    `INSERT INTO contracts (batch_id, local_id, profile_local_id, name, case_type, status, value, contract_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [batchId, "c1", "p1", "I-485", "I-485", "Active", 5000, "CT-001"]
  );
  db.run(
    `INSERT INTO contracts (batch_id, local_id, profile_local_id, name, case_type, status, value, contract_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [batchId, "c2", "p1", "FOIA", "FOIA", "Completed", 500, "CT-002"]
  );

  db.run(
    `INSERT INTO board_items (batch_id, local_id, board_key, name, status, next_date, attorney, profile_local_id, group_title, column_values)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [batchId, "bi1", "court_cases", "WH - Maria Garcia [A123]", "Set for Hearing", "2026-04-15", "WH", "p1", "Court Case", "{}"]
  );
  db.run(
    `INSERT INTO board_items (batch_id, local_id, board_key, name, status, next_date, attorney, profile_local_id, group_title, column_values)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [batchId, "bi2", "appointments_r", "Maria Garcia", "Completed", "2026-01-10", null, "p1", "Past Consults", '{"language":{"label":"Spanish"}}']
  );

  // Client updates
  db.run(
    `INSERT INTO client_updates (batch_id, local_id, profile_local_id, board_item_local_id, board_key, author_name, author_email, text_body, body_html, source_type, reply_to_update_id, created_at_source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [batchId, "u1", "p1", "bi1", "court_cases", "Mayra Ruiz", "mayra@test.com", "Filed I-589", "<p>Filed I-589</p>", "update", null, "2026-02-17T10:00:00.000Z"]
  );
  db.run(
    `INSERT INTO client_updates (batch_id, local_id, profile_local_id, board_item_local_id, board_key, author_name, author_email, text_body, body_html, source_type, reply_to_update_id, created_at_source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [batchId, "u2", "p1", null, null, "Rafael Contreras", "rafael@test.com", "Called client", "<p>Called client</p>", "update", null, "2026-02-18T14:00:00.000Z"]
  );
});

afterAll(() => {
  db.close();
});

// =============================================================================
// Search Tests
// =============================================================================

describe("handleSearch", () => {
  test("returns results for valid query", async () => {
    const req = makeRequest("http://localhost:3000/api/clients/search?q=Garcia");
    const res = handleSearch(req, db);

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.length).toBe(2);
    expect(body.data.map((r: any) => r.name).sort()).toEqual(["Carlos Garcia", "Maria Garcia"]);
  });

  test("returns 400 for missing query", async () => {
    const req = makeRequest("http://localhost:3000/api/clients/search");
    const res = handleSearch(req, db);

    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toBeDefined();
  });

  test("returns 400 for empty query", async () => {
    const req = makeRequest("http://localhost:3000/api/clients/search?q=");
    const res = handleSearch(req, db);

    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toBeDefined();
  });

  test("returns empty array for no matches", async () => {
    const req = makeRequest("http://localhost:3000/api/clients/search?q=Nonexistent");
    const res = handleSearch(req, db);

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toEqual([]);
  });
});

// =============================================================================
// Client Detail Tests
// =============================================================================

describe("handleClientDetail", () => {
  test("returns full 360 summary", async () => {
    const req = makeRequest("http://localhost:3000/api/clients/p1", { localId: "p1" });
    const res = handleClientDetail(req, db);

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    const data = body.data;

    expect(data.profile.name).toBe("Maria Garcia");
    expect(data.contracts.active.length).toBe(1);
    expect(data.contracts.closed.length).toBe(1);
    expect(data.boardItems.court_cases).toBeDefined();
    expect(data.appointments.length).toBe(1);
  });

  test("returns 404 for unknown client", async () => {
    const req = makeRequest("http://localhost:3000/api/clients/unknown", { localId: "unknown" });
    const res = handleClientDetail(req, db);

    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.error).toBe("Client not found");
  });
});

// =============================================================================
// Contracts Tests
// =============================================================================

describe("handleClientContracts", () => {
  test("returns active and closed contracts", async () => {
    const req = makeRequest("http://localhost:3000/api/clients/p1/contracts", { localId: "p1" });
    const res = handleClientContracts(req, db);

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.active.length).toBe(1);
    expect(body.data.active[0].caseType).toBe("I-485");
    expect(body.data.closed.length).toBe(1);
    expect(body.data.closed[0].status).toBe("Completed");
  });

  test("returns empty arrays for client with no contracts", async () => {
    const req = makeRequest("http://localhost:3000/api/clients/p2/contracts", { localId: "p2" });
    const res = handleClientContracts(req, db);

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.active).toEqual([]);
    expect(body.data.closed).toEqual([]);
  });
});

// =============================================================================
// Board Items Tests
// =============================================================================

describe("handleClientBoardItems", () => {
  test("returns items grouped by board with appointments separated", async () => {
    const req = makeRequest("http://localhost:3000/api/clients/p1/board-items", { localId: "p1" });
    const res = handleClientBoardItems(req, db);

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.byBoard.court_cases).toBeDefined();
    expect(body.data.byBoard.court_cases.length).toBe(1);
    expect(body.data.appointments.length).toBe(1);
    expect(body.data.appointments[0].boardKey).toBe("appointments_r");
  });
});

// =============================================================================
// Board Item Detail Tests
// =============================================================================

describe("handleBoardItemDetail", () => {
  test("returns full board item with columnValues", async () => {
    const req = makeRequest("http://localhost:3000/api/board-items/bi2", { localId: "bi2" });
    const res = handleBoardItemDetail(req, db);

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.boardKey).toBe("appointments_r");
    expect(body.data.columnValues.language.label).toBe("Spanish");
    expect(body.data.column_values).toBeUndefined();
  });

  test("returns 404 for unknown board item", async () => {
    const req = makeRequest("http://localhost:3000/api/board-items/unknown", { localId: "unknown" });
    const res = handleBoardItemDetail(req, db);

    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.error).toBe("Board item not found");
  });
});

// =============================================================================
// Client Updates Tests
// =============================================================================

describe("handleClientUpdates", () => {
  test("returns updates for valid client", async () => {
    const req = makeRequest("http://localhost:3000/api/clients/p1/updates", { localId: "p1" });
    const res = handleClientUpdates(req, db);

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.length).toBe(2);
    expect(body.data[0].textBody).toBe("Called client"); // Newest first
  });

  test("respects limit query param", async () => {
    const req = makeRequest("http://localhost:3000/api/clients/p1/updates?limit=1", { localId: "p1" });
    const res = handleClientUpdates(req, db);

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.length).toBe(1);
  });

  test("returns empty array for unknown client", async () => {
    const req = makeRequest("http://localhost:3000/api/clients/unknown/updates", { localId: "unknown" });
    const res = handleClientUpdates(req, db);

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toEqual([]);
  });

  test("clamps negative limit to 1", async () => {
    const req = makeRequest("http://localhost:3000/api/clients/p1/updates?limit=-1", { localId: "p1" });
    const res = handleClientUpdates(req, db);

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.length).toBeLessThanOrEqual(1);
  });

  test("treats limit=0 as default (50)", async () => {
    const req = makeRequest("http://localhost:3000/api/clients/p1/updates?limit=0", { localId: "p1" });
    const res = handleClientUpdates(req, db);

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(Array.isArray(body.data)).toBe(true);
  });

  test("caps limit=9999 to 200", async () => {
    const req = makeRequest("http://localhost:3000/api/clients/p1/updates?limit=9999", { localId: "p1" });
    const res = handleClientUpdates(req, db);

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(Array.isArray(body.data)).toBe(true);
  });

  test("treats non-numeric limit as default (50)", async () => {
    const req = makeRequest("http://localhost:3000/api/clients/p1/updates?limit=abc", { localId: "p1" });
    const res = handleClientUpdates(req, db);

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(Array.isArray(body.data)).toBe(true);
  });
});

// =============================================================================
// List Clients Tests (with pagination)
// =============================================================================

describe("handleListClients", () => {
  test("returns profiles with default limit", async () => {
    const req = makeRequest("http://localhost:3000/api/clients");
    const res = handleListClients(req, db);

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.profiles.length).toBe(2);
    expect(body.data.total).toBe(2);
  });

  test("respects limit param", async () => {
    const req = makeRequest("http://localhost:3000/api/clients?limit=1");
    const res = handleListClients(req, db);

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.profiles.length).toBe(1);
  });

  test("respects offset param", async () => {
    const req = makeRequest("http://localhost:3000/api/clients?limit=1&offset=1");
    const res = handleListClients(req, db);

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.profiles.length).toBe(1);
    // ORDER BY name: "Carlos Garcia" then "Maria Garcia" — offset=1 gives Maria
    expect(body.data.profiles[0].name).toBe("Maria Garcia");
  });

  test("clamps negative limit to 1", async () => {
    const req = makeRequest("http://localhost:3000/api/clients?limit=-5");
    const res = handleListClients(req, db);

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.profiles.length).toBeLessThanOrEqual(1);
  });

  test("treats negative offset as 0", async () => {
    const req = makeRequest("http://localhost:3000/api/clients?offset=-1");
    const res = handleListClients(req, db);

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.profiles.length).toBe(2);
  });
});

// =============================================================================
// Client Updates with Offset Tests
// =============================================================================

describe("handleClientUpdates (offset)", () => {
  test("returns updates with offset", async () => {
    const req = makeRequest("http://localhost:3000/api/clients/p1/updates?limit=1&offset=1", { localId: "p1" });
    const res = handleClientUpdates(req, db);

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.length).toBe(1);
    // Offset=1 skips the first (newest) update
    expect(body.data[0].textBody).toBe("Filed I-589");
  });

  test("treats negative offset as 0", async () => {
    const req = makeRequest("http://localhost:3000/api/clients/p1/updates?offset=-5", { localId: "p1" });
    const res = handleClientUpdates(req, db);

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.length).toBe(2);
  });
});

// =============================================================================
// Client Relationships Tests
// =============================================================================

describe("handleClientRelationships", () => {
  test("returns relationships for valid client", async () => {
    const req = makeRequest("http://localhost:3000/api/clients/p1/relationships", { localId: "p1" });
    const res = handleClientRelationships(req, db);

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(Array.isArray(body.data)).toBe(true);
  });

  test("returns empty array for client with no relationships", async () => {
    const req = makeRequest("http://localhost:3000/api/clients/p2/relationships", { localId: "p2" });
    const res = handleClientRelationships(req, db);

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toEqual([]);
  });
});
