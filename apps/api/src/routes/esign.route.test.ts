// =============================================================================
// Adobe Sign via Zapier — end to end with Monday mocked at the dataSource seam
// =============================================================================
// The event rules are in esign/events.test.ts. This drives the real routes:
// send → Zap 1 gets the PDF link → "sent" → attorney signs → client signs, and
// checks the stage writes, notes and notification that actually go out.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import Database from "better-sqlite3";
import { initializeSchema } from "@case-pipeline/seed/db/schema";

type Call = { op: string; [k: string]: unknown };
let calls: Call[] = [];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "esign-test-"));

vi.mock("../paths.js", () => ({ DATA_DIR: tmp, REPO_ROOT: tmp }));
const efile = vi.hoisted(() => ({ calls: [] as [number, string][], result: { ok: true, folder: "FEE Ks", name: "x.pdf", webUrl: "https://sp/x" } as Record<string, unknown> }));
vi.mock("../esign/efile.js", () => ({
  fileSignedContract: (id: number, name: string) => {
    efile.calls.push([id, name]);
    return Promise.resolve(efile.result);
  },
}));
vi.mock("../data-source/index.js", () => ({
  dataSource: {
    postUpdate: async (itemId: string, body: string) => {
      calls.push({ op: "update", itemId, body });
      return "u1";
    },
    createTimelineItem: async (input: { itemId: string; title: string; customActivityId: string; content: string }) => {
      calls.push({ op: "activity", ...input });
      return "t1";
    },
    setColumnValues: async (_boardId: string, itemId: string, values: Record<string, unknown>) => {
      calls.push({ op: "columns", itemId, values });
    },
    addFile: async (itemId: string, columnId: string, fileName: string) => {
      calls.push({ op: "file", itemId, columnId, fileName });
      return "asset-1";
    },
  },
}));
vi.mock("../db/users-db.js", async () => ({ usersDb: (await import("../staff/test-db.js")).makeRosterDb() }));
vi.mock("../auth/middleware.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as unknown as { user: unknown }).user = { oid: "oid-1", name: "Ana Reyes", preferred_username: "ana@firm.com" };
    next();
  },
}));
vi.mock("../audit/log.js", () => ({ auditFromReq: () => {}, recordAudit: () => {} }));
vi.mock("./monday-oauth.js", () => ({ getUserMondayToken: () => null, markMondayTokenRejected: () => {} }));
vi.mock("@case-pipeline/monday", async (orig) => ({
  ...(await orig<typeof import("@case-pipeline/monday")>()),
  fetchWorkspaceUsers: async () => [{ id: "42", name: "Ana Reyes", email: "ana@firm.com" }],
  createNotification: async (userId: string, itemId: string, text: string) => {
    calls.push({ op: "notify", userId, itemId, text });
  },
}));

const { registerEsignRoutes, registerEsignPublicRoutes } = await import("./esign.js");

const STAGES = ["Needs to be sent", "Atty Reviewing", "Sent to Client", "Needs Payment Link"];
let db: Database.Database;
let server: Server;
let zapier: Server;
let base: string;
let hookBodies: Record<string, string>[] = [];

