// =============================================================================
// Mail write-back plan — what an assigned notice changes in Monday
// =============================================================================
// Pure: given the notice, the Open Form as the mirror has it now, and the
// board's synced column schema, list the writes. The same plan is shown to the
// person before they press Assign and then executed, so what they approve is
// exactly what happens.
//
//   receipt_no      Receipt No.     ← the notice's receipt number, only when the
//                                     form has none. A DIFFERENT number already
//                                     there is never overwritten: skipped, and
//                                     said so.
//   receipt_status  Receipt Status  ← "Received", for a receipt notice.
//   attach          Receipt Doc     ← the notice's pages, for a receipt notice;
//                   USCIS Notice      for any other USCIS notice.
//
// Columns are found by title in the synced schema (board_columns), not by a
// hardcoded id, so a re-created column keeps working after the next sync.
//
// Blockers stop the whole write-back: a sample scan (its identifiers come from
// real clients, but its receipt numbers are invented), an Open Form with no
// Monday item (seed data), or a board whose columns never synced.
// =============================================================================

import type BetterSqlite3 from "better-sqlite3";
type Database = BetterSqlite3.Database;
import type { BoardColumns } from "./types";
import type { MailDocumentDetail } from "./mail-review";
import { getBoardColumnsFor } from "./board-columns";

export const OPEN_FORMS_BOARD_KEY = "_cd_open_forms";
const RECEIVED_LABEL = "Received";

export type WriteStepKind = "receipt_no" | "receipt_status" | "attach";

export interface WriteStep {
  kind: WriteStepKind;
  columnId: string;
  columnTitle: string;
  /** Text / status label for column steps; the file name for attach. */
  value: string;
  /** What the column holds now, for the preview ("empty" → X). */
  current: string | null;
}

export interface SkippedStep {
  kind: WriteStepKind;
  reason: string;
}

export interface MailWriteBackPlan {
  openFormLocalId: string | null;
  mondayItemId: string | null;
  mondayBoardId: string | null;
  steps: WriteStep[];
  skipped: SkippedStep[];
  /** Non-empty → nothing is written at all. */
  blockers: string[];
}

export interface OpenFormState {
  localId: string;
  mondayItemId: string | null;
  receiptNo: string | null;
  receiptStatus: string | null;
}

const byTitle = (schema: BoardColumns, re: RegExp, type: string) =>
  schema.columns.find((c) => re.test(c.title.trim()) && c.type === type) ?? null;

export function findWriteBackColumns(schema: BoardColumns) {
  return {
    receiptNo: byTitle(schema, /^receipt no\.?$/i, "text"),
    receiptStatus: byTitle(schema, /^receipt status$/i, "status"),
    receiptDoc: byTitle(schema, /^receipt doc$/i, "file"),
    uscisNotice: byTitle(schema, /^uscis notice$/i, "file"),
  };
}

export function noticeFileName(doc: Pick<MailDocumentDetail, "id" | "fields">): string {
  const f = doc.fields;
  const parts = [f.noticeType ?? "Notice", f.formType, f.receiptNumbers[0], f.noticeDate].filter(Boolean) as string[];
  return `${parts.join(" - ").replace(/[^\w .-]/g, "")} (mail ${doc.id}).pdf`;
}

export function planMailWriteBack(
  doc: Pick<MailDocumentDetail, "id" | "fields" | "isSample" | "reviewState"> & { hasPdf: boolean },
  form: OpenFormState | null,
  schema: BoardColumns | null,
): MailWriteBackPlan {
  const plan: MailWriteBackPlan = {
    openFormLocalId: form?.localId ?? null,
    mondayItemId: form?.mondayItemId ?? null,
    mondayBoardId: schema?.mondayBoardId ?? null,
    steps: [],
    skipped: [],
    blockers: [],
  };

  if (doc.isSample) plan.blockers.push("Sample scans are never written to Monday.");
  if (!form) plan.blockers.push("Assigned to a client only — there is no Open Form to update.");
  else if (!form.mondayItemId) plan.blockers.push("This Open Form has no Monday item (seed data).");
  if (!schema) plan.blockers.push("The Open Forms board's columns haven't synced yet — run a sync first.");
  if (plan.blockers.length > 0 || !form || !schema) return plan;

  const cols = findWriteBackColumns(schema);
  const receipts = doc.fields.receiptNumbers;
  const isReceiptNotice = doc.fields.noticeType === "Receipt Notice";

  // Receipt No.
  if (receipts.length === 1) {
    const incoming = receipts[0]!;
    if (!cols.receiptNo) {
      plan.skipped.push({ kind: "receipt_no", reason: "No “Receipt No.” text column on the board." });
    } else if (!form.receiptNo) {
      plan.steps.push({ kind: "receipt_no", columnId: cols.receiptNo.columnId, columnTitle: cols.receiptNo.title, value: incoming, current: null });
    } else if (form.receiptNo === incoming) {
      plan.skipped.push({ kind: "receipt_no", reason: `Already ${incoming}.` });
    } else {
      plan.skipped.push({
        kind: "receipt_no",
        reason: `Holds ${form.receiptNo}, not ${incoming} — left as is. Fix it by hand if the notice is right.`,
      });
    }
  } else if (receipts.length > 1) {
    plan.skipped.push({ kind: "receipt_no", reason: "The notice shows more than one receipt number." });
  }

  // Receipt Status → Received
  if (isReceiptNotice) {
    const col = cols.receiptStatus;
    if (!col) {
      plan.skipped.push({ kind: "receipt_status", reason: "No “Receipt Status” column on the board." });
    } else if (!col.options.some((o) => o.label === RECEIVED_LABEL)) {
      plan.skipped.push({ kind: "receipt_status", reason: `“${col.title}” has no “${RECEIVED_LABEL}” label.` });
    } else if (form.receiptStatus === RECEIVED_LABEL) {
      plan.skipped.push({ kind: "receipt_status", reason: `Already ${RECEIVED_LABEL}.` });
    } else {
      plan.steps.push({ kind: "receipt_status", columnId: col.columnId, columnTitle: col.title, value: RECEIVED_LABEL, current: form.receiptStatus });
    }
  }

  // Attach the notice
  const fileCol = isReceiptNotice ? (cols.receiptDoc ?? cols.uscisNotice) : (cols.uscisNotice ?? cols.receiptDoc);
  if (!doc.hasPdf) {
    plan.skipped.push({ kind: "attach", reason: "The scan file wasn't stored, so there is nothing to attach." });
  } else if (!fileCol) {
    plan.skipped.push({ kind: "attach", reason: "No “Receipt Doc” or “USCIS Notice” file column on the board." });
  } else {
    plan.steps.push({ kind: "attach", columnId: fileCol.columnId, columnTitle: fileCol.title, value: noticeFileName(doc), current: null });
  }

  return plan;
}

