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

const { registerContractDocumentRoutes } = await import("./contract-document.js");

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
