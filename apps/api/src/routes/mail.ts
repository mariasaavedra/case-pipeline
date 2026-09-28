// =============================================================================
// Mail intake routes
// =============================================================================
// A scan is saved: the PDF under data/mail/, its notices in mail_documents. The
// notices the matcher couldn't settle appear in Alerts → "Mail to review",
// where a person assigns each to an Open Form (or client) or dismisses it.
//
// Assigning to an Open Form then pushes it to Monday (mail/writeback.ts): fill
// Receipt No., set Receipt Status, attach the notice. The popup previews that
// exact plan first (GET …/writeback-plan). A failed write-back can be retried
// (POST …/writeback) without repeating the steps that already landed.
//
// Pages with a text layer are read directly; image-only pages go through OCR
// (see mail/ocr.ts), which is what makes a plain scanner PDF work.
// =============================================================================

import express, { type Express } from "express";
import type BetterSqlite3 from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import {
  scanMailPages,
  saveMailScan,
  setMailScanPdfPath,
  getMailDocument,
  resolveMailDocument,
  findFormsForProfile,
  planForDocument,
  recordWriteBack,
  updateMailDocumentFields,
  type FieldEdits,
  type MailPageInput,
  type ResolveMailInput,
} from "@case-pipeline/query";
import { requireAuth } from "../auth/middleware.js";
import { currentUser } from "../db/user-context.js";
import { auditFromReq } from "../audit/log.js";
import { DATA_DIR } from "../paths.js";
import { buildSampleMailPdf, buildScannedSampleMailPdf } from "../mail/sample.js";
import { readPdfPages } from "../mail/ocr.js";
import { executeMailWriteBack } from "../mail/writeback.js";
import type { WriteTokenOptions } from "../write-token.js";

type DatabaseInstance = BetterSqlite3.Database;

const MAX_PDF_BYTES = 40 * 1024 * 1024;

export interface MailDeps {
  db: DatabaseInstance;
  /** Where scans are kept (as <dataDir>/mail/scan-<id>.pdf). Defaults to data/. */
  dataDir?: string;
  /** Without it, assignments are recorded but nothing is written to Monday. */
  mondayApiToken?: string;
  writeTokenOptions?: WriteTokenOptions;
}

/** Keep what a person would recognise; drop anything path-like. */
function cleanFileName(raw: unknown): string {
  const name = typeof raw === "string" ? path.basename(raw).replace(/[^\w .()-]/g, "").trim() : "";
  return (name || "scan.pdf").slice(0, 120);
}