beforeEach(async () => {
  calls = [];
  hookBodies = [];
  db = new Database(":memory:");
  initializeSchema(db);
  db.prepare("INSERT INTO seed_batches (id, batch_name) VALUES (1, 'test')").run();
  db.prepare("INSERT INTO profiles (batch_id, local_id, monday_item_id, name) VALUES (1, 'p1', '111', 'Ana Pérez')").run();
  db.prepare(
    `INSERT INTO contracts (batch_id, local_id, monday_item_id, profile_local_id, name, raw_column_values)
     VALUES (1, 'c1', '555', 'p1', 'Fee K', ?)`,
  ).run(JSON.stringify({ contract_stage: { label: "Needs to be sent" } }));
  const col = db.prepare(
    "INSERT INTO board_columns (board_key, monday_board_id, column_id, title, type, options, position) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  col.run("fee_ks", "B-FK", "deal_stage", "Contract Stage", "status", JSON.stringify(STAGES.map((label, index) => ({ index, label }))), 0);
  col.run("fee_ks", "B-FK", "date1__1", "Contract Sent On", "date", null, 1);
  col.run("fee_ks", "B-FK", "date8__1", "Signed Contract Received On", "date", null, 2);

  const hook = express();
  hook.use(express.json());
  hook.post("/hook", (req, res) => { hookBodies.push(req.body as Record<string, string>); res.json({ status: "success" }); });
  zapier = hook.listen(0);

  const app = express();
  app.use(express.json());
  const deps = { db, mondayApiToken: "shared", writeTokenOptions: () => ({ sharedToken: "shared" }) as never };
  registerEsignPublicRoutes(app, deps);
  registerEsignRoutes(app, deps);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.ZAPIER_ESIGN_HOOK_URL = `http://127.0.0.1:${(zapier.address() as AddressInfo).port}/hook`;
  process.env.ZAPIER_ESIGN_SECRET = "s3cret";
  process.env.API_URL = base;
  delete process.env.SLACK_WEBHOOK_URL;
});
afterEach(() => {
  server.close();
  zapier.close();
  db.close();
});

const send = (q = "attorneyEmail=atty@firm.com&clientEmail=ana@mail.com") =>
  fetch(`${base}/api/contracts/c1/esign?${q}`, { method: "POST", headers: { "Content-Type": "application/pdf" }, body: "%PDF-1.4 test" });
const event = async (body: Record<string, unknown>, secret = "s3cret") => {
  const res = await fetch(`${base}/api/webhooks/zapier/${secret}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
};
const stage = () =>
  (db.prepare("SELECT json_extract(raw_column_values, '$.contract_stage.label') AS s FROM contracts WHERE local_id = 'c1'").get() as { s: string }).s;

describe("Adobe Sign via Zapier", () => {
  it("sends, follows both signatures, and notifies the sender", async () => {
    const r = await send();
    expect(r.status).toBe(200);
    expect(stage()).toBe("Atty Reviewing");
    expect(hookBodies).toHaveLength(1);
    const hook = hookBodies[0]!;
    expect(hook).toMatchObject({ ref: "CP-1", attorneyEmail: "atty@firm.com", clientEmail: "ana@mail.com", agreementName: "Fee K - Ana Pérez [CP-1]" });
    expect(calls.find((c) => c.op === "update")?.body).toContain("Ana Reyes");
    // …and on the client's profile timeline (E&A), as a Contract note.
    expect(calls.find((c) => c.op === "activity")).toMatchObject({ itemId: "111", title: "Contract sent for signature" });

    // Zap 1 downloads the PDF from the private link.
    const pdf = await fetch(hook.pdfUrl!);
    expect(pdf.status).toBe(200);
    expect(await pdf.text()).toBe("%PDF-1.4 test");

    // A second send while it's out is refused.
    expect((await send()).status).toBe(409);

    expect((await event({ event: "sent", ref: "CP-1", agreementId: "A1" })).json).toMatchObject({ applied: true, status: "out_for_signature" });

    calls = [];
    await event({ event: "AGREEMENT_ACTION_COMPLETED", agreementId: "A1", participantEmail: "atty@firm.com" });
    expect(stage()).toBe("Sent to Client");
    expect(calls.find((c) => c.op === "columns")?.values).toMatchObject({ deal_stage: { label: "Sent to Client" }, date1__1: { date: expect.any(String) } });

    calls = [];
    // The client's own signature event changes nothing; completion does.
    expect((await event({ event: "AGREEMENT_ACTION_COMPLETED", agreementId: "A1", participantEmail: "ana@mail.com" })).json.applied).toBe(false);
    await event({ event: "AGREEMENT_WORKFLOW_COMPLETED", agreementName: "Fee K - Ana Pérez [CP-1]" });
    expect(stage()).toBe("Needs Payment Link");
    expect(calls.filter((c) => c.op === "activity").map((c) => c.title)).toEqual(["Contract signed"]);
    expect(calls.find((c) => c.op === "notify")).toMatchObject({ userId: "42", itemId: "555" });

    // Zapier retries are harmless.
    calls = [];
    expect((await event({ event: "AGREEMENT_WORKFLOW_COMPLETED", agreementId: "A1" })).json.applied).toBe(false);
    expect(calls).toEqual([]);
  });

  it("rejected: note + notification, stage left alone, and a new send is allowed", async () => {
    await send();
    calls = [];
    const r = await event({ event: "AGREEMENT_REJECTED", ref: "CP-1" });
    expect(r.json).toMatchObject({ applied: true, status: "rejected" });
    expect(stage()).toBe("Atty Reviewing");
    expect(calls.map((c) => c.op).sort()).toEqual(["activity", "notify", "update"]);
    expect(calls.find((c) => c.op === "activity")).toMatchObject({ itemId: "111", title: "Contract rejected" });
    expect(String(calls.find((c) => c.op === "update")?.body)).toContain("rejected");
  });

  it("refuses a wrong secret and ignores agreements it didn't send", async () => {
    expect((await event({ event: "sent" }, "nope")).status).toBe(401);
    expect((await event({ event: "AGREEMENT_WORKFLOW_COMPLETED", agreementId: "unknown" })).json).toMatchObject({ ignored: "no matching contract" });
  });

  it("nothing is sent when Zapier refuses, and the PDF link is dead for unknown tokens", async () => {
    process.env.ZAPIER_ESIGN_HOOK_URL = `${base}/nowhere`;
    const r = await send();
    expect(r.status).toBe(502);
    expect(stage()).toBe("Needs to be sent");
    expect((await fetch(`${base}/api/esign/files/${"x".repeat(32)}/a.pdf`)).status).toBe(404);
  });

  it("names it Client - Matter - date, and files the signed copy in the E-File", async () => {
    const r = await send(`attorneyEmail=atty@firm.com&clientEmail=ana@mail.com&documentName=${encodeURIComponent("Ana Pérez - I-212 - 10-15-2026")}`);
    expect(r.status).toBe(200);
    expect(hookBodies[0]).toMatchObject({ agreementName: "Ana Pérez - I-212 - 10-15-2026 [CP-1]", fileName: "Ana Pérez - I-212 - 10-15-2026.pdf" });
    expect(hookBodies[0]!.pdfUrl).toMatch(/\/Ana%20P%C3%A9rez%20-%20I-212%20-%2010-15-2026\.pdf$/);

    // Zap 3's signed copy: fetched from Adobe's https link.
    const realFetch = globalThis.fetch;
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) =>
      String(input) === "https://adobe.test/signed.pdf" ? Promise.resolve(new Response("%PDF-signed")) : realFetch(input, init));
    calls = [];
    efile.calls = [];
    const ev = await event({ event: "signed_pdf", agreementName: "10-15-26 - I-212 Contract - A. PÉREZ [CP-1]", pdfUrl: "https://adobe.test/signed.pdf" });
    spy.mockRestore();
    // (This test board has no file column, so the Monday attach is skipped; the copy is kept.)
    expect(ev.json).toMatchObject({ saved: true });
    expect(efile.calls).toEqual([[1, "10-15-26 - SIGNED I-212 Contract - A. PÉREZ"]]);
    await vi.waitFor(() => expect(String(calls.find((c) => c.op === "update")?.body)).toContain("E-File: FEE Ks / x.pdf"));
  });

  it("the client's Credit / Debit / Cash pick fills an empty Payment Method, once, and tells staff", async () => {
    await send();
    await event({ event: "sent", ref: "CP-1", agreementId: "A1" });
    calls = [];
    await event({ event: "AGREEMENT_WORKFLOW_COMPLETED", agreementId: "A1", formData: JSON.stringify({ PayMethod: "Credit" }) });
    expect(calls.find((c) => c.op === "columns" && (c.values as Record<string, unknown>).dropdown_mm7v5eeb)).toMatchObject({
      itemId: "555", values: { dropdown_mm7v5eeb: { labels: ["CREDIT Card - Surcharge Applies"] } },
    });
    expect(calls.filter((c) => c.op === "update").map((c) => String(c.body)).join("\n")).toContain("chose to pay by credit card. Payment links are ready");
    const local = db.prepare("SELECT json_extract(raw_column_values, '$.payment_method.labels[0]') AS m FROM contracts WHERE local_id = 'c1'").get() as { m: string };
    expect(local.m).toBe("CREDIT Card - Surcharge Applies");

    // Zap 3 repeats it with the signed copy: nothing new.
    calls = [];
    await event({ event: "AGREEMENT_WORKFLOW_COMPLETED", agreementId: "A1", formData: { PayMethod: "Credit" } });
    expect(calls.filter((c) => c.op === "columns" || c.op === "update")).toEqual([]);
  });

  it("a Payment Method staff already set stays; the note flags the difference", async () => {
    db.prepare("UPDATE contracts SET raw_column_values = json_set(raw_column_values, '$.payment_method', json(?)) WHERE local_id = 'c1'")
      .run(JSON.stringify({ labels: ["SPLIT PAYMENTS"] }));
    await send();
    calls = [];
    await event({ event: "AGREEMENT_REJECTED", ref: "CP-1", formData: "PayMethod\nCash" });
    expect(calls.find((c) => c.op === "columns" && (c.values as Record<string, unknown>).dropdown_mm7v5eeb)).toBeUndefined();
    expect(calls.map((c) => String(c.body ?? "")).join("\n")).toContain('says "SPLIT PAYMENTS" — left as it is');
  });

  it("needs two different e-mails", async () => {
    expect((await send("attorneyEmail=atty@firm.com&clientEmail=")).status).toBe(400);
    expect((await send("attorneyEmail=a@b.com&clientEmail=A@b.com")).status).toBe(400);
  });
});
