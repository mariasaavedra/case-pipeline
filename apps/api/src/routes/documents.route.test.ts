// =============================================================================
// G-28 routes — end to end through Express + SQLite
// =============================================================================
// The pure rules (prefill, address split, fill) are in documents/*.test.ts.
// This proves the wiring: the profile's Monday columns and open court case
// reach the prefill, a POST returns a real filled PDF, bad input is refused
// with the reasons, and only admins can change the settings.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import Database from "better-sqlite3";
import { PDFDocument } from "pdf-lib";
import { initializeSchema } from "@case-pipeline/seed/db/schema";

const audits: { action: string; metadata: unknown }[] = [];
let isAdmin = false;

vi.mock("../auth/middleware.js", () => ({
  requireAdmin: (_req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (isAdmin) next();
    else res.status(403).json({ error: "Admin only" });
  },
}));
vi.mock("../audit/log.js", () => ({
  auditFromReq: (_req: unknown, action: string, opts: { metadata?: unknown }) => audits.push({ action, metadata: opts.metadata }),
}));

const { registerDocumentRoutes } = await import("./documents.js");
const { initDocumentSettings } = await import("../documents/document-settings.js");

let db: Database.Database;
let server: Server;
let base: string;
let dataDir: string;

function seed() {
  db.prepare("INSERT INTO seed_batches (id, batch_name) VALUES (1, 'test')").run();
  db.prepare(
    `INSERT INTO profiles (batch_id, local_id, monday_item_id, name, phone, email, address, a_number, raw_column_values)
     VALUES (1, 'p1', '111', 'Ciro Ardelean', '(816) 555-0101', 'family@example.com', '12 Oak Dr', 'A241-045-572', ?)`,
  ).run(JSON.stringify({
    first_name: "Ciro", last_name: "Ardelean (det in Core Civic)", attorney: { label: "Lucy Betteridge" },
    mailing_address: "12 Oak Dr, Olathe, KS 66061",
  }));
  db.prepare(
    `INSERT INTO board_items (batch_id, local_id, monday_item_id, board_key, group_title, name, profile_local_id, column_values)
     VALUES (1, 'c1', '901', 'court_cases', 'Court Case', 'Ciro Ardelean', 'p1', ?)`,
  ).run(JSON.stringify({ det_facility: { label: "Core Civic" } }));
}

beforeEach(() => {
  audits.length = 0;
  isAdmin = false;
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-route-"));
  initDocumentSettings(dataDir);
  db = new Database(":memory:");
  initializeSchema(db);
  seed();
  const app = express();
  app.use(express.json());
  registerDocumentRoutes(app, { db });
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(() => {
  server.close();
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const getForm = async () => {
  const res = await fetch(`${base}/api/profiles/p1/documents/g28`);
  return { status: res.status, json: (await res.json()) as { data: { input: Record<string, Record<string, unknown>>; detainedAt: string; limits: Record<string, number> } } };
};

describe("GET /api/profiles/:localId/documents/g28", () => {
  it("pre-fills a detained client at their facility, with their attorney", async () => {
    const { status, json } = await getForm();
    expect(status).toBe(200);
    expect(json.data.detainedAt).toBe("Core Civic");
    expect(json.data.input.attorney).toMatchObject({ id: "lucy", barNumber: "62586" });
    expect(json.data.input.client).toMatchObject({ familyName: "ARDELEAN", givenName: "Ciro", aNumber: "241045572", phone: "" });
    expect((json.data.input.client!.address as Record<string, string>).street).toBe("IN ICE CUSTODY 831 Sabalu Rd");
    expect(json.data.input.matter).toMatchObject({ agency: "ice", clientRole: "respondent" });
    expect(json.data.limits["client.address.street"]).toBe(34);
  });

  it("is 404 for an unknown client", async () => {
    expect((await fetch(`${base}/api/profiles/nope/documents/g28`)).status).toBe(404);
  });
});

describe("POST /api/profiles/:localId/documents/g28", () => {
  it("returns the filled PDF and audits it without client details", async () => {
    const { json } = await getForm();
    const res = await fetch(`${base}/api/profiles/p1/documents/g28`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input: json.data.input }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(decodeURIComponent(res.headers.get("content-disposition")!.split("UTF-8''")[1]!)).toMatch(/^G-28 – ARDELEAN Ciro – \d{4}-\d{2}-\d{2}\.pdf$/);
    const pdf = await PDFDocument.load(new Uint8Array(await res.arrayBuffer()));
    expect(pdf.getForm().getTextField("form1[0].#subform[1].Pt3Line5a_FamilyName[0]").getText()).toBe("ARDELEAN");
    expect(audits).toEqual([{ action: "doc.g28_generated", metadata: { agency: "ice", clientRole: "respondent", attorney: "lucy" } }]);
  });

  it("refuses an incomplete form with the reasons", async () => {
    const { json } = await getForm();
    const input = { ...json.data.input, client: { ...json.data.input.client, familyName: "" } };
    const res = await fetch(`${base}/api/profiles/p1/documents/g28`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { problems: string[] }).problems).toContain("Client family (last) name is missing.");
    expect(audits).toEqual([]);
  });
});

describe("/api/settings/documents", () => {
  it("serves the defaults and lets only an admin change them", async () => {
    const got = (await (await fetch(`${base}/api/settings/documents`)).json()) as { data: { attorneys: unknown[] } };
    expect(got.data.attorneys).toHaveLength(3);

    const body = JSON.stringify({ ...got.data, attorneys: [] });
    const put = (b: string) => fetch(`${base}/api/settings/documents`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: b });
    expect((await put(body)).status).toBe(403);
    isAdmin = true;
    expect((await put(body)).status).toBe(200);
    const after = (await (await fetch(`${base}/api/settings/documents`)).json()) as { data: { attorneys: unknown[] } };
    expect(after.data.attorneys).toEqual([]);
    expect(audits.map((a) => a.action)).toEqual(["document_settings.updated"]);
  });
});
