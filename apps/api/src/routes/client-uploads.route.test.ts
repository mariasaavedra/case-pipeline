// =============================================================================
// Client upload links — the real routes over HTTP, against an in-memory DB
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "client-uploads-test-"));
const audits: { action: string; metadata?: unknown }[] = [];

vi.mock("../paths.js", () => ({ DATA_DIR: tmp, REPO_ROOT: tmp }));
vi.mock("../auth/middleware.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as unknown as { user: unknown }).user = { oid: "oid-1", name: "Ana Reyes", preferred_username: "ana@firm.com" };
    next();
  },
}));
vi.mock("../audit/log.js", () => ({
  auditFromReq: (_req: unknown, action: string, opts: { metadata?: unknown }) => audits.push({ action, metadata: opts?.metadata }),
  recordAudit: (e: { action: string; metadata?: unknown }) => audits.push({ action: e.action, metadata: e.metadata }),
}));

const { registerClientUploadPublicRoutes, registerClientUploadRoutes } = await import("./client-uploads.js");

const PDF = Buffer.from("%PDF-1.7\nhello\n", "latin1");
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

let db: Database.Database;
let server: Server;
let base: string;

beforeEach(async () => {
  audits.length = 0;
  process.env.CLIENT_UPLOADS = "on";
  process.env.API_URL = "https://app.example.com";
  db = new Database(":memory:");
  initializeSchema(db);
  db.prepare("INSERT INTO profiles (local_id, monday_item_id, name) VALUES ('p1', '9001', 'Yaucdy Yoselyn QUINTANILLA CASTRO')").run();
  db.prepare("INSERT INTO profiles (local_id, monday_item_id, name) VALUES ('p2', '9002', 'Maxim RAILEANU')").run();
  const app = express();
  app.use(express.json());
  registerClientUploadPublicRoutes(app, { db });
  registerClientUploadRoutes(app, { db });
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => {
  server.close();
  fs.rmSync(path.join(tmp, "uploads"), { recursive: true, force: true });
});

async function createLink(profile = "p1", body: Record<string, unknown> = {}) {
  const res = await fetch(`${base}/api/profiles/${profile}/upload-links`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as { data: { id: number; url: string; replaced: boolean } } & { error?: string } };
}

const tokenOf = (url: string) => url.split("/u/")[1]!;

function upload(token: string, file: Buffer, query = "name=scan.pdf&kind=notice", type = "application/octet-stream") {
  return fetch(`${base}/api/u/${token}/files?${query}`, { method: "POST", headers: { "Content-Type": type }, body: new Uint8Array(file) });
}

describe("creating a link", () => {
  it("gives a /u/ link once; only the hash is stored; audited", async () => {
    const { status, body } = await createLink("p1", { language: "en", days: 7 });
    expect(status).toBe(201);
    expect(body.data.url).toMatch(/^https:\/\/app\.example\.com\/u\/[A-Za-z0-9_-]{43}$/);
    expect(body.data.replaced).toBe(false);
    const row = db.prepare("SELECT * FROM upload_links").get() as Record<string, string>;
    expect(row.profile_monday_id).toBe("9001");
    expect(row.language).toBe("en");
    expect(JSON.stringify(row)).not.toContain(tokenOf(body.data.url));
    expect(audits.map((a) => a.action)).toEqual(["upload_link.created"]);
  });

  it("one link per client: a new one turns the old one off, other clients untouched", async () => {
    const first = await createLink("p1");
    const other = await createLink("p2");
    const second = await createLink("p1");
    expect(second.body.data.replaced).toBe(true);
    expect((await fetch(`${base}/api/u/${tokenOf(first.body.data.url)}`)).status).toBe(404);
    expect((await fetch(`${base}/api/u/${tokenOf(second.body.data.url)}`)).status).toBe(200);
    expect((await fetch(`${base}/api/u/${tokenOf(other.body.data.url)}`)).status).toBe(200);
  });

  it("refuses a bad language or days, an unknown client, and when the feature is off", async () => {
    expect((await createLink("p1", { language: "fr" })).status).toBe(400);
    expect((await createLink("p1", { days: 365 })).status).toBe(400);
    expect((await createLink("nope")).status).toBe(404);
    process.env.CLIENT_UPLOADS = "off";
    expect((await createLink("p1")).status).toBe(503);
  });
});

describe("the client page", () => {
  it("shows the first name and language, nothing else", async () => {
    const { body } = await createLink("p1");
    const res = await fetch(`${base}/api/u/${tokenOf(body.data.url)}`);
    expect(await res.json()).toEqual({ data: { firstName: "Yaucdy", language: "es" } });
  });

  it("the same 404 for made-up, revoked and expired links, and when off", async () => {
    const made = await (await fetch(`${base}/api/u/${"x".repeat(43)}`)).json();
    const { body } = await createLink("p1");
    const token = tokenOf(body.data.url);
    await fetch(`${base}/api/upload-links/${body.data.id}`, { method: "DELETE" });
    const revoked = await (await fetch(`${base}/api/u/${token}`)).json();
    expect(revoked).toEqual(made);

    const fresh = await createLink("p1");
    db.prepare("UPDATE upload_links SET expires_at = '2020-01-01 00:00:00' WHERE id = ?").run(fresh.body.data.id);
    expect((await fetch(`${base}/api/u/${tokenOf(fresh.body.data.url)}`)).status).toBe(404);

    const live = await createLink("p2");
    process.env.CLIENT_UPLOADS = "off";
    expect((await fetch(`${base}/api/u/${tokenOf(live.body.data.url)}`)).status).toBe(404);
  });
});

describe("uploading", () => {
  it("keeps the file under data/uploads with its SharePoint name; audited without the file name", async () => {
    const { body } = await createLink("p1");
    const res = await upload(tokenOf(body.data.url), PDF, "name=Mi%20aviso.pdf&kind=notice&note=del%20USCIS");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { received: true, duplicate: false } });
    const row = db.prepare("SELECT * FROM client_uploads").get() as Record<string, unknown>;
    expect(row).toMatchObject({ original_name: "Mi aviso.pdf", kind: "notice", note: "del USCIS", content_type: "application/pdf", size: PDF.length });
    expect(row.stored_name).toMatch(/^\d{4}-\d{2}-\d{2} Notice - Mi aviso\.pdf$/);
    expect(fs.readFileSync(path.join(tmp, "uploads", String(row.local_file)))).toEqual(PDF);
    const received = audits.find((a) => a.action === "client_upload.received");
    expect(JSON.stringify(received)).not.toContain("aviso");
    expect((db.prepare("SELECT last_used_at FROM upload_links").get() as { last_used_at: string | null }).last_used_at).not.toBeNull();
  });

  it("the same file twice is kept once", async () => {
    const { body } = await createLink("p1");
    const token = tokenOf(body.data.url);
    await upload(token, JPG, "name=a.jpg");
    const again = await (await upload(token, JPG, "name=b.jpg")).json();
    expect(again).toEqual({ data: { received: true, duplicate: true } });
    expect((db.prepare("SELECT COUNT(*) AS n FROM client_uploads").get() as { n: number }).n).toBe(1);
  });

  it("refuses what isn't a document, an unknown kind, an empty file, a dead link", async () => {
    const { body } = await createLink("p1");
    const token = tokenOf(body.data.url);
    expect((await upload(token, Buffer.from("MZ\x90\0program", "latin1"), "name=passport.pdf")).status).toBe(415);
    expect((await upload(token, PDF, "name=x.pdf&kind=bank")).status).toBe(400);
    expect((await upload(token, Buffer.alloc(0), "name=x.pdf")).status).toBe(400);
    expect((await upload("y".repeat(43), PDF)).status).toBe(404);
    expect(db.prepare("SELECT COUNT(*) AS n FROM client_uploads").get()).toEqual({ n: 0 });
    expect(fs.existsSync(path.join(tmp, "uploads")) ? fs.readdirSync(path.join(tmp, "uploads")) : []).toEqual([]);
  });

  it("a file with a JSON content type is still a file", async () => {
    const { body } = await createLink("p1");
    expect((await upload(tokenOf(body.data.url), PDF, "name=x.pdf", "application/pdf")).status).toBe(200);
  });
});

