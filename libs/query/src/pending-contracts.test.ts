// =============================================================================
// Pending Contracts Query Tests
// =============================================================================

import { test, expect, describe } from "vitest";
import Database from "better-sqlite3";
type DatabaseInstance = InstanceType<typeof Database>;
import { initializeSchema } from "@case-pipeline/seed/db/schema";
import { getPendingContracts, nextContractStep, NO_CONTRACT_STAGE } from "./pending-contracts";

// =============================================================================
// Helpers
// =============================================================================

const TODAY = "2026-09-30";

function freshDb(): DatabaseInstance {
  const db = new Database(":memory:");
  initializeSchema(db);
  db.prepare("INSERT INTO seed_batches (batch_name, seed_value, status) VALUES ('test', 1, 'complete')").run();
  db.prepare("INSERT INTO profiles (batch_id, local_id, name) VALUES (1, 'p1', 'Ana LOPEZ')").run();
  return db;
}

interface FeeKOpts {
  localId: string;
  group?: string;
  stage?: string;
  attorney?: string;
  added?: string;
  sent?: string;
  paymentLink?: string;
  af?: number | string;
  ff?: number | string;
  contractFor?: string[];
  deleted?: boolean;
}

function insertFeeK(db: DatabaseInstance, o: FeeKOpts) {
  const cv = {
    ...(o.stage ? { contract_stage: { label: o.stage } } : {}),
    ...(o.attorney ? { attorney: { label: o.attorney } } : {}),
    ...(o.added ? { contract_added_on: { date: o.added } } : {}),
    ...(o.sent ? { contract_sent_on: { date: o.sent } } : {}),
    ...(o.paymentLink ? { payment_link_sent_on: { date: o.paymentLink } } : {}),
    ...(o.af !== undefined ? { af: o.af } : {}),
    ...(o.ff !== undefined ? { ff: o.ff } : {}),
    ...(o.contractFor ? { contract_for: { labels: o.contractFor } } : {}),
  };
  db.prepare(`
    INSERT INTO contracts (batch_id, local_id, profile_local_id, name, group_title, raw_column_values, deleted_at)
    VALUES (1, ?, 'p1', ?, ?, ?, ?)
  `).run(o.localId, `Fee K ${o.localId}`, o.group ?? "Pending Fee Ks", JSON.stringify(cv), o.deleted ? "2026-09-01" : null);
}

const get = (db: DatabaseInstance) => getPendingContracts(db, { today: TODAY });
const byId = (db: DatabaseInstance) => Object.fromEntries(get(db).contracts.map((c) => [c.localId, c]));

// =============================================================================
// Tests
// =============================================================================

describe("getPendingContracts", () => {
  test("only live Pending Fee Ks are returned", () => {
    const db = freshDb();
    insertFeeK(db, { localId: "pending" });
    insertFeeK(db, { localId: "paid", group: "Paid Fee Ks" });
    insertFeeK(db, { localId: "gone", deleted: true });
    expect(get(db).contracts.map((c) => c.localId)).toEqual(["pending"]);
    db.close();
  });

  test("age counts from the sent date, else the added date (30 / 60 by default)", () => {
    const db = freshDb();
    insertFeeK(db, { localId: "sentOld", added: "2026-06-01", sent: "2026-07-20" });
    insertFeeK(db, { localId: "addedOnly", added: "2026-08-22" });
    insertFeeK(db, { localId: "fresh", sent: "2026-09-28" });
    insertFeeK(db, { localId: "noDates" });
    const c = byId(db);
    expect(c.sentOld).toMatchObject({ ageDays: 72, agedFrom: "sent", ageLevel: "late" });
    expect(c.addedOnly).toMatchObject({ ageDays: 39, agedFrom: "added", ageLevel: "waiting" });
    expect(c.fresh).toMatchObject({ ageDays: 2, ageLevel: "fresh" });
    expect(c.noDates).toMatchObject({ ageDays: null, agedFrom: null, ageLevel: "unknown" });
    expect(get(db).contracts.map((x) => x.localId)).toEqual(["sentOld", "addedOnly", "fresh", "noDates"]);
    db.close();
  });

  test("stages in pipeline order, HOLD after the active stages, unset last", () => {
    const db = freshDb();
    insertFeeK(db, { localId: "a", stage: "HOLD" });
    insertFeeK(db, { localId: "b", stage: "Payment link sent" });
    insertFeeK(db, { localId: "c" });
    insertFeeK(db, { localId: "d", stage: "Needs to be sent" });
    insertFeeK(db, { localId: "e", stage: "Something New" });
    expect(get(db).stages).toEqual(["Needs to be sent", "Payment link sent", "Something New", "HOLD", NO_CONTRACT_STAGE]);
    db.close();
  });

  test("attorneys split, stray e-mail fragments dropped; fees parsed", () => {
    const db = freshDb();
    insertFeeK(db, { localId: "a", attorney: "William Hanna, Michael Sharma-Crawford", af: 4000, ff: "2325", contractFor: ["I-130"] });
    insertFeeK(db, { localId: "b", attorney: "Rekha@Sharma- com", af: "" });
    const c = byId(db);
    expect(c.a).toMatchObject({
      attorneys: ["William Hanna", "Michael Sharma-Crawford"],
      attorneyFee: 4000,
      filingFee: 2325,
      contractFor: ["I-130"],
      clientName: "Ana LOPEZ",
    });
    expect(c.b).toMatchObject({ attorneys: [], attorneyFee: null, filingFee: null });
    db.close();
  });
});

describe("nextContractStep", () => {
  test("follows the Acrobat signing order, then the payment link", () => {
    expect(nextContractStep(null)).toBe("sent_for_signature");
    expect(nextContractStep("Ready to be sent")).toBe("sent_for_signature");
    expect(nextContractStep("Atty Reviewing")).toBe("attorney_signed");
    expect(nextContractStep("Sent to Client")).toBe("client_signed");
    expect(nextContractStep("Needs Payment Link")).toBe("payment_link_sent");
    expect(nextContractStep("HOLD")).toBeNull();
    expect(nextContractStep("Payment link sent")).toBeNull();
  });
});
