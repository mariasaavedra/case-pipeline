// =============================================================================
// Mail review — saved scans, and the notices a person has to settle
// =============================================================================
// scanMailPages (mail.ts) decides; this module remembers. Every uploaded scan
// is saved with its notices, and the ones flagged needsReview show up in
// Alerts → "Mail to review" until someone assigns them to an Open Form (or a
// client) or dismisses them.
//
// Assigning is still bookkeeping only: it records the decision and who made
// it. Writing the receipt number / attaching the PDF in Monday is the next
// step, and will read these decisions.
//
// Sample scans (the "Try a sample" buttons) are saved like any other so the
// flow can be tried end to end, but drop out of Alerts after SAMPLE_TTL_HOURS
// so a test run never leaves staff a pile of fake work.
// =============================================================================

import type BetterSqlite3 from "better-sqlite3";
type Database = BetterSqlite3.Database;
import type { AlertGroup, AlertItem } from "./types";
import type {
  AttentionReason,
  MailScanResult,
  MatchedOpenForm,
  MatchedProfile,
  MatchStatus,
  NoticeFields,
  NoticeMatch,
  SplitReason,
} from "./mail";
import { findFormsForProfile } from "./mail";

const SAMPLE_TTL_HOURS = 24;
const ALERT_ITEM_LIMIT = 50;

export type MailReviewState = "open" | "assigned" | "dismissed";

export interface SaveScanInput {
  fileName: string;
  pdfPath: string | null;
  isSample: boolean;
  uploadedBy: number | null;
  uploadedByName: string | null;
}

export interface MailDocumentDetail {
  id: number;
  scanId: number;
  fileName: string;
  isSample: boolean;
  uploadedAt: string;
  uploadedByName: string | null;
  pdfPath: string | null;
  pages: number[];
  splitReason: SplitReason;
  uncertainPages: number[];
  ocrConfidence: number | null;
  fields: NoticeFields;
  match: NoticeMatch;
  status: MatchStatus;
  needsReview: boolean;
  reviewState: MailReviewState;
  resolvedByName: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  /** What the review settled on (or the matcher, if it never needed review). */
  profile: MatchedProfile | null;
  openForm: MatchedOpenForm | null;
}

// -----------------------------------------------------------------------------
// Saving
// -----------------------------------------------------------------------------

