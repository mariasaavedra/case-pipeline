// =============================================================================
// Mail intake route tests
// =============================================================================
// End to end over HTTP: the generated sample PDF goes in as a raw body and
// comes back split and matched against an in-memory DB — once with a text
// layer, once as images only, which forces real OCR — then saved, cut into
// per-notice PDFs, and resolved. Auth, the user lookup and the audit log are
// stubbed; each has its own tests.
// =============================================================================

import { test, expect, describe, vi, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { initializeSchema } from "@case-pipeline/seed/db/schema";
import type { MailScanResult } from "@case-pipeline/query";

vi.mock("../auth/middleware.js", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../db/user-context.js", () => ({
  currentUser: () => ({ id: 7, name: "Front Desk" }),
}));
const audits: Array<{ action: string; targetId?: string | null }> = [];
vi.mock("../audit/log.js", () => ({
  auditFromReq: (_req: unknown, action: string, opts: { targetId?: string | null }) =>
    audits.push({ action, targetId: opts.targetId }),
}));

const { registerMailRoutes } = await import("./mail.js");
const { closeOcr } = await import("../mail/ocr.js");

let server: Server;
let base: string;
let dataDir: string;

beforeAll(async () => {
  const db = new Database(":memory:");
  initializeSchema(db);
  db.prepare("INSERT INTO seed_batches (batch_name, seed_value, status) VALUES ('t', 1, 'complete')").run();
  db.prepare("INSERT INTO profiles (batch_id, local_id, name, a_number) VALUES (1, 'p1', 'Juan Lopez', '123456789')").run();
  db.prepare(
    `INSERT INTO board_items (batch_id, local_id, board_key, name, status, profile_local_id, column_values)
     VALUES (1, 'f1', '_cd_open_forms', 'Juan Lopez', 'Sent Out', 'p1', '{"forms":{"labels":["I130"]}}')`,
  ).run();

  const app = express();
  app.use(express.json());
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mail-test-"));
  registerMailRoutes(app, { db, dataDir });
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.close();
  await closeOcr();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function scan(pdf: ArrayBuffer, query = ""): Promise<MailScanResult> {
  const res = await fetch(`${base}/api/mail/scan${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/pdf" },
    body: pdf,
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { data: MailScanResult }).data;
}

describe("mail routes", () => {
  test("the sample PDF round-trips into one matched notice of each kind", async () => {
    const sample = await fetch(`${base}/api/mail/sample.pdf`);
    expect(sample.headers.get("content-type")).toBe("application/pdf");
    const data = await scan(await sample.arrayBuffer());

    // p1 has one I-130 without a receipt → the 2-page receipt notice fills it.
    const first = data.documents[0]!;
    expect(first.pages).toEqual([1, 2]);
    expect(first.match).toMatchObject({ status: "matched", proposedAction: "fill_receipt" });
    expect(first.match.openForm?.localId).toBe("f1");

    expect(data.summary).toMatchObject({ matched: 1, no_match: 1, unreadable: 1 });
    expect(data.separatorPages).toHaveLength(1);
    // Only the blank separator lacks a text layer.
    expect(data.ocrPages).toEqual(data.separatorPages);
  });

  test("an image-only scan is read by OCR and matches the same way", { timeout: 60_000 }, async () => {
    const sample = await fetch(`${base}/api/mail/sample.pdf?scanned=1`);
    const data = await scan(await sample.arrayBuffer());

    expect(data.ocrPages).toHaveLength(data.totalPages);
    const first = data.documents[0]!;
    expect(first.pages).toEqual([1, 2]);
    expect(first.fields.formType).toBe("I130");
    expect(first.fields.aNumbers).toEqual(["123456789"]);
    expect(first.match).toMatchObject({ status: "matched", proposedAction: "fill_receipt" });
    expect(first.ocrConfidence).toBeGreaterThan(80);
    expect(data.summary).toMatchObject({ matched: 1, no_match: 1, unreadable: 1 });
  });

  test("rejects a body that is not a PDF", async () => {
    const res = await fetch(`${base}/api/mail/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/pdf" },
      body: "hello",
    });
    expect(res.status).toBe(400);
  });

  test("rejects a missing body", async () => {
    const res = await fetch(`${base}/api/mail/scan`, { method: "POST" });
    expect(res.status).toBe(400);
  });
});

