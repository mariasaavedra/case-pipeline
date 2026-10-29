// =============================================================================
// Buzón checklist — staff routes + the client page's list and uploads, over HTTP
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
import type { FeeKTypeRow } from "../fee-k-types.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "upload-checklist-test-"));
const audits: { action: string; metadata?: unknown }[] = [];

vi.mock("../paths.js", () => ({ DATA_DIR: tmp, REPO_ROOT: tmp }));
vi.mock("../auth/middleware.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as unknown as { user: unknown }).user = { oid: "oid-1", name: "Ana Reyes", preferred_username: "ana@firm.com" };
    next();
  },
  requireAdmin: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));
vi.mock("../audit/log.js", () => ({
  auditFromReq: (_req: unknown, action: string, opts: { metadata?: unknown }) => audits.push({ action, metadata: opts?.metadata }),
  recordAudit: (e: { action: string; metadata?: unknown }) => audits.push({ action: e.action, metadata: e.metadata }),
}));

const { registerClientUploadPublicRoutes, registerClientUploadRoutes } = await import("./client-uploads.js");
const { registerUploadChecklistRoutes } = await import("./upload-checklist.js");

const BLANK = { spanish: "", board: "", feeSheetJob: "", prescheduling: true, services: "", servicesEs: "", excluded: "", excludedEs: "" };
const TABLE: FeeKTypeRow[] = [
  { ...BLANK, feeKType: "I-130 - Petition for Alien Relative", documents: [
    { en: "Marriage certificate", es: "Acta de matrimonio", required: true },
    { en: "Passport", es: "Pasaporte", required: true },
    { en: "Photos together", es: "Fotos juntos", required: false },
  ] },
  { ...BLANK, feeKType: "Bond MTN  (c)", documents: [{ en: "Passport", es: "Pasaporte", required: true }] },
  { ...BLANK, feeKType: "FOIA", spanish: "FOIA" },
];
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const PDF = Buffer.from("%PDF-1.7\nhello\n", "latin1");

let db: Database.Database;
let server: Server;
let base: string;

const feeK = (localId: string, mondayId: string, profile: string, types: string[]) =>
  db.prepare("INSERT INTO contracts (local_id, monday_item_id, profile_local_id, profile_monday_id, name, raw_column_values) VALUES (?, ?, ?, ?, ?, ?)")
    .run(localId, mondayId, profile, profile === "p1" ? "9001" : "9002", `Fee K ${localId}`, JSON.stringify({
      fee_k_type: { labels: types }, contract_stage: { label: "Paid needs action" },
    }));

