// =============================================================================
// Query Layer Unit Tests
// =============================================================================

import { test, expect, describe, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initializeSchema } from "../../scripts/seed/lib/db/schema";
import {
  searchClients,
  getClientProfile,
  getClientByName,
  getClientContracts,
  getClientBoardItems,
  getBoardItemDetail,
  getClientCaseSummary,
  getClientUpdates,
} from "./index";

// =============================================================================
// Helpers
// =============================================================================

function freshDb(): Database {
  const db = new Database(":memory:");
  initializeSchema(db);
  return db;
}

function insertBatch(db: Database): number {
  db.run("INSERT INTO seed_batches (batch_name, seed_value, status) VALUES ('test', 1, 'complete')");
  return db.query("SELECT last_insert_rowid() as id").get() as any as number
    ? (db.query("SELECT id FROM seed_batches ORDER BY id DESC LIMIT 1").get() as { id: number }).id
    : 1;
}

function insertProfile(
  db: Database,
  batchId: number,
  opts: {
    localId: string;
    name: string;
    email?: string;
    phone?: string;
    priority?: string;
    address?: string;
  }
) {
  db.run(
    `INSERT INTO profiles (batch_id, local_id, name, email, phone, priority, address)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [batchId, opts.localId, opts.name, opts.email ?? null, opts.phone ?? null, opts.priority ?? null, opts.address ?? null]
  );
}

function insertContract(
  db: Database,
  batchId: number,
  opts: {
    localId: string;
    profileLocalId: string;
    name: string;
    caseType: string;
    status: string;
    value: number;
    contractId: string;
  }
) {
  db.run(
    `INSERT INTO contracts (batch_id, local_id, profile_local_id, name, case_type, status, value, contract_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [batchId, opts.localId, opts.profileLocalId, opts.name, opts.caseType, opts.status, opts.value, opts.contractId]
  );
}

function insertBoardItem(
  db: Database,
  batchId: number,
  opts: {
    localId: string;
    boardKey: string;
    name: string;
    status?: string;
    nextDate?: string;
    attorney?: string;
    profileLocalId?: string;
    groupTitle?: string;
    columnValues?: Record<string, unknown>;
  }
) {
  db.run(
    `INSERT INTO board_items (batch_id, local_id, board_key, name, status, next_date, attorney, profile_local_id, group_title, column_values)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      batchId,
      opts.localId,
      opts.boardKey,
      opts.name,
      opts.status ?? null,
      opts.nextDate ?? null,
      opts.attorney ?? null,
      opts.profileLocalId ?? null,
      opts.groupTitle ?? null,
      JSON.stringify(opts.columnValues ?? {}),
    ]
  );
}

function insertUpdate(
  db: Database,
  batchId: number,
  opts: {
    localId: string;
    profileLocalId: string;
    boardItemLocalId?: string;
    boardKey?: string;
    authorName: string;
    authorEmail?: string;
    textBody: string;
    bodyHtml?: string;
    sourceType?: string;
    replyToUpdateId?: string;
    createdAtSource: string;
  }
) {
  db.run(
    `INSERT INTO client_updates (batch_id, local_id, profile_local_id, board_item_local_id, board_key,
      author_name, author_email, text_body, body_html, source_type, reply_to_update_id, created_at_source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      batchId, opts.localId, opts.profileLocalId,
      opts.boardItemLocalId ?? null, opts.boardKey ?? null,
      opts.authorName, opts.authorEmail ?? null,
      opts.textBody, opts.bodyHtml ?? null,
      opts.sourceType ?? "update", opts.replyToUpdateId ?? null,
      opts.createdAtSource,
    ]
  );
}

// =============================================================================
// Client Search Tests
// =============================================================================

describe("searchClients", () => {
  test("finds profiles by name prefix", () => {
    const db = freshDb();
    const batchId = insertBatch(db);
    insertProfile(db, batchId, { localId: "p1", name: "Maria Garcia", email: "maria@test.com", phone: "555-1234" });
    insertProfile(db, batchId, { localId: "p2", name: "Carlos Garcia", email: "carlos@test.com" });
    insertProfile(db, batchId, { localId: "p3", name: "Tracy Miller", email: "tracy@test.com" });

    const results = searchClients(db, "Garcia");
    expect(results.length).toBe(2);
    expect(results.map((r) => r.name).sort()).toEqual(["Carlos Garcia", "Maria Garcia"]);
    db.close();
  });

  test("finds profiles by email", () => {
    const db = freshDb();
    const batchId = insertBatch(db);
    insertProfile(db, batchId, { localId: "p1", name: "Maria Garcia", email: "maria@test.com" });
    insertProfile(db, batchId, { localId: "p2", name: "Tracy Miller", email: "tracy@test.com" });

    const results = searchClients(db, "tracy");
    expect(results.length).toBe(1);
    expect(results[0]!.name).toBe("Tracy Miller");
    db.close();
  });

  test("returns empty array for no matches", () => {
    const db = freshDb();
    const batchId = insertBatch(db);
    insertProfile(db, batchId, { localId: "p1", name: "Maria Garcia" });

    const results = searchClients(db, "Nonexistent");
    expect(results).toEqual([]);
    db.close();
  });

  test("handles empty/whitespace query", () => {
    const db = freshDb();
    insertBatch(db);

    expect(searchClients(db, "")).toEqual([]);
    expect(searchClients(db, "   ")).toEqual([]);
    db.close();
  });

  test("strips special characters from query", () => {
    const db = freshDb();
    const batchId = insertBatch(db);
    insertProfile(db, batchId, { localId: "p1", name: "Maria Garcia" });

    // Special chars should be stripped, leaving just "Garcia"
    const results = searchClients(db, "Garcia!!!");
    expect(results.length).toBe(1);
    db.close();
  });
});

// =============================================================================
// Client Profile Tests
// =============================================================================

describe("getClientProfile", () => {
  test("returns profile by localId", () => {
    const db = freshDb();
    const batchId = insertBatch(db);
    insertProfile(db, batchId, {
      localId: "p1",
      name: "Maria Garcia",
      email: "maria@test.com",
      phone: "555-1234",
      priority: "High",
      address: "123 Main St",
    });

    const profile = getClientProfile(db, "p1");
    expect(profile).not.toBeNull();
    expect(profile!.name).toBe("Maria Garcia");
    expect(profile!.email).toBe("maria@test.com");
    expect(profile!.phone).toBe("555-1234");
    expect(profile!.priority).toBe("High");
    expect(profile!.address).toBe("123 Main St");
    db.close();
  });

  test("returns null for unknown localId", () => {
    const db = freshDb();
    insertBatch(db);

    expect(getClientProfile(db, "nonexistent")).toBeNull();
    db.close();
  });
});

describe("getClientByName", () => {
  test("returns profile by exact name", () => {
    const db = freshDb();
    const batchId = insertBatch(db);
    insertProfile(db, batchId, { localId: "p1", name: "Maria Garcia" });

    const profile = getClientByName(db, "Maria Garcia");
    expect(profile).not.toBeNull();
    expect(profile!.localId).toBe("p1");
    db.close();
  });

  test("returns null for partial name match", () => {
    const db = freshDb();
    const batchId = insertBatch(db);
    insertProfile(db, batchId, { localId: "p1", name: "Maria Garcia" });

    expect(getClientByName(db, "Garcia")).toBeNull();
    db.close();
  });
});

// =============================================================================
// Contract Tests
// =============================================================================

describe("getClientContracts", () => {
  test("splits contracts into active and closed", () => {
    const db = freshDb();
    const batchId = insertBatch(db);
    insertProfile(db, batchId, { localId: "p1", name: "Maria Garcia" });

    insertContract(db, batchId, {
      localId: "c1",
      profileLocalId: "p1",
      name: "I-485 Application",
      caseType: "I-485",
      status: "Active",
      value: 5000,
      contractId: "CT-001",
    });
    insertContract(db, batchId, {
      localId: "c2",
      profileLocalId: "p1",
      name: "N-400 Application",
      caseType: "N-400",
      status: "Completed",
      value: 3000,
      contractId: "CT-002",
    });
    insertContract(db, batchId, {
      localId: "c3",
      profileLocalId: "p1",
      name: "FOIA Request",
      caseType: "FOIA",
      status: "Cancelled",
      value: 500,
      contractId: "CT-003",
    });

    const { active, closed } = getClientContracts(db, "p1");
    expect(active.length).toBe(1);
    expect(active[0]!.caseType).toBe("I-485");
    expect(closed.length).toBe(2);
    expect(closed.map((c) => c.status).sort()).toEqual(["Cancelled", "Completed"]);
    db.close();
  });

  test("returns empty arrays when no contracts exist", () => {
    const db = freshDb();
    const batchId = insertBatch(db);
    insertProfile(db, batchId, { localId: "p1", name: "Maria Garcia" });

    const { active, closed } = getClientContracts(db, "p1");
    expect(active).toEqual([]);
    expect(closed).toEqual([]);
    db.close();
  });

  test("does not return contracts from other profiles", () => {
    const db = freshDb();
    const batchId = insertBatch(db);
    insertProfile(db, batchId, { localId: "p1", name: "Maria Garcia" });
    insertProfile(db, batchId, { localId: "p2", name: "Tracy Miller" });

    insertContract(db, batchId, {
      localId: "c1",
      profileLocalId: "p2",
      name: "Tracy's case",
      caseType: "I-130",
      status: "Active",
      value: 4000,
      contractId: "CT-010",
    });

    const { active, closed } = getClientContracts(db, "p1");
    expect(active).toEqual([]);
    expect(closed).toEqual([]);
    db.close();
  });
});

// =============================================================================
// Board Items Tests
// =============================================================================

describe("getClientBoardItems", () => {
  test("groups items by board_key and separates appointments", () => {
    const db = freshDb();
    const batchId = insertBatch(db);
    insertProfile(db, batchId, { localId: "p1", name: "Maria Garcia" });

    insertBoardItem(db, batchId, {
      localId: "bi1",
      boardKey: "court_cases",
      name: "WH - Maria Garcia [A123456789]",
      status: "Set for Hearing",
      nextDate: "2026-04-15",
      attorney: "WH",
      profileLocalId: "p1",
    });
    insertBoardItem(db, batchId, {
      localId: "bi2",
      boardKey: "court_cases",
      name: "LB - Maria Garcia [A987654321]",
      status: "Pending",
      profileLocalId: "p1",
    });
    insertBoardItem(db, batchId, {
      localId: "bi3",
      boardKey: "_cd_open_forms",
      name: "Maria Garcia - I-485",
      status: "Atty Approved",
      profileLocalId: "p1",
    });
    insertBoardItem(db, batchId, {
      localId: "bi4",
      boardKey: "appointments_r",
      name: "Maria Garcia",
      status: "Completed",
      nextDate: "2026-01-10",
      profileLocalId: "p1",
    });

    const { byBoard, appointments } = getClientBoardItems(db, "p1");

    // Board items grouped
    expect(Object.keys(byBoard).sort()).toEqual(["_cd_open_forms", "court_cases"]);
    expect(byBoard["court_cases"]!.length).toBe(2);
    expect(byBoard["_cd_open_forms"]!.length).toBe(1);

    // Appointments separated
    expect(appointments.length).toBe(1);
    expect(appointments[0]!.boardKey).toBe("appointments_r");
    db.close();
  });

  test("parses column_values JSON", () => {
    const db = freshDb();
    const batchId = insertBatch(db);
    insertProfile(db, batchId, { localId: "p1", name: "Maria Garcia" });

    insertBoardItem(db, batchId, {
      localId: "bi1",
      boardKey: "motions",
      name: "Maria Garcia - MTR",
      status: "Filed",
      profileLocalId: "p1",
      columnValues: { hearing_type: { label: "Master" }, motion: { labels: ["MTR"] } },
    });

    const { byBoard } = getClientBoardItems(db, "p1");
    const item = byBoard["motions"]![0]!;
    expect(item.columnValues).toEqual({ hearing_type: { label: "Master" }, motion: { labels: ["MTR"] } });
    db.close();
  });

  test("separates all appointment board keys", () => {
    const db = freshDb();
    const batchId = insertBatch(db);
    insertProfile(db, batchId, { localId: "p1", name: "Test User" });

    const apptBoards = ["appointments_r", "appointments_m", "appointments_lb", "appointments_wh"];
    for (let i = 0; i < apptBoards.length; i++) {
      insertBoardItem(db, batchId, {
        localId: `appt-${i}`,
        boardKey: apptBoards[i]!,
        name: "Test User",
        status: "Completed",
        profileLocalId: "p1",
      });
    }

    const { byBoard, appointments } = getClientBoardItems(db, "p1");
    expect(Object.keys(byBoard)).toEqual([]);
    expect(appointments.length).toBe(4);
    db.close();
  });

  test("returns empty when no items for profile", () => {
    const db = freshDb();
    const batchId = insertBatch(db);
    insertProfile(db, batchId, { localId: "p1", name: "Maria Garcia" });

    const { byBoard, appointments } = getClientBoardItems(db, "p1");
    expect(Object.keys(byBoard)).toEqual([]);
    expect(appointments).toEqual([]);
    db.close();
  });
});

describe("getBoardItemDetail", () => {
  test("returns full item by localId", () => {
    const db = freshDb();
    const batchId = insertBatch(db);

    insertBoardItem(db, batchId, {
      localId: "bi1",
      boardKey: "rfes_all",
      name: "WH - NOID: Maria Garcia",
      status: "Received",
      nextDate: "2026-03-15",
      attorney: "WH",
      profileLocalId: "p1",
      groupTitle: "USCIS RFEs",
      columnValues: { type: { labels: ["NOID"] }, due_date: { date: "2026-03-15" } },
    });

    const item = getBoardItemDetail(db, "bi1");
    expect(item).not.toBeNull();
    expect(item!.boardKey).toBe("rfes_all");
    expect(item!.status).toBe("Received");
    expect(item!.attorney).toBe("WH");
    expect(item!.columnValues).toEqual({ type: { labels: ["NOID"] }, due_date: { date: "2026-03-15" } });
    db.close();
  });

  test("returns null for unknown localId", () => {
    const db = freshDb();
    insertBatch(db);

    expect(getBoardItemDetail(db, "nonexistent")).toBeNull();
    db.close();
  });
});

// =============================================================================
// Case Summary Tests (360 View)
// =============================================================================

describe("getClientCaseSummary", () => {
  test("returns null for nonexistent profile", () => {
    const db = freshDb();
    insertBatch(db);

    expect(getClientCaseSummary(db, "nonexistent")).toBeNull();
    db.close();
  });

  test("returns full 360 view with all sections", () => {
    const db = freshDb();
    const batchId = insertBatch(db);

    // Profile
    insertProfile(db, batchId, {
      localId: "p1",
      name: "Maria Garcia",
      email: "maria@test.com",
      phone: "555-1234",
      priority: "High",
    });

    // Contracts (1 active, 1 closed)
    insertContract(db, batchId, {
      localId: "c1",
      profileLocalId: "p1",
      name: "I-485",
      caseType: "I-485",
      status: "Active",
      value: 5000,
      contractId: "CT-001",
    });
    insertContract(db, batchId, {
      localId: "c2",
      profileLocalId: "p1",
      name: "FOIA",
      caseType: "FOIA",
      status: "Completed",
      value: 500,
      contractId: "CT-002",
    });

    // Board items
    insertBoardItem(db, batchId, {
      localId: "bi1",
      boardKey: "court_cases",
      name: "WH - Maria Garcia [A123]",
      status: "Set for Hearing",
      nextDate: "2026-04-15",
      attorney: "WH",
      profileLocalId: "p1",
    });
    insertBoardItem(db, batchId, {
      localId: "bi2",
      boardKey: "_cd_open_forms",
      name: "Maria Garcia - I-485",
      status: "Atty Approved",
      profileLocalId: "p1",
    });

    // Appointment
    insertBoardItem(db, batchId, {
      localId: "bi3",
      boardKey: "appointments_r",
      name: "Maria Garcia",
      status: "Completed",
      nextDate: "2026-01-10",
      profileLocalId: "p1",
    });

    const summary = getClientCaseSummary(db, "p1");
    expect(summary).not.toBeNull();

    // Profile
    expect(summary!.profile.name).toBe("Maria Garcia");
    expect(summary!.profile.priority).toBe("High");

    // Contracts
    expect(summary!.contracts.active.length).toBe(1);
    expect(summary!.contracts.active[0]!.caseType).toBe("I-485");
    expect(summary!.contracts.closed.length).toBe(1);
    expect(summary!.contracts.closed[0]!.status).toBe("Completed");

    // Board items
    expect(Object.keys(summary!.boardItems).sort()).toEqual(["_cd_open_forms", "court_cases"]);
    expect(summary!.boardItems["court_cases"]![0]!.status).toBe("Set for Hearing");

    // Appointments
    expect(summary!.appointments.length).toBe(1);
    expect(summary!.appointments[0]!.boardKey).toBe("appointments_r");

    db.close();
  });

  test("returns summary with empty contracts and board items", () => {
    const db = freshDb();
    const batchId = insertBatch(db);
    insertProfile(db, batchId, { localId: "p1", name: "New Client" });

    const summary = getClientCaseSummary(db, "p1");
    expect(summary).not.toBeNull();
    expect(summary!.profile.name).toBe("New Client");
    expect(summary!.contracts.active).toEqual([]);
    expect(summary!.contracts.closed).toEqual([]);
    expect(Object.keys(summary!.boardItems)).toEqual([]);
    expect(summary!.appointments).toEqual([]);
    db.close();
  });

  test("includes updates in case summary", () => {
    const db = freshDb();
    const batchId = insertBatch(db);
    insertProfile(db, batchId, { localId: "p1", name: "Test Client" });
    insertUpdate(db, batchId, {
      localId: "u1", profileLocalId: "p1", authorName: "Mayra Ruiz",
      textBody: "Filed I-589", createdAtSource: "2026-02-17T10:00:00.000Z",
    });

    const summary = getClientCaseSummary(db, "p1");
    expect(summary!.updates.length).toBe(1);
    expect(summary!.updates[0]!.textBody).toBe("Filed I-589");
    db.close();
  });
});

// =============================================================================
// Client Updates Tests
// =============================================================================

describe("getClientUpdates", () => {
  test("returns updates for a profile", () => {
    const db = freshDb();
    const batchId = insertBatch(db);
    insertProfile(db, batchId, { localId: "p1", name: "Test Client" });
    insertUpdate(db, batchId, {
      localId: "u1", profileLocalId: "p1", authorName: "Mayra Ruiz",
      textBody: "Spoke to client", createdAtSource: "2026-02-17T10:00:00.000Z",
    });
    insertUpdate(db, batchId, {
      localId: "u2", profileLocalId: "p1", authorName: "Rafael Contreras",
      textBody: "Filed motion", boardKey: "court_cases",
      createdAtSource: "2026-02-18T14:00:00.000Z",
    });

    const updates = getClientUpdates(db, "p1");
    expect(updates.length).toBe(2);
    expect(updates[0]!.textBody).toBe("Filed motion"); // Newest first
    expect(updates[1]!.textBody).toBe("Spoke to client");
    db.close();
  });

  test("respects limit parameter", () => {
    const db = freshDb();
    const batchId = insertBatch(db);
    insertProfile(db, batchId, { localId: "p1", name: "Test Client" });

    for (let i = 0; i < 5; i++) {
      insertUpdate(db, batchId, {
        localId: `u${i}`, profileLocalId: "p1", authorName: "Staff",
        textBody: `Note ${i}`, createdAtSource: `2026-02-${10 + i}T10:00:00.000Z`,
      });
    }

    const updates = getClientUpdates(db, "p1", 3);
    expect(updates.length).toBe(3);
    db.close();
  });

  test("does not leak updates across profiles", () => {
    const db = freshDb();
    const batchId = insertBatch(db);
    insertProfile(db, batchId, { localId: "p1", name: "Client A" });
    insertProfile(db, batchId, { localId: "p2", name: "Client B" });
    insertUpdate(db, batchId, {
      localId: "u1", profileLocalId: "p1", authorName: "Staff",
      textBody: "Note for A", createdAtSource: "2026-02-17T10:00:00.000Z",
    });
    insertUpdate(db, batchId, {
      localId: "u2", profileLocalId: "p2", authorName: "Staff",
      textBody: "Note for B", createdAtSource: "2026-02-17T11:00:00.000Z",
    });

    const updatesA = getClientUpdates(db, "p1");
    expect(updatesA.length).toBe(1);
    expect(updatesA[0]!.textBody).toBe("Note for A");

    const updatesB = getClientUpdates(db, "p2");
    expect(updatesB.length).toBe(1);
    expect(updatesB[0]!.textBody).toBe("Note for B");
    db.close();
  });

  test("returns replies with correct sourceType and replyToUpdateId", () => {
    const db = freshDb();
    const batchId = insertBatch(db);
    insertProfile(db, batchId, { localId: "p1", name: "Test Client" });
    insertUpdate(db, batchId, {
      localId: "u1", profileLocalId: "p1", authorName: "Mayra Ruiz",
      textBody: "Original note", createdAtSource: "2026-02-17T10:00:00.000Z",
    });
    insertUpdate(db, batchId, {
      localId: "u2", profileLocalId: "p1", authorName: "Rafael Contreras",
      textBody: "Got it", sourceType: "reply", replyToUpdateId: "u1",
      createdAtSource: "2026-02-17T10:30:00.000Z",
    });

    const updates = getClientUpdates(db, "p1");
    const reply = updates.find((u) => u.sourceType === "reply");
    expect(reply).toBeDefined();
    expect(reply!.replyToUpdateId).toBe("u1");
    expect(reply!.textBody).toBe("Got it");
    db.close();
  });

  test("returns empty array for unknown profile", () => {
    const db = freshDb();
    initializeSchema(db);
    const updates = getClientUpdates(db, "nonexistent");
    expect(updates).toEqual([]);
    db.close();
  });
});
