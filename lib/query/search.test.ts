// =============================================================================
// Search Query Tests — Enhanced profile search + typed cross-entity search
// =============================================================================

import { test, expect, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { initializeSchema } from "../../scripts/seed/lib/db/schema";
import { searchClients, listProfilesFiltered, getFilterOptions } from "./client";
import { searchByType } from "./search";

// =============================================================================
// Helpers
// =============================================================================

function freshDb(): Database {
  const db = new Database(":memory:");
  initializeSchema(db);
  db.run(
    "INSERT INTO seed_batches (batch_name, seed_value, status) VALUES ('test', 1, 'complete')",
  );
  return db;
}

function insertProfile(
  db: Database,
  opts: {
    localId: string;
    name: string;
    email?: string;
    phone?: string;
    address?: string;
    priority?: string;
  },
) {
  db.run(
    `INSERT INTO profiles (batch_id, local_id, name, email, phone, address, priority)
     VALUES (1, ?, ?, ?, ?, ?, ?)`,
    [
      opts.localId,
      opts.name,
      opts.email ?? null,
      opts.phone ?? null,
      opts.address ?? null,
      opts.priority ?? null,
    ],
  );
}

function insertContract(
  db: Database,
  opts: {
    localId: string;
    profileLocalId: string;
    name: string;
    caseType: string;
    status: string;
  },
) {
  db.run(
    `INSERT INTO contracts (batch_id, local_id, profile_local_id, name, case_type, status, value, contract_id)
     VALUES (1, ?, ?, ?, ?, ?, 1000, ?)`,
    [opts.localId, opts.profileLocalId, opts.name, opts.caseType, opts.status, `CT-${opts.localId}`],
  );
}

function insertBoardItem(
  db: Database,
  opts: {
    localId: string;
    boardKey: string;
    name: string;
    status?: string;
    attorney?: string;
    profileLocalId?: string;
    nextDate?: string;
  },
) {
  db.run(
    `INSERT INTO board_items (batch_id, local_id, board_key, name, status, attorney, profile_local_id, next_date, column_values)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, '{}')`,
    [
      opts.localId,
      opts.boardKey,
      opts.name,
      opts.status ?? null,
      opts.attorney ?? null,
      opts.profileLocalId ?? null,
      opts.nextDate ?? null,
    ],
  );
}

// =============================================================================
// Enhanced Profile Search
// =============================================================================

describe("searchClients", () => {
  test("finds profile by name via FTS", () => {
    const db = freshDb();
    insertProfile(db, { localId: "p1", name: "Maria Garcia", email: "mg@test.com", phone: "555-123-4567" });
    insertProfile(db, { localId: "p2", name: "John Smith", email: "js@test.com" });

    const results = searchClients(db, "Maria");
    expect(results.length).toBe(1);
    expect(results[0]!.name).toBe("Maria Garcia");
    expect(results[0]!.localId).toBe("p1");
  });

  test("finds profile by partial phone number (last 4 digits)", () => {
    const db = freshDb();
    insertProfile(db, { localId: "p1", name: "Maria Garcia", phone: "555-123-4567" });
    insertProfile(db, { localId: "p2", name: "John Smith", phone: "555-999-8888" });

    const results = searchClients(db, "4567");
    expect(results.length).toBe(1);
    expect(results[0]!.name).toBe("Maria Garcia");
  });

  test("finds profile by phone with dashes", () => {
    const db = freshDb();
    insertProfile(db, { localId: "p1", name: "Maria Garcia", phone: "555-123-4567" });

    const results = searchClients(db, "555-123");
    expect(results.length).toBe(1);
    expect(results[0]!.name).toBe("Maria Garcia");
  });

  test("finds profile by email (partial match with @)", () => {
    const db = freshDb();
    insertProfile(db, { localId: "p1", name: "Maria Garcia", email: "maria.garcia@example.com" });
    insertProfile(db, { localId: "p2", name: "John Smith", email: "john@other.com" });

    const results = searchClients(db, "maria@");
    // Should match because email LIKE '%maria@%'
    expect(results.length).toBe(0); // "maria@" doesn't match "maria.garcia@"

    const results2 = searchClients(db, "@example.com");
    expect(results2.length).toBe(1);
    expect(results2[0]!.name).toBe("Maria Garcia");
  });

  test("finds profile by address via FTS", () => {
    const db = freshDb();
    insertProfile(db, { localId: "p1", name: "Maria Garcia", address: "123 Main Street, Springfield IL" });
    insertProfile(db, { localId: "p2", name: "John Smith", address: "456 Oak Ave, Chicago IL" });

    const results = searchClients(db, "Springfield");
    expect(results.length).toBe(1);
    expect(results[0]!.name).toBe("Maria Garcia");
    expect(results[0]!.address).toBe("123 Main Street, Springfield IL");
  });

  test("returns address in results", () => {
    const db = freshDb();
    insertProfile(db, { localId: "p1", name: "Maria Garcia", address: "123 Main St" });

    const results = searchClients(db, "Maria");
    expect(results[0]!.address).toBe("123 Main St");
  });

  test("handles FTS reserved words (AND, OR, NOT)", () => {
    const db = freshDb();
    insertProfile(db, { localId: "p1", name: "Andrew Or" });

    // Should not crash with reserved words
    const results = searchClients(db, "Andrew Or");
    expect(results.length).toBeGreaterThanOrEqual(0); // Just shouldn't throw
  });

  test("returns empty for blank input", () => {
    const db = freshDb();
    insertProfile(db, { localId: "p1", name: "Maria Garcia" });

    expect(searchClients(db, "")).toEqual([]);
    expect(searchClients(db, "   ")).toEqual([]);
  });
});

// =============================================================================
// Typed Search (contracts, board items)
// =============================================================================

describe("searchByType", () => {
  test("searches contracts by name", () => {
    const db = freshDb();
    insertProfile(db, { localId: "p1", name: "Maria Garcia" });
    insertContract(db, {
      localId: "c1",
      profileLocalId: "p1",
      name: "I-130 Filing",
      caseType: "Immigration",
      status: "Paid Needs Action",
    });

    const results = searchByType(db, "I-130", "contracts");
    expect(results.length).toBe(1);
    expect(results[0]!.name).toBe("I-130 Filing");
    expect(results[0]!.clientName).toBe("Maria Garcia");
    expect(results[0]!.clientLocalId).toBe("p1");
  });

  test("searches contracts by case type", () => {
    const db = freshDb();
    insertProfile(db, { localId: "p1", name: "Maria Garcia" });
    insertContract(db, {
      localId: "c1",
      profileLocalId: "p1",
      name: "Some Contract",
      caseType: "Immigration",
      status: "Active",
    });

    const results = searchByType(db, "Immigration", "contracts");
    expect(results.length).toBe(1);
  });

  test("searches board items by board key", () => {
    const db = freshDb();
    insertProfile(db, { localId: "p1", name: "John Smith" });
    insertBoardItem(db, {
      localId: "bi1",
      boardKey: "court_cases",
      name: "Smith v. USCIS",
      status: "Active",
      attorney: "R",
      profileLocalId: "p1",
    });
    insertBoardItem(db, {
      localId: "bi2",
      boardKey: "motions",
      name: "Motion to Reopen Smith",
      profileLocalId: "p1",
    });

    const results = searchByType(db, "Smith", "court_cases");
    expect(results.length).toBe(1);
    expect(results[0]!.name).toBe("Smith v. USCIS");
    expect(results[0]!.boardKey).toBe("court_cases");
    expect(results[0]!.clientName).toBe("John Smith");
  });

  test("searches open forms board", () => {
    const db = freshDb();
    insertProfile(db, { localId: "p1", name: "Maria Garcia" });
    insertBoardItem(db, {
      localId: "bi1",
      boardKey: "_cd_open_forms",
      name: "I-765 EAD",
      status: "Open",
      profileLocalId: "p1",
    });

    const results = searchByType(db, "EAD", "open_forms");
    expect(results.length).toBe(1);
    expect(results[0]!.name).toBe("I-765 EAD");
  });

  test("returns empty for profiles type", () => {
    const db = freshDb();
    const results = searchByType(db, "test", "profiles");
    expect(results).toEqual([]);
  });

  test("returns empty for blank query", () => {
    const db = freshDb();
    expect(searchByType(db, "", "contracts")).toEqual([]);
    expect(searchByType(db, "  ", "contracts")).toEqual([]);
  });
});

// =============================================================================
// Filtered Profile Listing
// =============================================================================

describe("listProfilesFiltered", () => {
  test("returns all profiles with no filters", () => {
    const db = freshDb();
    insertProfile(db, { localId: "p1", name: "Alice" });
    insertProfile(db, { localId: "p2", name: "Bob" });

    const result = listProfilesFiltered(db);
    expect(result.total).toBe(2);
    expect(result.profiles.length).toBe(2);
  });

  test("filters by priority", () => {
    const db = freshDb();
    insertProfile(db, { localId: "p1", name: "Alice", priority: "High" });
    insertProfile(db, { localId: "p2", name: "Bob", priority: "Low" });

    const result = listProfilesFiltered(db, { priority: "High" });
    expect(result.total).toBe(1);
    expect(result.profiles[0]!.name).toBe("Alice");
  });

  test("filters by contract status", () => {
    const db = freshDb();
    insertProfile(db, { localId: "p1", name: "Alice" });
    insertProfile(db, { localId: "p2", name: "Bob" });
    insertContract(db, {
      localId: "c1",
      profileLocalId: "p1",
      name: "C1",
      caseType: "Imm",
      status: "Active",
    });

    const result = listProfilesFiltered(db, { status: "Active" });
    expect(result.total).toBe(1);
    expect(result.profiles[0]!.name).toBe("Alice");
  });

  test("filters by virtual status: paid_fee_ks", () => {
    const db = freshDb();
    insertProfile(db, { localId: "p1", name: "Alice" });
    insertProfile(db, { localId: "p2", name: "Bob" });
    insertContract(db, {
      localId: "c1",
      profileLocalId: "p1",
      name: "C1",
      caseType: "Imm",
      status: "Paid Needs Action",
    });

    const result = listProfilesFiltered(db, { status: "paid_fee_ks" });
    expect(result.total).toBe(1);
    expect(result.profiles[0]!.name).toBe("Alice");
  });

  test("filters by attorney", () => {
    const db = freshDb();
    insertProfile(db, { localId: "p1", name: "Alice" });
    insertProfile(db, { localId: "p2", name: "Bob" });
    insertBoardItem(db, {
      localId: "bi1",
      boardKey: "court_cases",
      name: "Case 1",
      attorney: "R",
      profileLocalId: "p1",
    });

    const result = listProfilesFiltered(db, { attorney: "R" });
    expect(result.total).toBe(1);
    expect(result.profiles[0]!.name).toBe("Alice");
  });

  test("filters by board type", () => {
    const db = freshDb();
    insertProfile(db, { localId: "p1", name: "Alice" });
    insertProfile(db, { localId: "p2", name: "Bob" });
    insertBoardItem(db, {
      localId: "bi1",
      boardKey: "_cd_open_forms",
      name: "Form 1",
      profileLocalId: "p1",
    });

    const result = listProfilesFiltered(db, { boardType: "_cd_open_forms" });
    expect(result.total).toBe(1);
    expect(result.profiles[0]!.name).toBe("Alice");
  });

  test("filters by date range", () => {
    const db = freshDb();
    insertProfile(db, { localId: "p1", name: "Alice" });
    insertProfile(db, { localId: "p2", name: "Bob" });
    insertBoardItem(db, {
      localId: "bi1",
      boardKey: "court_cases",
      name: "Case 1",
      nextDate: "2026-03-15",
      profileLocalId: "p1",
    });
    insertBoardItem(db, {
      localId: "bi2",
      boardKey: "court_cases",
      name: "Case 2",
      nextDate: "2026-06-01",
      profileLocalId: "p2",
    });

    const result = listProfilesFiltered(db, {
      dateFrom: "2026-03-01",
      dateTo: "2026-03-31",
    });
    expect(result.total).toBe(1);
    expect(result.profiles[0]!.name).toBe("Alice");
  });

  test("supports pagination", () => {
    const db = freshDb();
    for (let i = 0; i < 5; i++) {
      insertProfile(db, { localId: `p${i}`, name: `Profile ${i}` });
    }

    const page1 = listProfilesFiltered(db, { limit: 2, offset: 0 });
    expect(page1.total).toBe(5);
    expect(page1.profiles.length).toBe(2);

    const page2 = listProfilesFiltered(db, { limit: 2, offset: 2 });
    expect(page2.profiles.length).toBe(2);
  });
});

// =============================================================================
// Filter Options
// =============================================================================

describe("getFilterOptions", () => {
  test("returns distinct filter values", () => {
    const db = freshDb();
    insertProfile(db, { localId: "p1", name: "A", priority: "High" });
    insertProfile(db, { localId: "p2", name: "B", priority: "Low" });
    insertContract(db, {
      localId: "c1",
      profileLocalId: "p1",
      name: "C1",
      caseType: "Imm",
      status: "Active",
    });
    insertBoardItem(db, {
      localId: "bi1",
      boardKey: "court_cases",
      name: "Case",
      attorney: "R",
      profileLocalId: "p1",
    });

    const opts = getFilterOptions(db);
    expect(opts.priorities).toContain("High");
    expect(opts.priorities).toContain("Low");
    expect(opts.statuses).toContain("Active");
    expect(opts.attorneys).toContain("R");
    expect(opts.boardTypes.some((b) => b.key === "court_cases")).toBe(true);
  });
});
