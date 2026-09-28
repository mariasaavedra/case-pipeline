// =============================================================================
// Mail intake routes (prototype)
// =============================================================================
// Read-only. The uploaded PDF is parsed in memory and dropped; nothing is
// stored and nothing is written to Monday. The response says what WOULD
// happen per notice (see libs/query/src/mail.ts), so the matching can be
// judged on real mail before any write-back exists.
//
// Text extraction only — a scanned image with no text layer comes back as
// "unreadable" on every page. OCR is the next step, not part of this one.
// =============================================================================

import express, { type Express } from "express";
import type BetterSqlite3 from "better-sqlite3";
import { extractText, getDocumentProxy } from "unpdf";
import { scanMailPages } from "@case-pipeline/query";
import { requireAuth } from "../auth/middleware.js";
import { buildSampleMailPdf } from "../mail/sample.js";

type DatabaseInstance = BetterSqlite3.Database;

const MAX_PDF_BYTES = 40 * 1024 * 1024;

export interface MailDeps {
  db: DatabaseInstance;
}

export async function readPdfPages(bytes: Uint8Array): Promise<string[]> {
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: false });
  return text;
}

export function registerMailRoutes(app: Express, deps: MailDeps): void {
  const { db } = deps;

  app.get("/api/mail/sample.pdf", requireAuth, async (_req, res) => {
    try {
      const bytes = await buildSampleMailPdf(db);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", 'inline; filename="sample-mail.pdf"');
      res.send(Buffer.from(bytes));
    } catch (err) {
      console.error("[mail] sample build failed:", err);
      res.status(500).json({ error: "Could not build the sample PDF" });
    }
  });

  app.post(
    "/api/mail/scan",
    requireAuth,
    express.raw({ type: "application/pdf", limit: MAX_PDF_BYTES }),
    async (req, res) => {
      const body = req.body as unknown;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        res.status(400).json({ error: "Send the PDF as the request body with Content-Type: application/pdf" });
        return;
      }
      if (body.subarray(0, 5).toString("latin1") !== "%PDF-") {
        res.status(400).json({ error: "That file is not a PDF" });
        return;
      }
      let pages: string[];
      try {
        pages = await readPdfPages(new Uint8Array(body));
      } catch (err) {
        console.warn("[mail] unreadable PDF:", err instanceof Error ? err.message : err);
        res.status(400).json({ error: "Could not read that PDF (damaged or password-protected?)" });
        return;
      }
      res.json({ data: scanMailPages(db, pages) });
    },
  );
}
