// =============================================================================
// Contract info — create (M11 / M2) and M25 Edit contract, end to end
// =============================================================================
// Monday is mocked at the dataSource seam. Proves the five things a contract
// is generated from are required on create, that the attorney lands on the
// Fee K's People column, and that the client's e-mail / address are written to
// the PROFILE (only when changed) — on create and from M25.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import Database from "better-sqlite3";
import { initializeSchema } from "@case-pipeline/seed/db/schema";

type Call = { op: string; [k: string]: unknown };
let calls: Call[] = [];

vi.mock("../data-source/index.js", () => ({
  dataSource: {
    createItem: async (boardId: string, itemName: string, columnValues: Record<string, unknown>) => {
      calls.push({ op: "create", boardId, itemName, columnValues });
      return "9001";
    },
    setColumnValues: async (boardId: string, itemId: string, values: Record<string, unknown>) => {
      calls.push({ op: "columns", boardId, itemId, values });
    },
    postUpdate: async () => "u1",
    createTimelineItem: async () => "t1",
  },
}));
vi.mock("../auth/middleware.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as unknown as { user: unknown }).user = { oid: "oid-1", name: "Ana Reyes", preferred_username: "ana@firm.com" };
    next();
  },
}));
vi.mock("../audit/log.js", () => ({ auditFromReq: () => {}, recordAudit: () => {} }));
vi.mock("../documents/document-settings.js", () => ({
  loadDocumentSettings: () => ({ attorneys: [{ givenName: "Jane", familyName: "Attorney", email: "jane@firm.com" }] }),
}));
vi.mock("@case-pipeline/monday", async (orig) => ({
  ...(await orig<typeof import("@case-pipeline/monday")>()),
  fetchWorkspaceUsers: async () => [
    { id: "77", name: "Jane A.", email: "jane@firm.com" },
    { id: "88", name: "Bob Lawyer", email: "bob@firm.com" },
  ],
}));

const { registerProfileWriteRoutes } = await import("./profile-write.js");
const { registerContractFeesRoutes } = await import("./contract-fees.js");

let db: Database.Database;
let server: Server;
let base: string;

