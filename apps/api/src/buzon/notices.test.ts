// =============================================================================
// Buzón — a client's notice goes to Alerts → Mail to review, read like scanned mail
// =============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { initializeSchema } from "@case-pipeline/seed/db/schema";

vi.mock("../audit/log.js", () => ({ recordAudit: () => {} }));
const { readClientNotices } = await import("./notices.js");

let db: Database.Database;
let dir: string;

async function noticePdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([612, 792]);
  [
    "Department of Homeland Security",
    "U.S. Citizenship and Immigration Services",
    "I-797C, Notice of Action",
    "Receipt Number IOE0912345678",
    "Case Type I-130 - PETITION FOR ALIEN RELATIVE",
    "Received Date 10/01/2026",
    "Petitioner JUAN PEREZ",
    "Beneficiary MARIA LOPEZ",
  ].forEach((line, i) => page.drawText(line, { x: 50, y: 740 - i * 20, size: 12, font }));
  return Buffer.from(await pdf.save());
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "buzon-notices-"));
  fs.mkdirSync(path.join(dir, "uploads"));
  db = new Database(":memory:");
  initializeSchema(db);
  db.prepare("INSERT INTO profiles (local_id, monday_item_id, name) VALUES ('p1', '9001', 'Maria LOPEZ')").run();
  db.prepare("INSERT INTO upload_links (id, profile_local_id, profile_monday_id, token_hash, language, expires_at) VALUES (1, 'p1', '9001', 'h', 'es', '2030-01-01 00:00:00')").run();
  fs.writeFileSync(path.join(dir, "uploads", "n.pdf"), await noticePdf());
  db.prepare(`INSERT INTO client_uploads (link_id, original_name, stored_name, local_file, size, content_type, sha256, kind, received_at)
              VALUES (1, 'aviso.pdf', '2026-10-24 Notice - aviso.pdf', 'n.pdf', 10, 'application/pdf', 's1', 'notice', datetime('now', '-20 minutes'))`).run();
});

describe("readClientNotices", () => {
  it("reads the notice, saves it for review tied to the client, keeps the PDF, once", async () => {
    expect(await readClientNotices(db, dir)).toBe(1);
    const doc = db.prepare("SELECT d.id, d.needs_review, d.profile_local_id, d.fields, s.pdf_path, s.uploaded_by_name FROM mail_documents d JOIN mail_scans s ON s.id = d.scan_id").get() as Record<string, unknown>;
    expect(doc).toMatchObject({ needs_review: 1, profile_local_id: "p1", uploaded_by_name: "Client (Buzón)" });
    expect(String(doc.fields)).toContain("IOE0912345678");
    expect(fs.existsSync(path.join(dir, String(doc.pdf_path)))).toBe(true);
    expect(db.prepare("SELECT mail_document_id FROM client_uploads").get()).toEqual({ mail_document_id: doc.id });
    expect(await readClientNotices(db, dir)).toBe(0);
  });

  it("waits for the batch to go quiet; other kinds are left alone", async () => {
    db.prepare("UPDATE client_uploads SET received_at = datetime('now')").run();
    expect(await readClientNotices(db, dir)).toBe(0);
    db.prepare("UPDATE client_uploads SET received_at = datetime('now', '-1 hour'), kind = 'id'").run();
    expect(await readClientNotices(db, dir)).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS n FROM mail_scans").get()).toEqual({ n: 0 });
  });
});