/** Stores a scan and its notices; fills in result.scanId and each document's id. */
export function saveMailScan(db: Database, input: SaveScanInput, result: MailScanResult): MailScanResult {
  const insertScan = db.prepare(
    `INSERT INTO mail_scans (file_name, total_pages, ocr_pages, pdf_path, is_sample, uploaded_by, uploaded_by_name)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertDoc = db.prepare(
    `INSERT INTO mail_documents
       (scan_id, pages, split_reason, uncertain_pages, ocr_confidence, fields, match, status, reason, message,
        profile_local_id, open_form_local_id, needs_review)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  return db.transaction(() => {
    const scanId = Number(
      insertScan.run(
        input.fileName,
        result.totalPages,
        result.ocrPages.length,
        input.pdfPath,
        input.isSample ? 1 : 0,
        input.uploadedBy,
        input.uploadedByName,
      ).lastInsertRowid,
    );
    const documents = result.documents.map((d) => {
      const id = Number(
        insertDoc.run(
          scanId,
          JSON.stringify(d.pages),
          d.splitReason,
          JSON.stringify(d.uncertainPages),
          d.ocrConfidence,
          JSON.stringify(d.fields),
          JSON.stringify(d.match),
          d.match.status,
          d.match.reason,
          d.match.message,
          d.match.profile?.localId ?? null,
          d.match.openForm?.localId ?? null,
          d.needsReview ? 1 : 0,
        ).lastInsertRowid,
      );
      return { ...d, id };
    });
    return { ...result, scanId, documents };
  })();
}

/** The PDF is written after the scan row exists (its name uses the id). */
export function setMailScanPdfPath(db: Database, scanId: number, pdfPath: string): void {
  db.prepare(`UPDATE mail_scans SET pdf_path = ? WHERE id = ?`).run(pdfPath, scanId);
}

// -----------------------------------------------------------------------------
// Reading
// -----------------------------------------------------------------------------

interface DocRow {
  id: number;
  scanId: number;
  fileName: string;
  isSample: number;
  uploadedAt: string;
  uploadedByName: string | null;
  pdfPath: string | null;
  pages: string;
  splitReason: SplitReason;
  uncertainPages: string;
  ocrConfidence: number | null;
  fields: string;
  match: string;
  status: MatchStatus;
  reason: AttentionReason | null;
  message: string;
  profileLocalId: string | null;
  openFormLocalId: string | null;
  needsReview: number;
  reviewState: MailReviewState;
  resolvedByName: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
}

const DOC_SELECT = `
  SELECT d.id, d.scan_id AS scanId, s.file_name AS fileName, s.is_sample AS isSample,
         s.uploaded_at AS uploadedAt, s.uploaded_by_name AS uploadedByName, s.pdf_path AS pdfPath,
         d.pages, d.split_reason AS splitReason, d.uncertain_pages AS uncertainPages,
         d.ocr_confidence AS ocrConfidence, d.fields, d.match, d.status, d.reason, d.message,
         d.profile_local_id AS profileLocalId, d.open_form_local_id AS openFormLocalId,
         d.needs_review AS needsReview, d.review_state AS reviewState,
         d.resolved_by_name AS resolvedByName, d.resolved_at AS resolvedAt, d.resolution_note AS resolutionNote
  FROM mail_documents d JOIN mail_scans s ON s.id = d.scan_id`;

/** Open, needs a person, and not an expired sample. */
const OPEN_REVIEW_WHERE = `
  d.needs_review = 1 AND d.review_state = 'open'
  AND (s.is_sample = 0 OR s.uploaded_at > datetime('now', '-${SAMPLE_TTL_HOURS} hours'))`;

function getProfile(db: Database, localId: string | null): MatchedProfile | null {
  if (!localId) return null;
  return (
    (db
      .prepare(`SELECT local_id AS localId, name, a_number AS aNumber FROM profiles WHERE local_id = ?`)
      .get(localId) as MatchedProfile | undefined) ?? null
  );
}

function getOpenForm(db: Database, localId: string | null, profileLocalId: string | null): MatchedOpenForm | null {
  if (!localId) return null;
  if (profileLocalId) {
    const found = findFormsForProfile(db, profileLocalId).find((f) => f.localId === localId);
    if (found) return found;
  }
  const owner = db
    .prepare(`SELECT profile_local_id AS p FROM board_items WHERE local_id = ? AND board_key = '_cd_open_forms'`)
    .get(localId) as { p: string | null } | undefined;
  return owner?.p ? (findFormsForProfile(db, owner.p).find((f) => f.localId === localId) ?? null) : null;
}

function toDetail(db: Database, r: DocRow): MailDocumentDetail {
  return {
    id: r.id,
    scanId: r.scanId,
    fileName: r.fileName,
    isSample: r.isSample === 1,
    uploadedAt: r.uploadedAt,
    uploadedByName: r.uploadedByName,
    pdfPath: r.pdfPath,
    pages: JSON.parse(r.pages) as number[],
    splitReason: r.splitReason,
    uncertainPages: JSON.parse(r.uncertainPages) as number[],
    ocrConfidence: r.ocrConfidence,
    fields: JSON.parse(r.fields) as NoticeFields,
    match: JSON.parse(r.match) as NoticeMatch,
    status: r.status,
    needsReview: r.needsReview === 1,
    reviewState: r.reviewState,
    resolvedByName: r.resolvedByName,
    resolvedAt: r.resolvedAt,
    resolutionNote: r.resolutionNote,
    profile: getProfile(db, r.profileLocalId),
    openForm: getOpenForm(db, r.openFormLocalId, r.profileLocalId),
  };
}

export function getMailDocument(db: Database, id: number): MailDocumentDetail | null {
  const row = db.prepare(`${DOC_SELECT} WHERE d.id = ?`).get(id) as DocRow | undefined;
  return row ? toDetail(db, row) : null;
}

export function countMailToReview(db: Database): number {
  return (
    db
      .prepare(`SELECT COUNT(*) AS n FROM mail_documents d JOIN mail_scans s ON s.id = d.scan_id WHERE ${OPEN_REVIEW_WHERE}`)
      .get() as { n: number }
  ).n;
}

const REASON_LABEL: Record<AttentionReason, string> = {
  several_profiles: "Several clients",
  several_forms: "Several Open Forms",
  no_open_form: "No Open Form",
  receipt_already_filled: "Receipt already filled",
  identifier_mismatch: "Numbers disagree",
  several_receipts: "Two notices?",
};

function statusLabel(d: MailDocumentDetail): string {
  if (d.status === "no_match") return "No match";
  if (d.status === "unreadable") return "Unreadable";
  if (d.match.reason) return REASON_LABEL[d.match.reason];
  if (d.uncertainPages.length > 0) return "Check split";
  return "Low OCR confidence";
}

function detailLine(d: MailDocumentDetail): string {
  const parts = [d.match.message];
  if (d.status === "matched" && d.ocrConfidence != null) parts.push(`OCR confidence ${d.ocrConfidence}%.`);
  if (d.uncertainPages.length > 0) parts.push(`Page ${d.uncertainPages.join(", ")} may belong to another notice.`);
  return parts.join(" ");
}

/** Alerts → "Mail to review". Mail has no attorney, so an attorney filter hides it. */
export function getMailReviewAlertGroup(db: Database, opts: { attorney?: string } = {}): AlertGroup {
  const base: AlertGroup = {
    severity: "warning",
    label: "Mail to review",
    description: "Scanned notices that couldn't be matched to one Open Form",
    count: 0,
    items: [],
  };
  if (opts.attorney) return base;

  const rows = db
    .prepare(`${DOC_SELECT} WHERE ${OPEN_REVIEW_WHERE} ORDER BY s.uploaded_at DESC, d.id LIMIT ${ALERT_ITEM_LIMIT}`)
    .all() as DocRow[];
  const items: AlertItem[] = rows.map((r) => {
    const d = toDetail(db, r);
    const who = d.profile ?? d.match.profile;
    return {
      localId: `mail-${d.id}`,
      name: `${d.fields.noticeType ?? "Unknown document"}${d.fields.formType ? ` · ${d.fields.formType}` : ""}`,
      boardKey: null,
      status: statusLabel(d),
      clientName: who?.name ?? d.fields.people[0]?.name ?? null,
      clientLocalId: who?.localId ?? null,
      attorney: null,
      date: d.uploadedAt,
      mailDocumentId: d.id,
      detail: detailLine(d),
      sample: d.isSample,
    };
  });
  return { ...base, count: countMailToReview(db), items };
}

// -----------------------------------------------------------------------------
// Resolving
// -----------------------------------------------------------------------------

export type ResolveMailInput =
  | { action: "assign"; openFormLocalId?: string | null; profileLocalId?: string | null; note?: string | null }
  | { action: "dismiss"; note?: string | null };

export type ResolveResult = { ok: true; document: MailDocumentDetail } | { ok: false; status: number; error: string };

/**
 * Assign: to an Open Form (its client comes with it), or to a client alone
 * when the notice has no form yet (e.g. a new case). Dismiss: not client mail,
 * a duplicate, or handled by hand — a note is required so the trail says why.
 */
export function resolveMailDocument(
  db: Database,
  id: number,
  input: ResolveMailInput,
  by: { userId: number | null; userName: string | null },
): ResolveResult {
  const current = getMailDocument(db, id);
  if (!current) return { ok: false, status: 404, error: "Mail document not found" };
  if (current.reviewState !== "open") {
    return { ok: false, status: 409, error: `Already ${current.reviewState} by ${current.resolvedByName ?? "someone"}` };
  }
  const note = input.note?.trim() || null;

  let profileLocalId: string | null = null;
  let openFormLocalId: string | null = null;
  if (input.action === "assign") {
    if (input.openFormLocalId) {
      const form = getOpenForm(db, input.openFormLocalId, input.profileLocalId ?? null);
      if (!form) return { ok: false, status: 400, error: "That Open Form doesn't exist" };
      if (input.profileLocalId && form.profileLocalId && form.profileLocalId !== input.profileLocalId) {
        return { ok: false, status: 400, error: "That Open Form belongs to a different client" };
      }
      openFormLocalId = form.localId;
      profileLocalId = form.profileLocalId;
    } else if (input.profileLocalId) {
      if (!getProfile(db, input.profileLocalId)) return { ok: false, status: 400, error: "That client doesn't exist" };
      profileLocalId = input.profileLocalId;
    } else {
      return { ok: false, status: 400, error: "Pick an Open Form or a client" };
    }
  } else if (!note) {
    return { ok: false, status: 400, error: "Say why it's being dismissed" };
  }

  db.prepare(
    `UPDATE mail_documents
        SET review_state = ?, profile_local_id = COALESCE(?, profile_local_id),
            open_form_local_id = COALESCE(?, open_form_local_id),
            resolved_by = ?, resolved_by_name = ?, resolved_at = datetime('now'), resolution_note = ?
      WHERE id = ? AND review_state = 'open'`,
  ).run(
    input.action === "assign" ? "assigned" : "dismissed",
    profileLocalId,
    openFormLocalId,
    by.userId,
    by.userName,
    note,
    id,
  );
  return { ok: true, document: getMailDocument(db, id)! };
}