describe("staff list, extend, revoke", () => {
  it("lists the client's links newest first with what came in", async () => {
    const first = await createLink("p1");
    await upload(tokenOf(first.body.data.url), PDF);
    await createLink("p1");
    const res = (await (await fetch(`${base}/api/profiles/p1/upload-links`)).json()) as {
      data: { enabled: boolean; links: { id: number; active: boolean; createdBy: string; revokedBy: string | null; uploads: { kind: string }[] }[] };
    };
    expect(res.data.enabled).toBe(true);
    expect(res.data.links.map((l) => [l.active, l.uploads.length])).toEqual([[true, 0], [false, 1]]);
    expect(res.data.links[1]).toMatchObject({ createdBy: "Ana Reyes", revokedBy: "Ana Reyes" });
    expect(JSON.stringify(res)).not.toMatch(/token|local_file|sha256/);
  });

  it("extends an expired link back to life, but not one with a newer link or one turned off", async () => {
    const { body } = await createLink("p1");
    db.prepare("UPDATE upload_links SET expires_at = '2020-01-01 00:00:00'").run();
    const ext = await fetch(`${base}/api/upload-links/${body.data.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ days: 10 }),
    });
    expect(ext.status).toBe(200);
    expect((await fetch(`${base}/api/u/${tokenOf(body.data.url)}`)).status).toBe(200);

    const second = await createLink("p1");
    const stale = await fetch(`${base}/api/upload-links/${body.data.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ days: 10 }),
    });
    expect(stale.status).toBe(409);

    await fetch(`${base}/api/upload-links/${second.body.data.id}`, { method: "DELETE" });
    const off = await fetch(`${base}/api/upload-links/${second.body.data.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ days: 10 }),
    });
    expect(off.status).toBe(409);
    expect(audits.filter((a) => a.action === "upload_link.revoked")).toHaveLength(1);
  });
});
