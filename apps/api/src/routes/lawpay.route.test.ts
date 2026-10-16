// =============================================================================
// LawPay → Fee K, end to end with Monday, Slack and users.db stubbed
// =============================================================================
// M21 records the links it hands out; a LawPay receipt e-mail then finds the
// Fee K by the payment's reference, posts a note + Slack + a Monday bell, and
// when every fee is paid sets "Paid needs action" and moves it to Paid Fee Ks.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import Database from "better-sqlite3";
import { initializeSchema } from "@case-pipeline/seed/db/schema";

type Call = { op: string; [k: string]: unknown };
const state = vi.hoisted(() => ({ calls: [] as Call[], slack: [] as [string, string][], moveFails: false }));

vi.mock("../db/users-db.js", async () => {
  const Db = (await import("better-sqlite3")).default;
  const usersDb = new Db(":memory:");
  usersDb.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, azure_oid TEXT, email TEXT, name TEXT);
    CREATE TABLE payment_links (id INTEGER PRIMARY KEY, created_at TEXT NOT NULL DEFAULT (datetime('now')), user_id INTEGER,
      contract_local_id TEXT NOT NULL, contract_monday_id TEXT, client_name TEXT NOT NULL, fee_type TEXT NOT NULL,
      amount REAL NOT NULL, reference TEXT NOT NULL, method TEXT, channel TEXT NOT NULL, paid_at TEXT, paid_event_id INTEGER);
    CREATE UNIQUE INDEX idx_payment_links_ref ON payment_links(contract_local_id, reference);
    CREATE TABLE lawpay_events (id INTEGER PRIMARY KEY, received_at TEXT NOT NULL DEFAULT (datetime('now')), source TEXT UNIQUE, body TEXT NOT NULL,
      transaction_id TEXT, reference TEXT, amount REAL, outcome TEXT, result TEXT, contract_local_id TEXT, error TEXT);
    INSERT INTO users (id, azure_oid, email, name) VALUES (7, 'oid-7', 'mayra@firm.com', 'Mayra Ruiz');
  `);
  return { usersDb };
});
vi.mock("../db/user-context.js", () => ({ currentUserId: () => 7 }));
vi.mock("../auth/middleware.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as unknown as { user: unknown }).user = { oid: "oid-7", name: "Mayra Ruiz" };
    next();
  },
}));
vi.mock("../audit/log.js", () => ({ auditFromReq: () => {}, recordAudit: () => {} }));
vi.mock("../notify/slack.js", async (orig) => ({
  ...(await orig<typeof import("../notify/slack.js")>()),
  notifyEvent: async (key: string, text: string) => { state.slack.push([key, text]); return true; },
}));
vi.mock("../data-source/index.js", () => ({
  dataSource: {
    postUpdate: async (itemId: string, body: string) => { state.calls.push({ op: "update", itemId, body }); return "u1"; },
    setColumnValues: async (boardId: string, itemId: string, values: Record<string, unknown>) => { state.calls.push({ op: "columns", boardId, itemId, values }); },
    moveItem: async (boardId: string, groupId: string, itemId: string) => {
      if (state.moveFails) throw new Error("Monday down");
      state.calls.push({ op: "move", boardId, groupId, itemId });
    },
  },
}));
vi.mock("@case-pipeline/monday", async (orig) => ({
  ...(await orig<typeof import("@case-pipeline/monday")>()),
  fetchWorkspaceUsers: async () => [{ id: "42", name: "Mayra Ruiz", email: "mayra@firm.com" }],
  fetchBoardStructure: async () => ({ id: "B-FK", name: "Fee Ks", columns: [], groups: [{ id: "g_pending", title: "Pending Fee Ks" }, { id: "g_paid", title: "Paid Fee Ks" }] }),
  createNotification: async (userId: string, itemId: string, text: string) => { state.calls.push({ op: "notify", userId, itemId, text }); },
}));

const { ingestLawPayReceipts, registerLawPayRoutes } = await import("./lawpay.js");
const { usersDb } = await import("../db/users-db.js");

let db: Database.Database;
let server: Server;
let base: string;

beforeEach(() => {
  state.calls = [];
  state.slack = [];
  state.moveFails = false;
  usersDb.exec("DELETE FROM payment_links; DELETE FROM lawpay_events;");
  db = new Database(":memory:");
  initializeSchema(db);
  db.prepare("INSERT INTO seed_batches (id, batch_name) VALUES (1, 'test')").run();
  db.prepare("INSERT INTO profiles (batch_id, local_id, monday_item_id, name) VALUES (1, 'p1', '111', 'Ana LOPEZ')").run();
  db.prepare(`INSERT INTO contracts (batch_id, local_id, monday_item_id, profile_local_id, name, group_title, raw_column_values)
    VALUES (1, 'c1', '555', 'p1', 'Fee K', 'Pending Fee Ks', ?)`).run(JSON.stringify({
    contract_stage: { label: "Payment link sent" }, contract_for: { labels: ["I-212"] }, af: 4000, ff: 1175,
  }));
  db.prepare("INSERT INTO board_columns (board_key, monday_board_id, column_id, title, type, options, position) VALUES ('fee_ks', 'B-FK', 'deal_stage', 'Contract Stage', 'status', '[]', 0)").run();
  const app = express();
  app.use(express.json());
  registerLawPayRoutes(app, { db });
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(() => {
  server.close();
  db.close();
});

const AF = "ANA LOPEZ I-212 - AF 4120.00";
const FF = "ANA LOPEZ I-212 - FF 1210.25";
const record = () => fetch(`${base}/api/contracts/c1/payment-links`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ channel: "email", method: "credit", links: [{ fee: "AF", amount: 4120, reference: AF }, { fee: "FF", amount: 1210.25, reference: FF }] }),
});
let mail = 0;
/** A receipt e-mail as the mailbox job hands it over. */
const pay = async (reference: string, cents: number, id: string, opts: { outcome?: "completed" | "refunded"; messageId?: string } = {}) =>
  (await ingestLawPayReceipts({ db, mondayApiToken: "tok" }, [{
    messageId: opts.messageId ?? `msg-${++mail}`, receivedAt: null, transactionId: id, reference, amount: cents / 100,
    outcome: opts.outcome ?? "completed", method: "visa", payer: "Maria Test", account: "SCAL Operating", paidOn: null,
  }]))[0];
const local = () => db.prepare("SELECT group_title AS g, json_extract(raw_column_values, '$.contract_stage.label') AS s FROM contracts WHERE local_id = 'c1'").get() as { g: string; s: string };

describe("LawPay payments", () => {
  it("each payment: note + Slack + bell; all paid: stage → Paid needs action, moved to Paid Fee Ks", async () => {
    expect((await record()).status).toBe(200);

    expect(await pay(AF, 412000, "t1")).toBe("matched");
    expect(String(state.calls.find((c) => c.op === "update")?.body)).toContain("LawPay payment received: Attorney fee $4,120.00 (visa)");
    expect(state.calls.find((c) => c.op === "notify")).toMatchObject({ userId: "42", itemId: "555" });
    expect(state.slack.map(([k]) => k)).toEqual(["payment_received"]);
    expect(state.calls.some((c) => c.op === "move")).toBe(false);
    expect(local()).toEqual({ g: "Pending Fee Ks", s: "Payment link sent" });

    state.calls = [];
    await pay(FF, 121025, "t2");
    expect(state.calls.find((c) => c.op === "columns")).toMatchObject({ itemId: "555", values: { deal_stage: { label: "Paid needs action" } } });
    expect(state.calls.find((c) => c.op === "move")).toEqual({ op: "move", boardId: "B-FK", groupId: "g_paid", itemId: "555" });
    expect(String(state.calls.find((c) => c.op === "update")?.body)).toContain("Fully paid: Contract Stage → Paid needs action, moved to Paid Fee Ks");
    expect(state.slack[1]![1]).toContain("fully paid");
    expect(local()).toEqual({ g: "Paid Fee Ks", s: "Paid needs action" });

    // A second copy of the receipt (another e-mail, same transaction): nothing new.
    state.calls = [];
    expect(await pay(FF, 121025, "t2")).toBe("duplicate");
    expect(state.calls).toEqual([]);
    // The same e-mail seen again by the next run: skipped before anything.
    expect(await pay(FF, 121025, "t2", { messageId: "msg-2" })).toBeUndefined();
  });

  it("links made by hand: matched by the client's name anywhere in the reference", async () => {
    await pay("NORA TEST FOR ANA LOPEZ ADMIN FEE - AF 4000", 400000, "t9");
    expect(String(state.calls.find((c) => c.op === "update")?.body)).toContain("Attorney fee $4,000.00");
    expect(state.calls.some((c) => c.op === "move")).toBe(false); // FF still owed (Monday has FF $1,175)
  });

  it("the Fee K code in the reference finds it alone — no recorded link, not even the client's name", async () => {
    const id = 18323456789;
    db.prepare(`INSERT INTO contracts (batch_id, local_id, monday_item_id, profile_local_id, name, group_title, raw_column_values)
      VALUES (1, 'c2', ?, 'p1', 'Fee K 2', 'Pending Fee Ks', ?)`).run(String(id), JSON.stringify({ contract_stage: { label: "Payment link sent" }, af: 900 }));
    const ref = `SOMEONE PAYING K${id.toString(36).toUpperCase()} - AF 900`;
    expect(await pay(ref, 90000, "k1")).toBe("fully_paid"); // AF was its only fee
    expect(state.calls.find((c) => c.op === "move")).toMatchObject({ itemId: String(id), groupId: "g_paid" });
    expect((usersDb.prepare("SELECT channel FROM payment_links WHERE contract_local_id = 'c2'").get() as { channel: string }).channel).toBe("matched-by-code");
  });

  it("no matching Fee K → Slack 'Payment to match', nothing on Monday", async () => {
    await pay("SOMEONE ELSE - AF 900.00", 90000, "t5");
    expect(state.slack.map(([k]) => k)).toEqual(["payment_unmatched"]);
    expect(state.calls).toEqual([]);
  });

  it("a stage changed by hand is left; a failed group move is said in the note", async () => {
    db.prepare("UPDATE contracts SET raw_column_values = json_set(raw_column_values, '$.contract_stage.label', 'HOLD') WHERE local_id = 'c1'").run();
    await record();
    await pay(AF, 412000, "a");
    await pay(FF, 121025, "b");
    expect(state.calls.some((c) => c.op === "columns" || c.op === "move")).toBe(false);
    expect(state.calls.map((c) => String(c.body ?? "")).join("\n")).toContain('("HOLD") was left as it is');

    db.prepare("UPDATE contracts SET raw_column_values = json_set(raw_column_values, '$.contract_stage.label', 'Payment link sent') WHERE local_id = 'c1'").run();
    usersDb.exec("DELETE FROM payment_links; DELETE FROM lawpay_events;");
    state.calls = [];
    state.moveFails = true;
    await record();
    await pay(AF, 412000, "c");
    await pay(FF, 121025, "d");
    expect(state.calls.map((c) => String(c.body ?? "")).join("\n")).toContain("Moving it to Paid Fee Ks failed — please move it by hand");
  });

  it("refunds are recorded only; bad link payloads are refused", async () => {
    expect(await pay(AF, 412000, "r1", { outcome: "refunded" })).toBe("refunded");
    expect(state.calls).toEqual([]);
    const bad = await fetch(`${base}/api/contracts/c1/payment-links`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel: "email", links: [{ fee: "AF", reference: "nonsense" }] }) });
    expect(bad.status).toBe(400);
  });
});
