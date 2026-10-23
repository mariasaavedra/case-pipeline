// =============================================================================
// M22 → document-generated: whoever generates the contract becomes the Fee K's
// Assistant, only when nobody is (locally or on Monday right now)
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import Database from "better-sqlite3";
import { initializeSchema } from "@case-pipeline/seed/db/schema";

type Call = { op: string; [k: string]: unknown };
const state = vi.hoisted(() => ({ calls: [] as Call[], liveAssistant: "", failWrite: false }));

vi.mock("../data-source/index.js", () => ({
  dataSource: {
    getColumnText: async (itemId: string, columnId: string) => {
      state.calls.push({ op: "read", itemId, columnId });
      return state.liveAssistant;
    },
    setColumnValues: async (boardId: string, itemId: string, values: Record<string, unknown>) => {
      if (state.failWrite) throw new Error("Monday is down");
      state.calls.push({ op: "columns", boardId, itemId, values });
    },
  },
}));
vi.mock("../db/users-db.js", async () => ({ usersDb: (await import("../staff/test-db.js")).makeRosterDb() }));
vi.mock("../auth/middleware.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as unknown as { user: unknown }).user = { oid: "oid-1", name: "Ana Reyes", preferred_username: "Ana@Firm.com" };
    next();
  },
}));
vi.mock("../audit/log.js", () => ({ auditFromReq: () => {} }));
vi.mock("@case-pipeline/monday", async (orig) => ({
  ...(await orig<typeof import("@case-pipeline/monday")>()),
  fetchWorkspaceUsers: async () => [{ id: "42", name: "Ana Reyes", email: "ana@firm.com" }],
}));

const { registerContractDocumentRoutes, contractAttorneyOptions, pickContractAttorney } = await import("./contract-document.js");
const { usersDb } = await import("../db/users-db.js");
const { createStaff, setRoles, addAlias } = await import("../staff/roster.js");

let db: Database.Database;
let server: Server;
let base: string;

function seed(assistant: string | null) {
  db.prepare(
    `INSERT INTO contracts (batch_id, local_id, monday_item_id, profile_local_id, name, raw_column_values) VALUES (1, 'c1', '555', 'p1', 'Fee K', ?)`,
  ).run(JSON.stringify(assistant ? { assistant: { label: assistant } } : {}));
}
const generated = async () => {
  const res = await fetch(`${base}/api/contracts/c1/document-generated`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ template: "FORMS", format: "pdf" }),
  });
  return ((await res.json()) as { data: { assistant: string } }).data.assistant;
};
const localAssistant = () =>
  (db.prepare("SELECT json_extract(raw_column_values, '$.assistant.label') AS a FROM contracts WHERE local_id = 'c1'").get() as { a: string | null }).a;
const queued = () => (db.prepare("SELECT count(*) AS n FROM write_queue").get() as { n: number }).n;