beforeEach(() => {
  calls = [];
  db = new Database(":memory:");
  initializeSchema(db);
  db.prepare("INSERT INTO seed_batches (id, batch_name) VALUES (1, 'test')").run();
  db.prepare(
    `INSERT INTO profiles (batch_id, local_id, monday_item_id, name, email, address, raw_column_values)
     VALUES (1, 'p1', '111', 'Mayra TEST', 'old@mail.com', '', ?)`,
  ).run(JSON.stringify({ attorney: { label: "Jane Attorney" } }));
  db.prepare(
    `INSERT INTO contracts (batch_id, local_id, monday_item_id, profile_local_id, name, group_title, raw_column_values)
     VALUES (1, 'c1', '555', 'p1', 'Mayra TEST — Bond', 'Pending Fee Ks', ?)`,
  ).run(JSON.stringify({ contract_for: { labels: ["Bond"] }, af: "3500", attorney: { label: "Jane Attorney" } }));
  const col = db.prepare(
    "INSERT INTO board_columns (board_key, monday_board_id, column_id, title, type, options, position) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  col.run("fee_ks", "B-FK", "dropdown_ct", "Contract for…", "dropdown", JSON.stringify([{ label: "Bond" }, { label: "I-130" }]), 0);
  col.run("fee_ks", "B-FK", "deal_value", "AF", "numbers", null, 1);
  col.run("fee_ks", "B-FK", "numbers__1", "FF", "numbers", null, 2);
  col.run("fee_ks", "B-FK", "numbers5__1", "PF", "numbers", null, 3);
  col.run("fee_ks", "B-FK", "link_p", "Profile", "board_relation", null, 4);
  col.run("fee_ks", "B-FK", "deal_owner", "Attorney", "people", null, 5);
  col.run("profiles", "B-PROF", "email__1", "Email", "email", null, 0);
  col.run("profiles", "B-PROF", "text_mkrkrsgj", "Physical Address", "text", null, 1);

  const app = express();
  app.use(express.json());
  const deps = { db, mondayApiToken: "shared", writeTokenOptions: () => ({ sharedToken: "shared" }) as never };
  registerProfileWriteRoutes(app, deps);
  registerContractFeesRoutes(app, deps);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(() => {
  server.close();
  db.close();
});

const call = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(`${base}${path}`, {
    method, headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: (await res.json()) as { data?: Record<string, unknown>; error?: string } };
};
const complete = { caseType: "I-130", af: 1500, attorney: "Jane Attorney", email: "new@mail.com", address: "123 Main St, Kansas City, MO 64105" };

describe("GET /api/contract-info", () => {
  it("pre-fills from the profile and lists the attorneys", async () => {
    const r = await call("GET", "/api/contract-info?profile=p1");
    expect(r.json.data).toEqual({ attorneys: ["Jane Attorney"], email: "old@mail.com", address: "", attorney: "Jane Attorney" });
  });
});

describe("POST /api/profiles/:id/contracts — all five required", () => {
  it.each([
    [{ af: undefined }, /attorney fee/i],
    [{ attorney: "" }, /attorney is required/i],
    [{ email: "" }, /e-mail is required/i],
    [{ email: "nope" }, /not an e-mail/i],
    [{ address: " " }, /address is required/i],
  ])("refuses %o", async (patch, msg) => {
    const r = await call("POST", "/api/profiles/p1/contracts", { ...complete, ...patch });
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(msg);
    expect(calls).toEqual([]);
  });

  it("refuses an attorney who isn't a Monday user", async () => {
    const r = await call("POST", "/api/profiles/p1/contracts", { ...complete, attorney: "Nobody Here" });
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/not a Monday user/);
  });

  it("puts the attorney on the Fee K and the changed contact on the profile", async () => {
    const r = await call("POST", "/api/profiles/p1/contracts", complete);
    expect(r.status).toBe(200);
    const create = calls.find((c) => c.op === "create")!;
    // Matched by the Settings e-mail, not the Monday display name.
    expect(create.columnValues).toMatchObject({ deal_owner: { personsAndTeams: [{ id: 77, kind: "person" }] }, deal_value: 1500 });
    expect(calls.find((c) => c.op === "columns")).toEqual({
      op: "columns", boardId: "B-PROF", itemId: "111",
      values: { email__1: { email: "new@mail.com", text: "new@mail.com" }, text_mkrkrsgj: "123 Main St, Kansas City, MO 64105" },
    });
    const p = db.prepare("SELECT email, address FROM profiles WHERE local_id = 'p1'").get();
    expect(p).toEqual({ email: "new@mail.com", address: "123 Main St, Kansas City, MO 64105" });
  });

  it("doesn't touch the profile when the contact is unchanged", async () => {
    db.prepare("UPDATE profiles SET address = '123 Main St, Kansas City, MO 64105', email = 'new@mail.com'").run();
    await call("POST", "/api/profiles/p1/contracts", { ...complete, email: "NEW@mail.com" });
    expect(calls.filter((c) => c.op === "columns")).toEqual([]);
  });
});

describe("PATCH /api/contracts/:id/fees — M25 Edit contract", () => {
  it("changes the attorney on the Fee K", async () => {
    const r = await call("PATCH", "/api/contracts/c1/fees", { attorney: "Bob Lawyer", from: { attorney: ["Jane Attorney"] } });
    expect(r.status).toBe(200);
    expect(calls).toEqual([{ op: "columns", boardId: "B-FK", itemId: "555", values: { deal_owner: { personsAndTeams: [{ id: 88, kind: "person" }] } } }]);
  });

  it("fixes the client's address on the profile only", async () => {
    const r = await call("PATCH", "/api/contracts/c1/fees", { address: "1 Oak Ave", from: { address: "" } });
    expect(r.status).toBe(200);
    expect(calls).toEqual([{ op: "columns", boardId: "B-PROF", itemId: "111", values: { text_mkrkrsgj: "1 Oak Ave" } }]);
    // P14 reads the profile's copy, so "Missing: Address" clears before the next sync.
    expect(db.prepare("SELECT address FROM profiles WHERE local_id = 'p1'").get()).toEqual({ address: "1 Oak Ave" });
  });

  it("fees and attorney go in one Fee K write", async () => {
    await call("PATCH", "/api/contracts/c1/fees", { fees: { ff: 675 }, attorney: "Bob Lawyer", from: { ff: null, attorney: ["Jane Attorney"] } });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.values).toEqual({ numbers__1: "675", deal_owner: { personsAndTeams: [{ id: 88, kind: "person" }] } });
  });

  it("refuses stale values, emptying the e-mail, and no change", async () => {
    expect((await call("PATCH", "/api/contracts/c1/fees", { email: "x@y.com", from: { email: "someone@else.com" } })).status).toBe(409);
    expect((await call("PATCH", "/api/contracts/c1/fees", { email: "" })).status).toBe(400);
    expect((await call("PATCH", "/api/contracts/c1/fees", { attorney: "Jane Attorney", email: "old@mail.com" })).json.error).toBe("Nothing changed");
    expect(calls).toEqual([]);
  });
});
