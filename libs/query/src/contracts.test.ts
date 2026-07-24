// =============================================================================
// Contract query tests — status normalization, fee totals, linked-case resolve
// =============================================================================

import { test, expect, describe } from "vitest";
import Database from "better-sqlite3";
type DatabaseInstance = InstanceType<typeof Database>;
import { initializeSchema } from "@case-pipeline/seed/db/schema";
import { getClientContracts } from "./contracts";
import { normalizeContractStatus, contractStatusKey } from "./types";

function freshDb(): DatabaseInstance {
  const db = new Database(":memory:");
  initializeSchema(db);
  db.prepare("INSERT INTO seed_batches (id, batch_name, status) VALUES (1, 't', 'complete')").run();
  db.prepare("INSERT INTO profiles (batch_id, local_id, monday_item_id, name) VALUES (1, 'p1', 'MP1', 'Ada')").run();
  return db;
}

function insertContract(
  db: DatabaseInstance,
  o: { localId: string; mondayId?: string; status: string; group: string; cv?: Record<string, unknown> },
) {
  db.prepare(
    `INSERT INTO contracts (batch_id, local_id, monday_item_id, profile_local_id, name, case_type, status, group_title, raw_column_values)
     VALUES (1, ?, ?, 'p1', ?, ?, ?, ?, ?)`,
  ).run(o.localId, o.mondayId ?? null, o.status, "I-485", o.status, o.group, JSON.stringify(o.cv ?? {}));
}

function insertCase(
  db: DatabaseInstance,
  o: { localId: string; boardKey: string; name: string; status: string; feeMondayId: string },
) {
  db.prepare(
    `INSERT INTO board_items (batch_id, local_id, monday_item_id, board_key, name, status, column_values)
     VALUES (1, ?, ?, ?, ?, ?, ?)`,
  ).run(
    o.localId,
    `case-${o.localId}`,
    o.boardKey,
    o.name,
    o.status,
    JSON.stringify({ link_to_fee_ks: { linked_item_ids: [o.feeMondayId] } }),
  );
}

describe("normalizeContractStatus", () => {
  test("classifies by Monday group, not the raw status label", () => {
    // "Create Project" lives in the Closed group → completed, not pending.
    expect(contractStatusKey("Closed Fee Ks")).toBe("completed");
    expect(contractStatusKey("Paid Fee Ks")).toBe("paid");
    expect(contractStatusKey("Pending Fee Ks")).toBe("pending");
    expect(contractStatusKey("Not Going Forward")).toBe("not_going_forward");
    expect(contractStatusKey("Waivers")).toBe("paid");
    expect(contractStatusKey(null)).toBe("other");
  });

  test("translates Create Project to a green Completed", () => {
    const n = normalizeContractStatus("Closed Fee Ks", "Create Project");
    expect(n.key).toBe("completed");
    expect(n.label).toBe("Completed");
    expect(n.tone).toBe("green");
  });

  test("an unmapped status in a known group uses the group default label", () => {
    const n = normalizeContractStatus("Pending Fee Ks", "Some New Status");
    expect(n.key).toBe("pending");
    expect(n.label).toBe("Pending");
  });
});

describe("getClientContracts", () => {
  test("splits active/closed by normalized status and sums paid AF/PF", () => {
    const db = freshDb();
    // completed (paid), with fees
    insertContract(db, { localId: "c1", status: "Create Project", group: "Closed Fee Ks", cv: { af: "4000", pf: "100" } });
    // paid group, with fees
    insertContract(db, { localId: "c2", status: "E-File opened", group: "Paid Fee Ks", cv: { af: "3000" } });
    // pending → active, NOT counted toward paid totals
    insertContract(db, { localId: "c3", status: "Payment link sent", group: "Pending Fee Ks", cv: { af: "9999" } });
    // dead → closed, not paid
    insertContract(db, { localId: "c4", status: "Not going forward", group: "Not Going Forward", cv: { af: "500" } });

    const r = getClientContracts(db, "p1");

    // Active = still in flight: c2 (paid, e-file opening) + c3 (pending).
    // Closed = settled: c1 (completed) + c4 (not going forward).
    expect(new Set(r.active.map((c) => c.localId))).toEqual(new Set(["c2", "c3"]));
    expect(new Set(r.closed.map((c) => c.localId))).toEqual(new Set(["c1", "c4"]));

    // Totals: AF 4000 + 3000 = 7000; PF 100; only the 2 paid contracts count.
    expect(r.totals.afPaid).toBe(7000);
    expect(r.totals.pfPaid).toBe(100);
    expect(r.totals.totalPaid).toBe(7100);
    expect(r.totals.paidCount).toBe(2);
    db.close();
  });

  test("parses fees from strings and leaves blanks null", () => {
    const db = freshDb();
    insertContract(db, { localId: "c1", status: "Create Project", group: "Closed Fee Ks", cv: { af: "$5,000", pf: "" } });
    const c = getClientContracts(db, "p1").closed[0]!;
    expect(c.af).toBe(5000); // "$5,000" → 5000
    expect(c.pf).toBeNull(); // "" → null
    db.close();
  });

  test("resolves the linked case via the reverse fee_ks link", () => {
    const db = freshDb();
    insertContract(db, { localId: "c1", mondayId: "FK1", status: "Create Project", group: "Closed Fee Ks" });
    insertCase(db, { localId: "of1", boardKey: "_cd_open_forms", name: "Ada - I-485", status: "Filed", feeMondayId: "FK1" });

    const c = getClientContracts(db, "p1").closed[0]!;
    expect(c.linkedCase).toEqual({ boardKey: "_cd_open_forms", name: "Ada - I-485", status: "Filed" });
    db.close();
  });

  test("linkedCase is null when no case points back", () => {
    const db = freshDb();
    insertContract(db, { localId: "c1", mondayId: "FK9", status: "Create Project", group: "Closed Fee Ks" });
    expect(getClientContracts(db, "p1").closed[0]!.linkedCase).toBeNull();
    db.close();
  });
});