function parseId(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function registerMailRoutes(app: Express, deps: MailDeps): void {
  const { db, mondayApiToken, writeTokenOptions } = deps;
  const dataDir = deps.dataDir ?? DATA_DIR;
  const writeBackEnabled = Boolean(mondayApiToken && writeTokenOptions);

  const publicDoc = (id: number) => {
    const doc = getMailDocument(db, id)!;
    return { ...doc, pdfPath: undefined, hasPdf: Boolean(doc.pdfPath) };
  };

  const runWriteBack = async (req: express.Request, id: number) => {
    if (!writeBackEnabled) {
      recordWriteBack(db, id, "skipped", [], "Monday write-back isn't configured on this server (MONDAY_API_TOKEN).");
      return;
    }
    const result = await executeMailWriteBack(
      { db, dataDir, tokenOptions: writeTokenOptions!(req), authorOid: req.user?.oid ?? null },
      id,
    );
    const doc = getMailDocument(db, id)!;
    auditFromReq(req, "mail.writeback", {
      targetType: "mail_document",
      targetId: String(id),
      targetMondayId: result.plan.mondayItemId,
      metadata: {
        state: result.state,
        openForm: result.plan.openFormLocalId,
        steps: result.steps.map((s) => ({ kind: s.kind, result: s.result, value: s.value, detail: s.detail })),
        blockers: result.plan.blockers,
        error: doc.writebackError,
      },
    });
  };
  const mailDir = path.join(dataDir, "mail");

  // ?scanned=1 → the same notices as images only, so every page needs OCR.
  app.get("/api/mail/sample.pdf", requireAuth, async (req, res) => {
    try {
      const bytes = req.query.scanned === "1" ? await buildScannedSampleMailPdf(db) : await buildSampleMailPdf(db);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", 'inline; filename="sample-mail.pdf"');
      res.send(Buffer.from(bytes));
    } catch (err) {
      console.error("[mail] sample build failed:", err);
      res.status(500).json({ error: "Could not build the sample PDF" });
    }
  });

  // Body: the raw PDF. ?name= the original file name, ?sample=1 for the
  // built-in samples (kept out of Alerts after a day).
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
      let pages: MailPageInput[];
      try {
        pages = await readPdfPages(new Uint8Array(body));
      } catch (err) {
        console.warn("[mail] unreadable PDF:", err instanceof Error ? err.message : err);
        res.status(400).json({ error: "Could not read that PDF (damaged or password-protected?)" });
        return;
      }

      const user = currentUser(req);
      const fileName = cleanFileName(req.query.name);
      const isSample = req.query.sample === "1";
      const result = saveMailScan(
        db,
        { fileName, pdfPath: null, isSample, uploadedBy: user?.id ?? null, uploadedByName: user?.name ?? null },
        scanMailPages(db, pages),
      );

      // The notices are saved even if the file can't be — the review still
      // works from the extracted fields, just without a preview.
      try {
        fs.mkdirSync(mailDir, { recursive: true });
        const rel = path.join("mail", `scan-${result.scanId}.pdf`);
        fs.writeFileSync(path.join(dataDir, rel), body);
        setMailScanPdfPath(db, result.scanId!, rel);
      } catch (err) {
        console.error("[mail] could not store scan PDF:", err);
      }

      auditFromReq(req, "mail.scan", {
        targetType: "mail_scan",
        targetId: String(result.scanId),
        metadata: {
          fileName,
          sample: isSample,
          pages: result.totalPages,
          ocrPages: result.ocrPages.length,
          notices: result.documents.length,
          toReview: result.documents.filter((d) => d.needsReview).length,
        },
      });
      res.json({ data: result });
    },
  );

  app.get("/api/mail/documents/:id", requireAuth, (req, res) => {
    const id = parseId(req.params.id);
    const doc = id ? getMailDocument(db, id) : null;
    if (!doc) {
      res.status(404).json({ error: "Mail document not found" });
      return;
    }
    // Where the file lives on disk is the server's business.
    res.json({ data: { ...doc, pdfPath: undefined, hasPdf: Boolean(doc.pdfPath) } });
  });

  // Just this notice's pages, cut out of the saved scan.
  app.get("/api/mail/documents/:id/pdf", requireAuth, async (req, res) => {
    const id = parseId(req.params.id);
    const doc = id ? getMailDocument(db, id) : null;
    const file = doc?.pdfPath ? path.join(dataDir, doc.pdfPath) : null;
    if (!doc || !file || !fs.existsSync(file)) {
      res.status(404).json({ error: "The scan for this notice isn't stored" });
      return;
    }
    try {
      const source = await PDFDocument.load(fs.readFileSync(file), { ignoreEncryption: true });
      const out = await PDFDocument.create();
      const copied = await out.copyPages(
        source,
        doc.pages.map((p) => p - 1).filter((i) => i < source.getPageCount()),
      );
      copied.forEach((p) => out.addPage(p));
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="notice-${doc.id}.pdf"`);
      res.send(Buffer.from(await out.save()));
    } catch (err) {
      console.error("[mail] could not cut notice pages:", err);
      res.status(500).json({ error: "Could not open the stored scan" });
    }
  });

  // A client's Open Forms — for picking one when the matcher found no candidate.
  app.get("/api/mail/open-forms", requireAuth, (req, res) => {
    const profile = typeof req.query.profile === "string" ? req.query.profile : "";
    if (!profile) {
      res.status(400).json({ error: "profile is required" });
      return;
    }
    res.json({ data: findFormsForProfile(db, profile) });
  });

  app.post("/api/mail/documents/:id/resolve", requireAuth, async (req, res) => {
    const id = parseId(req.params.id);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
    let input: ResolveMailInput;
    if (body.action === "assign") {
      input = {
        action: "assign",
        openFormLocalId: str(body.openFormLocalId),
        profileLocalId: str(body.profileLocalId),
        note: str(body.note),
      };
    } else if (body.action === "dismiss") {
      input = { action: "dismiss", note: str(body.note) };
    } else {
      res.status(400).json({ error: "action must be assign or dismiss" });
      return;
    }
    if (!id) {
      res.status(404).json({ error: "Mail document not found" });
      return;
    }

    const user = currentUser(req);
    const result = resolveMailDocument(db, id, input, { userId: user?.id ?? null, userName: user?.name ?? null });
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    const doc = result.document;
    auditFromReq(req, `mail.review.${input.action}`, {
      targetType: "mail_document",
      targetId: String(id),
      targetMondayId: doc.openForm?.mondayItemId ?? null,
      metadata: {
        openForm: doc.openForm?.localId ?? null,
        profile: doc.profile?.localId ?? null,
        note: doc.resolutionNote,
        matcherSaid: doc.match.reason ?? doc.status,
      },
    });
    if (input.action === "assign" && doc.openForm) {
      try {
        await runWriteBack(req, id);
      } catch (err) {
        // The assignment stands; the write-back can be retried from the popup.
        console.error("[mail] write-back crashed:", err);
        recordWriteBack(db, id, "failed", [], err instanceof Error ? err.message : String(err));
      }
    }
    res.json({ data: publicDoc(id) });
  });

  // Correct what was read (M15). The notice is re-matched on the corrected
  // fields; the first correction keeps the original reading. Audited with the
  // names of the fields that changed — the values stay in the notice record.
  app.patch("/api/mail/documents/:id/fields", requireAuth, (req, res) => {
    const id = parseId(req.params.id);
    if (!id) {
      res.status(404).json({ error: "Mail document not found" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const edits: FieldEdits = {};
    const EDITABLE = [
      "receiptNumbers", "aNumbers", "caseType", "noticeType", "noticeDate", "receivedDate",
      "priorityDate", "petitioner", "beneficiary", "applicant", "dateOfBirth", "section",
    ] as const;
    for (const key of EDITABLE) {
      const v = body[key];
      if (v === undefined) continue;
      if (v !== null && typeof v !== "string" && !(Array.isArray(v) && v.every((x) => typeof x === "string"))) {
        res.status(400).json({ error: `${key} must be text` });
        return;
      }
      (edits as Record<string, unknown>)[key] = v;
    }
    const user = currentUser(req);
    const result = updateMailDocumentFields(db, id, edits, { userId: user?.id ?? null, userName: user?.name ?? null });
    if (!result.ok) {
      res.status(result.status).json({ error: result.error, ...(result.fieldErrors ? { fieldErrors: result.fieldErrors } : {}) });
      return;
    }
    if (result.changed.length > 0) {
      auditFromReq(req, "mail.fields_edited", {
        targetType: "mail_document",
        targetId: String(id),
        metadata: { changed: result.changed, nowMatched: result.document.status, reason: result.document.match.reason },
      });
    }
    res.json({ data: publicDoc(id) });
  });

  // What Assign would write, for the popup to show before anyone presses it.
  // ?openForm= previews a form other than the one the notice is on now.
  app.get("/api/mail/documents/:id/writeback-plan", requireAuth, (req, res) => {
    const id = parseId(req.params.id);
    const doc = id ? getMailDocument(db, id) : null;
    if (!doc) {
      res.status(404).json({ error: "Mail document not found" });
      return;
    }
    const formId = typeof req.query.openForm === "string" && req.query.openForm ? req.query.openForm : (doc.openForm?.localId ?? null);
    const plan = planForDocument(db, doc, formId);
    if (!writeBackEnabled) plan.blockers.push("Monday write-back isn't configured on this server.");
    res.json({ data: plan });
  });

  // Retry a write-back that failed, partly failed, or was blocked (e.g. before
  // the board's columns synced). Steps that landed or are queued are not redone.
  app.post("/api/mail/documents/:id/writeback", requireAuth, async (req, res) => {
    const id = parseId(req.params.id);
    const doc = id ? getMailDocument(db, id) : null;
    if (!doc || !id) {
      res.status(404).json({ error: "Mail document not found" });
      return;
    }
    if (doc.reviewState !== "assigned" || !doc.openForm) {
      res.status(409).json({ error: "Only a notice assigned to an Open Form can be sent to Monday" });
      return;
    }
    if (doc.writebackState === "done" || doc.writebackState === "queued") {
      res.status(409).json({ error: `Already ${doc.writebackState === "done" ? "in Monday" : "queued for retry"}` });
      return;
    }
    try {
      await runWriteBack(req, id);
    } catch (err) {
      console.error("[mail] write-back retry crashed:", err);
      recordWriteBack(db, id, "failed", doc.writebackSteps, err instanceof Error ? err.message : String(err));
    }
    res.json({ data: publicDoc(id) });
  });
}