describe("saved scans and review", () => {
  test("a scan is stored, its notices get ids, and each notice's pages can be fetched alone", async () => {
    const sample = await (await fetch(`${base}/api/mail/sample.pdf`)).arrayBuffer();
    const data = await scan(sample, "?name=../../etc/passwd%20mail.pdf&sample=1");
    expect(data.scanId).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(dataDir, "mail", `scan-${data.scanId}.pdf`))).toBe(true);
    expect(audits.some((a) => a.action === "mail.scan" && a.targetId === String(data.scanId))).toBe(true);

    const first = data.documents[0]!;
    const detail = await (await fetch(`${base}/api/mail/documents/${first.id}`)).json();
    expect(detail.data).toMatchObject({ fileName: "passwd mail.pdf", isSample: true, hasPdf: true });
    expect(detail.data.pdfPath).toBeUndefined();

    const cut = await fetch(`${base}/api/mail/documents/${first.id}/pdf`);
    expect(cut.headers.get("content-type")).toBe("application/pdf");
    const pdf = await PDFDocument.load(await cut.arrayBuffer());
    expect(pdf.getPageCount()).toBe(first.pages.length);
  });

  test("resolve: validation, assign, then a second decision is refused", async () => {
    const sample = await (await fetch(`${base}/api/mail/sample.pdf`)).arrayBuffer();
    const data = await scan(sample);
    const noMatch = data.documents.find((d) => d.match.status === "no_match")!;
    const post = (body: unknown) =>
      fetch(`${base}/api/mail/documents/${noMatch.id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

    expect((await post({ action: "maybe" })).status).toBe(400);
    expect((await post({ action: "dismiss" })).status).toBe(400); // needs a reason

    const forms = await (await fetch(`${base}/api/mail/open-forms?profile=p1`)).json();
    expect(forms.data.map((f: { localId: string }) => f.localId)).toEqual(["f1"]);

    const ok = await post({ action: "assign", openFormLocalId: "f1" });
    expect(ok.status).toBe(200);
    expect((await ok.json()).data).toMatchObject({ reviewState: "assigned", resolvedByName: "Front Desk" });
    expect(audits.some((a) => a.action === "mail.review.assign")).toBe(true);

    expect((await post({ action: "dismiss", note: "x" })).status).toBe(409);
  });

  test("unknown ids are 404", async () => {
    expect((await fetch(`${base}/api/mail/documents/999`)).status).toBe(404);
    expect((await fetch(`${base}/api/mail/documents/abc/pdf`)).status).toBe(404);
  });
});

describe("write-back routes (server without a Monday token)", () => {
  test("the plan preview explains why nothing would be written", async () => {
    const sample = await (await fetch(`${base}/api/mail/sample.pdf`)).arrayBuffer();
    const data = await scan(sample, "?sample=1");
    const first = data.documents[0]!;
    const res = await fetch(`${base}/api/mail/documents/${first.id}/writeback-plan?openForm=f1`);
    const plan = (await res.json()).data;
    expect(plan.steps).toEqual([]);
    expect(plan.blockers.join(" ")).toMatch(/Sample scans are never written/);
    expect(plan.blockers.join(" ")).toMatch(/isn't configured/);
  });

  test("assigning records the decision, and the write-back as skipped with the reason", async () => {
    const sample = await (await fetch(`${base}/api/mail/sample.pdf`)).arrayBuffer();
    const data = await scan(sample);
    const first = data.documents[0]!;
    const res = await fetch(`${base}/api/mail/documents/${first.id}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "assign", openFormLocalId: "f1" }),
    });
    const doc = (await res.json()).data;
    expect(doc).toMatchObject({ reviewState: "assigned", writebackState: "skipped" });
    expect(doc.writebackError).toMatch(/MONDAY_API_TOKEN/);
  });

  test("retry: refused for a notice that isn't assigned to an Open Form", async () => {
    const sample = await (await fetch(`${base}/api/mail/sample.pdf`)).arrayBuffer();
    const data = await scan(sample);
    const res = await fetch(`${base}/api/mail/documents/${data.documents[0]!.id}/writeback`, { method: "POST" });
    expect(res.status).toBe(409);
    expect((await fetch(`${base}/api/mail/documents/999/writeback`, { method: "POST" })).status).toBe(404);
  });
});

describe("PATCH fields", () => {
  const patch = (id: number, body: unknown) =>
    fetch(`${base}/api/mail/documents/${id}/fields`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  test("a corrected A-number re-matches, and the edit is audited by field name", async () => {
    const sample = await (await fetch(`${base}/api/mail/sample.pdf`)).arrayBuffer();
    const data = await scan(sample);
    const noMatch = data.documents.find((d) => d.match.status === "no_match")!;
    const res = await patch(noMatch.id!, { aNumbers: "123-456-789", caseType: "I-130" });
    expect(res.status).toBe(200);
    const doc = (await res.json()).data;
    expect(doc.fields.aNumbers).toEqual(["123456789"]);
    expect(doc.originalFields.aNumbers).not.toEqual(["123456789"]);
    expect(doc.status).not.toBe("no_match");
    const entry = audits.find((a) => a.action === "mail.fields_edited");
    expect(entry?.targetId).toBe(String(noMatch.id));
  });

  test("invalid values come back per field", async () => {
    const sample = await (await fetch(`${base}/api/mail/sample.pdf`)).arrayBuffer();
    const data = await scan(sample);
    const res = await patch(data.documents[0]!.id!, { receiptNumbers: "nope", noticeDate: "tomorrow" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(Object.keys(body.fieldErrors).sort()).toEqual(["noticeDate", "receiptNumbers"]);
  });

  test("non-text values are refused", async () => {
    expect((await patch(1, { aNumbers: 123 })).status).toBe(400);
  });
});