beforeEach(async () => {
  audits.length = 0;
  process.env.CLIENT_UPLOADS = "on";
  process.env.API_URL = "https://app.example.com";
  db = new Database(":memory:");
  initializeSchema(db);
  db.prepare("INSERT INTO profiles (local_id, monday_item_id, name) VALUES ('p1', '9001', 'Yaucdy QUINTANILLA')").run();
  db.prepare("INSERT INTO profiles (local_id, monday_item_id, name) VALUES ('p2', '9002', 'Maxim RAILEANU')").run();
  feeK("k1", "7001", "p1", ["I-130 - Petition for Alien Relative"]);
  feeK("k2", "7002", "p1", ["Bond MTN  (c)", "FOIA"]);
  feeK("k3", "7003", "p2", ["I-130 - Petition for Alien Relative"]);
  const app = express();
  app.use(express.json());
  registerClientUploadPublicRoutes(app, { db });
  registerClientUploadRoutes(app, { db });
  registerUploadChecklistRoutes(app, { db, feeKTypes: () => TABLE });
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => {
  server.close();
  fs.rmSync(path.join(tmp, "uploads"), { recursive: true, force: true });
});

const json = (method: string, body?: unknown) => ({ method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
async function call<T = { data: Record<string, unknown> }>(url: string, init?: RequestInit): Promise<{ status: number; body: T & { error?: string } }> {
  const res = await fetch(`${base}${url}`, init);
  return { status: res.status, body: (await res.json()) as T & { error?: string } };
}
interface Item { id: number; labelEn: string; status: string; folder: string; required: boolean; files: number }
type View = { data: { items: Item[]; feeKs: { localId: string; documents: number; added: boolean }[]; added?: number } };

async function linkToken(profile = "p1"): Promise<string> {
  const { body } = await call<{ data: { url: string } }>(`/api/profiles/${profile}/upload-links`, json("POST", {}));
  return body.data.url.split("/u/")[1]!;
}
const upload = (token: string, file: Buffer, query: string) =>
  fetch(`${base}/api/u/${token}/files?${query}`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: new Uint8Array(file) });

describe("staff checklist", () => {
  it("lists the client's Fee Ks with how many documents their types ask for", async () => {
    const { body } = await call<View>("/api/profiles/p1/upload-checklist");
    expect(body.data.items).toEqual([]);
    expect(body.data.feeKs.map((k) => [k.localId, k.documents, k.added])).toEqual([["k2", 1, false], ["k1", 3, false]]);
  });

  it("adds a Fee K's list once, each document with its EVIDENCE folder; audited", async () => {
    const first = await call<View>("/api/profiles/p1/upload-checklist", json("POST", { feeKLocalId: "k1" }));
    expect(first.status).toBe(201);
    expect(first.body.data.added).toBe(3);
    expect(first.body.data.items.map((i) => [i.labelEn, i.status, i.folder, i.required])).toEqual([
      ["Marriage certificate", "missing", "EVIDENCE I-130 - Petition for Alien Relative", true],
      ["Passport", "missing", "EVIDENCE I-130 - Petition for Alien Relative", true],
      ["Photos together", "missing", "EVIDENCE I-130 - Petition for Alien Relative", false],
    ]);
    const again = await call<View>("/api/profiles/p1/upload-checklist", json("POST", { feeKLocalId: "k1" }));
    expect(again.body.data.added).toBe(0);
    expect(again.body.data.items).toHaveLength(3);
    expect(again.body.data.feeKs.find((k) => k.localId === "k1")?.added).toBe(true);
    expect(audits.map((a) => a.action)).toEqual(["upload_checklist.case_added", "upload_checklist.case_added"]);
  });

  it("Evidence → any case type: tied to the client's Fee K of that type when there is one, else to none; once", async () => {
    const view = await call<View & { data: { caseTypes: { feeKType: string; theirs: boolean; added: boolean }[] } }>("/api/profiles/p2/upload-checklist");
    expect(view.body.data.caseTypes.map((t) => [t.feeKType, t.theirs])).toEqual([["I-130 - Petition for Alien Relative", true], ["Bond MTN  (c)", false]]);
    const theirs = await call<View>("/api/profiles/p2/upload-checklist/case-type", json("POST", { feeKType: "I-130 - Petition for Alien Relative" }));
    expect(theirs.status).toBe(201);
    expect(db.prepare("SELECT DISTINCT fee_k_monday_id FROM upload_checklist_items WHERE profile_local_id = 'p2'").all()).toEqual([{ fee_k_monday_id: "7003" }]);
    const other = await call<View>("/api/profiles/p2/upload-checklist/case-type", json("POST", { feeKType: "bond mtn (c)" }));
    expect(other.body.data.added).toBe(1);
    expect(other.body.data.items.find((i) => i.folder === "EVIDENCE Bond MTN")).toBeTruthy();
    expect(db.prepare("SELECT fee_k_monday_id FROM upload_checklist_items WHERE fee_k_type = 'Bond MTN  (c)'").get()).toEqual({ fee_k_monday_id: null });
    expect((await call<View>("/api/profiles/p2/upload-checklist/case-type", json("POST", { feeKType: "Bond MTN  (c)" }))).body.data.added).toBe(0);
    expect((await call("/api/profiles/p2/upload-checklist/case-type", json("POST", { feeKType: "FOIA" }))).status).toBe(400);
  });

  it("refuses another client's Fee K and a case type with no list", async () => {
    expect((await call("/api/profiles/p1/upload-checklist", json("POST", { feeKLocalId: "k3" }))).status).toBe(404);
    db.prepare("UPDATE contracts SET raw_column_values = ? WHERE local_id = 'k2'").run(JSON.stringify({ fee_k_type: { labels: ["FOIA"] } }));
    expect((await call("/api/profiles/p1/upload-checklist", json("POST", { feeKLocalId: "k2" }))).status).toBe(400);
  });

  it("one by hand: with a Fee K it goes to that case's EVIDENCE, without one to CAF", async () => {
    const a = await call<View>("/api/profiles/p1/upload-checklist/items", json("POST", { labelEn: "Pay stubs", feeKLocalId: "k2" }));
    expect(a.status).toBe(201);
    const b = await call<View>("/api/profiles/p1/upload-checklist/items", json("POST", { labelEn: "Old I-94", labelEs: "I-94 viejo", required: false }));
    expect(b.body.data.items.map((i) => [i.labelEn, i.folder, i.required])).toEqual([
      ["Pay stubs", "EVIDENCE Bond MTN", true],
      ["Old I-94", "CAF", false],
    ]);
    expect((await call("/api/profiles/p1/upload-checklist/items", json("POST", { labelEn: "  " }))).status).toBe(400);
  });

  it("Already have it / ask again; staff can't mark received; remove only while nothing came in", async () => {
    const { body } = await call<View>("/api/profiles/p1/upload-checklist", json("POST", { feeKLocalId: "k1" }));
    const [cert, passport] = body.data.items;
    const off = await call<View>(`/api/upload-checklist/${cert!.id}`, json("PATCH", { status: "not_needed" }));
    expect(off.body.data.items[0]!.status).toBe("not_needed");
    expect((await call(`/api/upload-checklist/${cert!.id}`, json("PATCH", { status: "received" }))).status).toBe(400);
    expect((await call(`/api/upload-checklist/${cert!.id}`, json("PATCH", {}))).status).toBe(400);

    const token = await linkToken();
    expect((await upload(token, JPG, `name=p.jpg&item=${passport!.id}`)).status).toBe(200);
    expect((await call(`/api/upload-checklist/${passport!.id}`, json("DELETE"))).status).toBe(409);
    const gone = await call<View>(`/api/upload-checklist/${cert!.id}`, json("DELETE"));
    expect(gone.status).toBe(200);
    expect(gone.body.data.items.map((i) => i.labelEn)).toEqual(["Passport", "Photos together"]);
    const again = await call<View>(`/api/upload-checklist/${passport!.id}`, json("PATCH", { status: "missing" }));
    expect(again.body.data.items[0]).toMatchObject({ status: "missing", files: 1 });
  });
});

describe("the client page's list", () => {
  it("one row per document name across cases, not_needed hidden, no case named", async () => {
    await call("/api/profiles/p1/upload-checklist", json("POST", { feeKLocalId: "k1" }));
    const { body } = await call<View>("/api/profiles/p1/upload-checklist", json("POST", { feeKLocalId: "k2" }));
    const photos = body.data.items.find((i) => i.labelEn === "Photos together")!;
    await call(`/api/upload-checklist/${photos.id}`, json("PATCH", { status: "not_needed" }));
    const page = await call<{ data: { checklist: Record<string, unknown>[] } }>(`/api/u/${await linkToken()}`);
    expect(page.body.data.checklist).toEqual([
      { id: expect.any(Number), en: "Marriage certificate", es: "Acta de matrimonio", required: true, received: false },
      { id: expect.any(Number), en: "Passport", es: "Pasaporte", required: true, received: false },
    ]);
    expect(JSON.stringify(page.body)).not.toMatch(/I-130|Bond|EVIDENCE/);
  });

  it("a file for a document: named after it, filed against it, and every same-name item is received", async () => {
    await call("/api/profiles/p1/upload-checklist", json("POST", { feeKLocalId: "k1" }));
    const { body } = await call<View>("/api/profiles/p1/upload-checklist", json("POST", { feeKLocalId: "k2" }));
    const passports = body.data.items.filter((i) => i.labelEn === "Passport");
    expect(passports).toHaveLength(2);
    const token = await linkToken();
    const res = await upload(token, PDF, `name=scan.pdf&kind=other&item=${passports[0]!.id}`);
    expect(res.status).toBe(200);
    const row = db.prepare("SELECT stored_name, kind, item_id FROM client_uploads").get() as Record<string, unknown>;
    expect(row.stored_name).toMatch(/^\d{4}-\d{2}-\d{2} Passport - scan\.pdf$/);
    expect(row).toMatchObject({ kind: "evidence", item_id: passports[0]!.id });
    const after = await call<View>("/api/profiles/p1/upload-checklist");
    expect(after.body.data.items.filter((i) => i.labelEn === "Passport").map((i) => i.status)).toEqual(["received", "received"]);
    const page = await call<{ data: { checklist: { en: string; received: boolean }[] } }>(`/api/u/${token}`);
    expect(page.body.data.checklist.find((c) => c.en === "Passport")?.received).toBe(true);
    expect(audits.find((a) => a.action === "client_upload.received")?.metadata).toMatchObject({ item: passports[0]!.id });
  });

  it("a consult list goes on one consult of this client's, to CONSULT; once; not on someone else's consult", async () => {
    db.prepare("INSERT INTO board_items (local_id, monday_item_id, board_key, name, profile_local_id, column_values) VALUES ('a1', '5001', 'appointments_r', 'Consult', 'p1', ?)")
      .run(JSON.stringify({ consult_date: "2026-10-30" }));
    db.prepare("INSERT INTO board_items (local_id, monday_item_id, board_key, name, profile_local_id, column_values) VALUES ('a2', '5002', 'appointments_r', 'Consult', 'p2', '{}')").run();
    const lists = await call<{ data: { lists: { key: string }[]; draft: boolean } }>("/api/settings/consult-lists");
    expect(lists.body.data.draft).toBe(true);
    expect(lists.body.data.lists.map((l) => l.key)).toContain("family");
    const add = (appt: string) => call<View & { data: { consults: { mondayId: string; lists: string[] }[] } }>(
      "/api/profiles/p1/upload-checklist/consult", json("POST", { listKey: "family", appointmentMondayId: appt }));
    const first = await add("5001");
    expect(first.status).toBe(201);
    expect(first.body.data.items.every((i) => i.folder === "Consult File → CONSULT")).toBe(true);
    expect(first.body.data.consults).toEqual([{ mondayId: "5001", name: "Consult", date: "2026-10-30", lists: ["family"] }]);
    expect((await add("5001")).body.data.added).toBe(0);
    expect((await add("5002")).status).toBe(404);
  });

  it("refuses another client's document and one marked Already have it", async () => {
    const mine = await call<View>("/api/profiles/p1/upload-checklist", json("POST", { feeKLocalId: "k1" }));
    const theirs = await call<View>("/api/profiles/p2/upload-checklist", json("POST", { feeKLocalId: "k3" }));
    const token = await linkToken("p1");
    const other = await upload(token, JPG, `name=a.jpg&item=${theirs.body.data.items[0]!.id}`);
    expect(other.status).toBe(400);
    expect(((await other.json()) as { code: string }).code).toBe("item");
    await call(`/api/upload-checklist/${mine.body.data.items[0]!.id}`, json("PATCH", { status: "not_needed" }));
    expect((await upload(token, JPG, `name=a.jpg&item=${mine.body.data.items[0]!.id}`)).status).toBe(400);
    expect((await upload(token, JPG, "name=a.jpg&item=abc")).status).toBe(400);
    expect(db.prepare("SELECT COUNT(*) AS n FROM client_uploads").get()).toEqual({ n: 0 });
  });
});