beforeEach(() => {
  state.calls = [];
  state.liveAssistant = "";
  state.failWrite = false;
  db = new Database(":memory:");
  initializeSchema(db);
  db.prepare("INSERT INTO seed_batches (id, batch_name) VALUES (1, 'test')").run();
  db.prepare("INSERT INTO profiles (batch_id, local_id, monday_item_id, name) VALUES (1, 'p1', '111', 'Ana Pérez')").run();
  db.prepare(
    "INSERT INTO board_columns (board_key, monday_board_id, column_id, title, type, options, position) VALUES ('fee_ks', 'B-FK', 'people__1', 'Assistant', 'people', NULL, 0)",
  ).run();
  const app = express();
  app.use(express.json());
  registerContractDocumentRoutes(app, { db, mondayApiToken: "tok", writeTokenOptions: () => ({ userToken: null, sharedToken: "tok" }) });
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(() => {
  server.close();
  db.close();
});

describe("Fee K assistant auto-assign", () => {
  it("an empty Assistant becomes whoever generated the contract (matched by login e-mail)", async () => {
    seed(null);
    expect(await generated()).toBe("assigned");
    expect(state.calls.find((c) => c.op === "columns")).toEqual({
      op: "columns", boardId: "B-FK", itemId: "555", values: { people__1: { personsAndTeams: [{ id: 42, kind: "person" }] } },
    });
    expect(localAssistant()).toBe("Ana Reyes");
    // Generating again changes nothing.
    state.calls = [];
    expect(await generated()).toBe("kept");
    expect(state.calls).toEqual([]);
  });

  it("never replaces an assistant — whether the local copy or Monday has one", async () => {
    seed("Luis Morales");
    expect(await generated()).toBe("kept");
    expect(state.calls).toEqual([]);

    db.prepare("DELETE FROM contracts").run();
    seed(null);
    state.liveAssistant = "Luis Morales"; // set in Monday since the last sync
    expect(await generated()).toBe("kept");
    expect(state.calls.map((c) => c.op)).toEqual(["read"]);
    expect(localAssistant()).toBeNull();
  });

  it("queues the write when Monday is down, and still shows it locally", async () => {
    seed(null);
    state.failWrite = true;
    expect(await generated()).toBe("queued");
    expect(queued()).toBe(1);
    expect(localAssistant()).toBe("Ana Reyes");
  });
});

describe("contract pre-fill: the client's address", () => {
  const prefillAddress = async () => {
    const res = await fetch(`${base}/api/contracts/c1/document-form`);
    return ((await res.json()) as { data: { address: string; street: string; cityStateZip: string } }).data;
  };
  const setProfile = (address: string | null, mailing: string | null) =>
    db.prepare("UPDATE profiles SET address = ?, raw_column_values = ? WHERE local_id = 'p1'")
      .run(address, JSON.stringify(mailing ? { mailing_address: mailing } : {}));

  it("takes the profile's Address, else its Mailing address, else the Fee K's copy", async () => {
    db.prepare(
      `INSERT INTO contracts (batch_id, local_id, monday_item_id, profile_local_id, name, raw_column_values) VALUES (1, 'c1', '555', 'p1', 'Fee K', ?)`,
    ).run(JSON.stringify({ address: "9 Fee K Rd, Olathe, KS 66061" }));

    setProfile("1 Main St, Topeka, KS 66603", "2 Mail Ave, Lawrence, KS 66044");
    expect(await prefillAddress()).toMatchObject({ address: "1 Main St, Topeka, KS 66603", street: "1 Main St", cityStateZip: "Topeka, KS 66603" });

    setProfile(" ", "554 Oakland AveKansas City, KS 66101");
    expect(await prefillAddress()).toMatchObject({ address: "554 Oakland Ave, Kansas City, KS 66101", street: "554 Oakland Ave", cityStateZip: "Kansas City, KS 66101" });

    setProfile(null, null);
    expect((await prefillAddress()).cityStateZip).toBe("Olathe, KS 66061");
  });
});

describe("contract pre-fill: scope of services", () => {
  it("comes from the Fee K Type (the draft until an admin saves the table)", async () => {
    db.prepare(
      `INSERT INTO contracts (batch_id, local_id, monday_item_id, profile_local_id, name, raw_column_values) VALUES (1, 'c1', '555', 'p1', 'Fee K', ?)`,
    ).run(JSON.stringify({ fee_k_type: { labels: ["N-400 - Naturalization"] } }));
    const res = await fetch(`${base}/api/contracts/c1/document-form`);
    const { data } = (await res.json()) as { data: { contractFor: string[]; scope: Record<string, string> } };
    expect(data.contractFor).toEqual(["N-400 - Naturalization"]);
    expect(data.scope.services).toBe("Prepare and file Form N-400.");
    expect(data.scope.excludedEs).toMatch(/N-336/);
    expect(data).toMatchObject({ formName: "N-400 - Naturalization", formNameEs: "Ciudadanía / naturalización (N-400)" });
  });
});

describe("the attorney pick list", () => {
  const DOCS = [
    { givenName: "Rekha", familyName: "Sharma-Crawford", email: "rekha@firm.com" },
    { givenName: "Michael", familyName: "Sharma-Crawford", email: "michael@firm.com" },
    { givenName: "Only", familyName: "InSettings", email: "only@firm.com" },
  ];
  const staff = [
    { id: 1, name: "Rekha@Sharma- com", email: "rekha@firm.com", active: true, roles: ["attorney" as const] },
    { id: 2, name: "Caitlin Riffer", email: "caitlin@firm.com", active: true, roles: ["attorney" as const] },
    { id: 3, name: "Michael Sharma-Crawford", email: null, active: true, roles: ["attorney" as const] },
    { id: 4, name: "Luis Morales", email: null, active: false, roles: ["attorney" as const] },
    { id: 5, name: "Pat Paralegal", email: "pat@firm.com", active: true, roles: ["paralegal" as const] },
  ];

  it("active roster attorneys, named as Settings → Documents names them, with an e-mail; then Settings-only", () => {
    expect(contractAttorneyOptions(staff, DOCS)).toEqual([
      { name: "Caitlin Riffer", email: "caitlin@firm.com", staffId: 2 },
      { name: "Michael Sharma-Crawford", email: "michael@firm.com", staffId: 3 },
      { name: "Only InSettings", email: "only@firm.com", staffId: null },
      { name: "Rekha Sharma-Crawford", email: "rekha@firm.com", staffId: 1 },
    ]);
  });

  it("the Fee K's attorney label is matched through the roster (Monday's odd names included)", () => {
    const options = contractAttorneyOptions(staff, DOCS);
    const resolve = (n: string) => (n === "Rekha@Sharma- com" ? { id: 1 } : null);
    expect(pickContractAttorney("Rekha@Sharma- com, Lucy Betteridge", options, resolve)?.name).toBe("Rekha Sharma-Crawford");
    expect(pickContractAttorney("Nobody, Caitlin Riffer", options, resolve)?.email).toBe("caitlin@firm.com");
    expect(pickContractAttorney("Nobody", options, resolve)).toBeNull();
    expect(pickContractAttorney(null, options, resolve)).toBeNull();
  });

  it("the pre-fill picks Rekha from her Monday label and gives her e-mail", async () => {
    const id = createStaff(usersDb, { name: "Rekha@Sharma- com", email: "rekha@sharma-crawford.com" });
    setRoles(usersDb, id, ["attorney"]);
    addAlias(usersDb, id, "Rekha@Sharma- com", { ifFree: true });
    db.prepare(
      `INSERT INTO contracts (batch_id, local_id, monday_item_id, profile_local_id, name, raw_column_values) VALUES (1, 'c1', '555', 'p1', 'Fee K', ?)`,
    ).run(JSON.stringify({ attorney: { label: "Rekha@Sharma- com" } }));
    const res = await fetch(`${base}/api/contracts/c1/document-form`);
    const { data } = (await res.json()) as { data: { attorneyName: string; attorneyEmail: string; attorneys: { name: string }[] } };
    expect(data.attorneyEmail).toBe("rekha@sharma-crawford.com");
    expect(data.attorneys.map((a) => a.name)).toContain(data.attorneyName);
  });
});
