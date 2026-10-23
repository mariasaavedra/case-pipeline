// =============================================================================
// Mail intake route tests
// =============================================================================
// End to end over HTTP: one piece of mail goes in as a raw PDF body and comes
// back read and matched against an in-memory DB — once with a text layer, once
// as images only, which forces real OCR — with nothing written to disk. Then
// corrected, filed (M31) and resolved. Auth, the user lookup and the audit log
// are stubbed; each has its own tests.
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
const audits: Array<{ action: string; targetId?: string | null; metadata?: Record<string, unknown> }> = [];
vi.mock("../audit/log.js", () => ({
  auditFromReq: (_req: unknown, action: string, opts: { targetId?: string | null; metadata?: Record<string, unknown> }) =>
    audits.push({ action, targetId: opts.targetId, metadata: opts.metadata }),
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
  db.prepare(
    `INSERT INTO profiles (batch_id, local_id, name, a_number, email, raw_column_values)
     VALUES (1, 'p1', 'Juan Lopez', '123456789', 'juan@example.com', ?)`,
  ).run(JSON.stringify({ e_file: "https://sharmacrawford.sharepoint.com/sites/scalefiles/Shared Documents/L/LOPEZ, Juan" }));
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

/** A one-page PDF with these lines of text. */
async function letter(...lines: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  lines.forEach((l, i) => page.drawText(l, { x: 50, y: 700 - i * 20, size: 11 }));
  return Buffer.from(await doc.save());
}

const JUAN_RECEIPT = ["Notice of Action", "Receipt Number: IOE0911111111", "Form I-130", "A# 123-456-789"];
const STRANGER = ["Notice of Action", "Receipt Number: IOE0933333333", "A# 555-555-555"];

async function scan(pdf: ArrayBuffer | Buffer, query = ""): Promise<MailScanResult> {
  const res = await fetch(`${base}/api/mail/scan${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/pdf" },
    body: Buffer.from(pdf as ArrayBuffer),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { data: MailScanResult }).data;
}

describe("reading one piece of mail", () => {
  test("one upload is one notice, matched, and the PDF is not kept", async () => {
    const data = await scan(await letter(...JUAN_RECEIPT), "?name=../../etc/passwd%20mail.pdf");
    expect(data.documents).toHaveLength(1);
    const doc = data.documents[0]!;
    expect(doc.match).toMatchObject({ status: "matched", proposedAction: "fill_receipt" });
    expect(doc.match.openForm?.localId).toBe("f1");
    // Filing it is the review: it never waits in Alerts.
    expect(doc.needsReview).toBe(false);

    expect(fs.existsSync(path.join(dataDir, "mail"))).toBe(false);
    const detail = await (await fetch(`${base}/api/mail/documents/${doc.id}`)).json();
    expect(detail.data).toMatchObject({ fileName: "passwd mail.pdf", hasPdf: false });
    expect((await fetch(`${base}/api/mail/documents/${doc.id}/pdf`)).status).toBe(404);
    expect(audits.some((a) => a.action === "mail.scan" && a.targetId === String(data.scanId))).toBe(true);
  });

  test("a scan with several notices still comes back as one", async () => {
    const sample = await (await fetch(`${base}/api/mail/sample.pdf`)).arrayBuffer();
    const data = await scan(sample, "?sample=1");
    expect(data.documents).toHaveLength(1);
    expect(data.documents[0]!.pages.length).toBe(data.totalPages - data.separatorPages.length);
  });

  test("an image-only scan is read by OCR", { timeout: 60_000 }, async () => {
    const sample = await fetch(`${base}/api/mail/sample.pdf?scanned=1`);
    const data = await scan(await sample.arrayBuffer(), "?sample=1");
    expect(data.ocrPages).toHaveLength(data.totalPages);
    const doc = data.documents[0]!;
    expect(doc.fields.formType).toBe("I130");
    expect(doc.fields.aNumbers).toContain("123456789");
    expect(doc.ocrConfidence).toBeGreaterThan(80);
  });

  test("the same file can be read again", async () => {
    const bytes = await letter(...STRANGER);
    await scan(bytes);
    await scan(bytes);
  });

  test("rejects a body that is not a PDF, a missing body, and an all-blank PDF", async () => {
    const post = (body?: BodyInit) =>
      fetch(`${base}/api/mail/scan`, { method: "POST", headers: { "Content-Type": "application/pdf" }, body });
    expect((await post("hello")).status).toBe(400);
    expect((await fetch(`${base}/api/mail/scan`, { method: "POST" })).status).toBe(400);
    const blank = await PDFDocument.create();
    blank.addPage();
    const res = await post(Buffer.from(await blank.save()));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/blank/);
  });
});

describe("client details for filing", () => {
  test("E-File, e-mail and Open Forms", async () => {
    const res = await fetch(`${base}/api/mail/clients/p1`);
    expect((await res.json()).data).toMatchObject({
      name: "Juan Lopez",
      email: "juan@example.com",
      eFile: expect.stringContaining("LOPEZ, Juan"),
      openForms: [expect.objectContaining({ localId: "f1" })],
    });
    expect((await fetch(`${base}/api/mail/clients/nobody`)).status).toBe(404);
  });
});

describe("filing (M31)", () => {
  const savedTo = {
    url: "https://sharmacrawford.sharepoint.com/sites/scalefiles/Shared Documents/L/LOPEZ, Juan/CC/receipt.pdf",
    fileName: "receipt.pdf",
    folder: "E-File → CC",
  };
  const file = (id: number, body: unknown) =>
    fetch(`${base}/api/mail/documents/${id}/file`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  test("validation: a client, a SharePoint location, a real e-mail", async () => {
    const { documents } = await scan(await letter(...JUAN_RECEIPT));
    const id = documents[0]!.id!;
    expect((await file(id, { savedTo })).status).toBe(400);
    expect((await file(id, { profileLocalId: "p1" })).status).toBe(400);
    expect((await file(id, { profileLocalId: "p1", savedTo: { ...savedTo, url: "https://evil.example.com/x.pdf" } })).status).toBe(400);
    expect((await file(id, { profileLocalId: "p1", savedTo, emailedTo: "not-an-email" })).status).toBe(400);
    expect((await file(999, { profileLocalId: "p1", savedTo })).status).toBe(404);
  });

  test("records the decision and audits it; a second filing is refused", async () => {
    const { documents } = await scan(await letter(...JUAN_RECEIPT));
    const id = documents[0]!.id!;
    const res = await file(id, { profileLocalId: "p1", openFormLocalId: "f1", savedTo, emailedTo: "juan@example.com", note: "Original in the drawer" });
    expect(res.status).toBe(200);
    const doc = (await res.json()).data;
    expect(doc).toMatchObject({ reviewState: "assigned", resolutionNote: "Original in the drawer", note: "skipped" });
    // No Monday token in tests: the receipt write-back is skipped, with the reason.
    expect(doc.writebackState).toBe("skipped");
    const entry = audits.find((a) => a.action === "mail.filed" && a.targetId === String(id));
    expect(entry?.metadata).toMatchObject({ profile: "p1", openForm: "f1", emailed: true });

    expect((await file(id, { profileLocalId: "p1", savedTo })).status).toBe(409);
  });

  test("client only, when there is no Open Form for it", async () => {
    const { documents } = await scan(await letter(...STRANGER));
    const res = await file(documents[0]!.id!, { profileLocalId: "p1", savedTo });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ reviewState: "assigned", profile: { localId: "p1" }, openForm: null });
  });
});

describe("older review routes", () => {
  test("resolve: validation, assign, then a second decision is refused", async () => {
    const { documents } = await scan(await letter(...STRANGER));
    const post = (body: unknown) =>
      fetch(`${base}/api/mail/documents/${documents[0]!.id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

    expect((await post({ action: "maybe" })).status).toBe(400);
    expect((await post({ action: "dismiss" })).status).toBe(400); // needs a reason
    const ok = await post({ action: "assign", openFormLocalId: "f1" });
    expect(ok.status).toBe(200);
    expect((await ok.json()).data).toMatchObject({ reviewState: "assigned", resolvedByName: "Front Desk" });
    expect((await post({ action: "dismiss", note: "x" })).status).toBe(409);
  });

  test("the plan preview explains why nothing would be written", async () => {
    const { documents } = await scan(await letter(...JUAN_RECEIPT), "?sample=1");
    const plan = (await (await fetch(`${base}/api/mail/documents/${documents[0]!.id}/writeback-plan?openForm=f1`)).json()).data;
    expect(plan.steps).toEqual([]);
    expect(plan.blockers.join(" ")).toMatch(/Sample scans are never written/);
    expect(plan.blockers.join(" ")).toMatch(/isn't configured/);
  });

  test("retry: refused for a notice that isn't assigned to an Open Form", async () => {
    const { documents } = await scan(await letter(...STRANGER));
    expect((await fetch(`${base}/api/mail/documents/${documents[0]!.id}/writeback`, { method: "POST" })).status).toBe(409);
    expect((await fetch(`${base}/api/mail/documents/999/writeback`, { method: "POST" })).status).toBe(404);
  });

  test("unknown ids are 404", async () => {
    expect((await fetch(`${base}/api/mail/documents/999`)).status).toBe(404);
    expect((await fetch(`${base}/api/mail/documents/abc/pdf`)).status).toBe(404);
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
    const { documents } = await scan(await letter(...STRANGER));
    const id = documents[0]!.id!;
    const res = await patch(id, { aNumbers: "123-456-789", caseType: "I-130" });
    expect(res.status).toBe(200);
    const doc = (await res.json()).data;
    expect(doc.fields.aNumbers).toEqual(["123456789"]);
    expect(doc.originalFields.aNumbers).toEqual(["555555555"]);
    expect(doc.status).not.toBe("no_match");
    expect(audits.find((a) => a.action === "mail.fields_edited")?.targetId).toBe(String(id));
  });

  test("invalid values come back per field", async () => {
    const { documents } = await scan(await letter(...JUAN_RECEIPT));
    const res = await patch(documents[0]!.id!, { receiptNumbers: "nope", noticeDate: "tomorrow" });
    expect(res.status).toBe(400);
    expect(Object.keys((await res.json()).fieldErrors).sort()).toEqual(["noticeDate", "receiptNumbers"]);
  });

  test("non-text values are refused", async () => {
    expect((await patch(1, { aNumbers: 123 })).status).toBe(400);
  });
});
