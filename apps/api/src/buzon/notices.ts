// =============================================================================
// Buzón — a client's USCIS / court notice goes to mail review (docs/features/buzon.md, Phase 3)
// =============================================================================
// A file the client sent as "Letter from USCIS or the court" is read like
// scanned mail (text layer, else OCR: mail/ocr.ts → scanMailPages) and saved
// as a mail scan flagged for review, so it shows in Alerts → "Mail to review"
// (M15) with what was read — receipt number, dates, the matching Open Form —
// for staff to assign and write back. The client is already known (their
// link), so the notice is tied to them when the reader couldn't tell.
// Photos are made into a PDF first; the PDF is kept under data/mail/ like the
// older scans, so M15 can show it. The upload itself is still filed to CAF.
// =============================================================================

import fs from "node:fs";
import path from "node:path";
import type BetterSqlite3 from "better-sqlite3";
type DatabaseInstance = BetterSqlite3.Database;
import { saveMailScan, scanMailPages, setMailScanPdfPath } from "@case-pipeline/query";
import { readPdfPages } from "../mail/ocr.js";
import { recordAudit } from "../audit/log.js";
import { QUIET_MINUTES } from "../uploads/filing.js";
import { imagesToPdf, isPageImage, openable } from "../uploads/convert.js";

interface NoticeRow {
  id: number;
  local_file: string;
  content_type: string;
  stored_name: string;
  profile_local_id: string;
}

/** Read each new notice once (mail_document_id stamped; 0 = could not be read). Returns how many went to review. */
export async function readClientNotices(db: DatabaseInstance, dataDir: string): Promise<number> {
  const rows = db.prepare(`
    SELECT u.id, u.local_file, u.content_type, u.stored_name, l.profile_local_id
      FROM client_uploads u JOIN upload_links l ON l.id = u.link_id
     WHERE u.kind = 'notice' AND u.mail_document_id IS NULL AND u.local_file IS NOT NULL
       AND u.received_at <= datetime('now', ?)
     ORDER BY u.id LIMIT 20
  `).all(`-${QUIET_MINUTES} minutes`) as NoticeRow[];
  const stamp = db.prepare("UPDATE client_uploads SET mail_document_id = ? WHERE id = ?");
  let sent = 0;
  for (const r of rows) {
    const file = path.join(dataDir, "uploads", r.local_file);
    if (!fs.existsSync(file) || !(r.content_type === "application/pdf" || isPageImage(r.content_type))) {
      stamp.run(0, r.id);
      continue;
    }
    try {
      let pdf: Buffer = fs.readFileSync(file);
      if (r.content_type !== "application/pdf") {
        pdf = await imagesToPdf([await openable({ bytes: pdf, contentType: r.content_type, name: r.stored_name })]);
      }
      const read = scanMailPages(db, await readPdfPages(new Uint8Array(pdf)), { split: false });
      if (!read.documents.length) {
        stamp.run(0, r.id);
        continue;
      }
      // Every reading waits for a person (Alerts → Mail to review).
      read.documents = read.documents.map((d) => ({ ...d, needsReview: true }));
      const saved = saveMailScan(db, { fileName: `From the client (Buzón): ${r.stored_name}`, pdfPath: null, isSample: false, uploadedBy: null, uploadedByName: "Client (Buzón)" }, read);
      const rel = path.join("mail", `scan-${saved.scanId}.pdf`);
      fs.mkdirSync(path.join(dataDir, "mail"), { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(dataDir, rel), pdf, { mode: 0o600 });
      setMailScanPdfPath(db, saved.scanId!, rel);
      const docId = (saved.documents[0] as { id?: number }).id ?? 0;
      db.prepare("UPDATE mail_documents SET profile_local_id = ? WHERE scan_id = ? AND profile_local_id IS NULL").run(r.profile_local_id, saved.scanId);
      stamp.run(docId, r.id);
      recordAudit({
        actor: { userId: null, email: "client-upload-link" }, action: "client_upload.notice_read",
        targetType: "profile", targetId: r.profile_local_id, metadata: { upload: r.id, scan: saved.scanId, status: saved.documents[0]?.match.status },
      });
      sent++;
    } catch (err) {
      console.error(`[buzon] reading notice upload ${r.id} failed:`, err instanceof Error ? err.message : err);
      stamp.run(0, r.id);
    }
  }
  return sent;
}