/** The Open Form as the mirror has it right now — read fresh before every plan. */
export function readOpenFormState(db: Database, localId: string): OpenFormState | null {
  const row = db
    .prepare(
      `SELECT local_id AS localId, monday_item_id AS mondayItemId,
              coalesce(json_extract(column_values, '$.receipt_no.text'), json_extract(column_values, '$.receipt_no')) AS receiptNo,
              coalesce(json_extract(column_values, '$.receipt_status.label'), json_extract(column_values, '$.receipt_status')) AS receiptStatus
         FROM board_items WHERE local_id = ? AND board_key = ? AND deleted_at IS NULL`,
    )
    .get(localId, OPEN_FORMS_BOARD_KEY) as
    | { localId: string; mondayItemId: string | null; receiptNo: unknown; receiptStatus: unknown }
    | undefined;
  if (!row) return null;
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const receipt = text(row.receiptNo);
  return {
    localId: row.localId,
    mondayItemId: row.mondayItemId,
    receiptNo: receipt ? receipt.replace(/[\s-]/g, "").toUpperCase() : null,
    receiptStatus: text(row.receiptStatus),
  };
}

export function planForDocument(
  db: Database,
  doc: MailDocumentDetail & { hasPdf?: boolean },
  openFormLocalId: string | null,
): MailWriteBackPlan {
  return planMailWriteBack(
    { ...doc, hasPdf: doc.hasPdf ?? Boolean(doc.pdfPath) },
    openFormLocalId ? readOpenFormState(db, openFormLocalId) : null,
    getBoardColumnsFor(db, OPEN_FORMS_BOARD_KEY),
  );
}

// -----------------------------------------------------------------------------
// Recording the outcome
// -----------------------------------------------------------------------------

export type WriteBackState = "none" | "done" | "partial" | "queued" | "failed" | "skipped";

export interface StepOutcome {
  kind: WriteStepKind;
  columnTitle: string;
  value: string;
  result: "done" | "queued" | "failed" | "skipped";
  detail?: string;
}

export function recordWriteBack(
  db: Database,
  documentId: number,
  state: WriteBackState,
  steps: StepOutcome[],
  error: string | null,
): void {
  db.prepare(
    `UPDATE mail_documents
        SET writeback_state = ?, writeback_steps = ?, writeback_error = ?, writeback_at = datetime('now')
      WHERE id = ?`,
  ).run(state, JSON.stringify(steps), error, documentId);
}

/** Mirror a successful column write locally, so the next scan matches on it at once. */
export function applyLocalColumn(db: Database, openFormLocalId: string, key: "receipt_no" | "receipt_status", value: string): void {
  const json = key === "receipt_status" ? JSON.stringify({ label: value }) : JSON.stringify(value);
  db.prepare(
    `UPDATE board_items SET column_values = json_set(column_values, '$.${key}', json(?))
      WHERE local_id = ? AND board_key = ?`,
  ).run(json, openFormLocalId, OPEN_FORMS_BOARD_KEY);
}

export function overallState(steps: StepOutcome[]): WriteBackState {
  const real = steps.filter((s) => s.result !== "skipped");
  if (real.length === 0) return "skipped";
  if (real.every((s) => s.result === "done")) return "done";
  if (real.some((s) => s.result === "failed")) return real.some((s) => s.result === "done") ? "partial" : "failed";
  return "queued";
}

/**
 * A queued step finished (or dead-lettered) in the write queue: update that
 * step on the notice and recompute its overall state, so "queued" doesn't
 * outlive the retry that settled it.
 */
export function settleQueuedMailStep(
  db: Database,
  documentId: number,
  kind: WriteStepKind,
  result: "done" | "failed",
  detail?: string,
): void {
  const row = db.prepare(`SELECT writeback_steps AS steps FROM mail_documents WHERE id = ?`).get(documentId) as
    | { steps: string | null }
    | undefined;
  if (!row?.steps) return;
  const steps = (JSON.parse(row.steps) as StepOutcome[]).map((s) =>
    s.kind === kind && s.result === "queued" ? { ...s, result, ...(detail ? { detail } : {}) } : s,
  );
  const state = overallState(steps);
  db.prepare(
    `UPDATE mail_documents SET writeback_state = ?, writeback_steps = ?, writeback_error = ?, writeback_at = datetime('now') WHERE id = ?`,
  ).run(state, JSON.stringify(steps), result === "failed" ? (detail ?? "Retry failed") : null, documentId);
}
