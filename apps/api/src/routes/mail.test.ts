// =============================================================================
// Mail intake route tests
// =============================================================================
// End to end over HTTP: the generated sample PDF goes in as a raw body and
// comes back split and matched against an in-memory DB — once with a text
// layer, once as images only, which forces real OCR. Auth is stubbed —
// requireAuth has its own tests.
// =============================================================================

import { test, expect, describe, vi, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import Database from "better-sqlite3";
import { initializeSchema } from "@case-pipeline/seed/db/schema";
import type { MailScanResult } from "@case-pipeline/query";

vi.mock("../auth/middleware.js", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const { registerMailRoutes } = await import("./mail.js");
const { closeOcr } = await import("../mail/ocr.js");

let server: Server;
let base: string;

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
  registerMailRoutes(app, { db });
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.close();
  await closeOcr();
});

async function scan(pdf: ArrayBuffer): Promise<MailScanResult> {
  const res = await fetch(`${base}/api/mail/scan`, {
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
