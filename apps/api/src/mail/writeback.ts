// =============================================================================
// Mail write-back executor — push an assigned notice to its Open Form
// =============================================================================
// Runs the plan from libs/query/src/mail-writeback.ts, one step at a time, on
// the same rails as every other write: the acting person's Monday token first,
// the shared token when Monday refuses theirs on permission grounds.
//
// Failure handling per step:
//   - transient (network, timeout, rate limit, 5xx) → the step and every step
//     after it go to the write queue, in order, and retry in the background.
//     The notice's pages are cut to data/mail/notice-<id>.pdf first, so a
//     queued upload still has its bytes after a restart.
//   - anything else (validation, a column Monday rejects) → that step is
//     failed with Monday's message; the next steps still run, since they are
//     independent writes.
//
// A successful (or queued) Receipt No. / Receipt Status write is mirrored into
// board_items at once, so the next scan matches on the new receipt number
// without waiting for a sync — the same optimistic update the status editor
// makes.
// =============================================================================

import type BetterSqlite3 from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { MondayApiError, NetworkError, RateLimitError, TimeoutError } from "@case-pipeline/monday";
import {
  getMailDocument,
  planForDocument,
  recordWriteBack,
  applyLocalColumn,
  overallState,
  type MailWriteBackPlan,
  type StepOutcome,
  type WriteStep,
  type WriteStepKind,
} from "@case-pipeline/query";
import { dataSource } from "../data-source/index.js";
import { withTokenFallback, type TokenFallbackOptions } from "../write-auth.js";
import { enqueueWrite } from "../write-queue/processor.js";

type Database = BetterSqlite3.Database;

export interface WriteBackContext {
  db: Database;
  dataDir: string;
  tokenOptions: TokenFallbackOptions;
  /** Azure OID of the person, so queued retries post under their token. */
  authorOid: string | null;
}

export interface WriteBackResult {
  plan: MailWriteBackPlan;
  state: ReturnType<typeof overallState> | "blocked";
  steps: StepOutcome[];
}

export function isTransient(err: unknown): boolean {
  if (err instanceof RateLimitError || err instanceof NetworkError || err instanceof TimeoutError) return true;
  if (err instanceof MondayApiError) return err.retryable;
  return err instanceof TypeError; // fetch's own network failure
}

/** Cut the notice's pages out of the stored scan into their own PDF (kept for queued retries). */
export async function writeNoticePdf(dataDir: string, scanPdfPath: string, documentId: number, pages: number[]): Promise<string> {
  const source = await PDFDocument.load(fs.readFileSync(path.join(dataDir, scanPdfPath)), { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const copied = await out.copyPages(
    source,
    pages.map((p) => p - 1).filter((i) => i >= 0 && i < source.getPageCount()),
  );
  copied.forEach((p) => out.addPage(p));
  const rel = path.join("mail", `notice-${documentId}.pdf`);
  fs.mkdirSync(path.join(dataDir, "mail"), { recursive: true });
  fs.writeFileSync(path.join(dataDir, rel), await out.save());
  return rel;
}

function enqueueStep(
  ctx: WriteBackContext,
  plan: MailWriteBackPlan,
  documentId: number,
  step: WriteStep,
  noticePdf: string | null,
): void {
  const common = {
    targetTable: "board_items",
    targetLocalId: plan.openFormLocalId,
    mondayItemId: plan.mondayItemId,
    authorOid: ctx.authorOid,
  };
  const tag = { mailDocumentId: documentId, mailStepKind: step.kind };
  if (step.kind === "attach") {
    enqueueWrite(ctx.db, {
      opType: "add_file",
      ...common,
      payload: { columnId: step.columnId, filePath: noticePdf, fileName: step.value, contentType: "application/pdf", ...tag },
    });
  } else {
    enqueueWrite(ctx.db, {
      opType: "change_column",
      ...common,
      payload: { boardId: plan.mondayBoardId, columnId: step.columnId, value: step.value, ...tag },
    });
  }
}

/**
 * Push one assigned notice to Monday. On a retry, steps an earlier run already
 * completed or queued are kept as they are and not run again — the same file
 * must never be attached twice.
 */
export async function executeMailWriteBack(ctx: WriteBackContext, documentId: number): Promise<WriteBackResult> {
  const doc = getMailDocument(ctx.db, documentId);
  if (!doc) throw new Error(`Mail document ${documentId} not found`);
  const kept = doc.writebackSteps.filter((s) => s.result === "done" || s.result === "queued");
  const skipKinds = new Set<WriteStepKind>(kept.map((s) => s.kind));

  const plan = planForDocument(ctx.db, doc, doc.openForm?.localId ?? null);
  if (plan.blockers.length > 0) {
    const steps: StepOutcome[] = [];
    recordWriteBack(ctx.db, documentId, "skipped", steps, plan.blockers.join(" "));
    return { plan, state: "blocked", steps };
  }

  const todo = plan.steps.filter((s) => !skipKinds.has(s.kind));
  const outcomes: StepOutcome[] = [...kept];
  outcomes.push(...plan.skipped
    .filter((s) => !skipKinds.has(s.kind))
    .map((s) => ({ kind: s.kind, columnTitle: "", value: "", result: "skipped" as const, detail: s.reason })));

  let noticePdf: string | null = null;
  let bytes: Uint8Array | null = null;
  if (todo.some((s) => s.kind === "attach") && doc.pdfPath) {
    noticePdf = await writeNoticePdf(ctx.dataDir, doc.pdfPath, documentId, doc.pages);
    bytes = new Uint8Array(fs.readFileSync(path.join(ctx.dataDir, noticePdf)));
  }

  const itemId = plan.mondayItemId!;
  const boardId = plan.mondayBoardId!;
  let queueRest = false;

  for (const step of todo) {
    const base = { kind: step.kind, columnTitle: step.columnTitle, value: step.value };
    if (queueRest) {
      enqueueStep(ctx, plan, documentId, step, noticePdf);
      if (step.kind !== "attach") applyLocalColumn(ctx.db, plan.openFormLocalId!, step.kind, step.value);
      outcomes.push({ ...base, result: "queued" });
      continue;
    }
    try {
      await withTokenFallback(
        (token) =>
          step.kind === "attach"
            ? dataSource.addFile(itemId, step.columnId, step.value, bytes!, "application/pdf", token).then(() => undefined)
            : dataSource.setColumnValue(boardId, itemId, step.columnId, step.value, token),
        ctx.tokenOptions,
      );
      if (step.kind !== "attach") applyLocalColumn(ctx.db, plan.openFormLocalId!, step.kind, step.value);
      outcomes.push({ ...base, result: "done" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (isTransient(err)) {
        console.warn(`[mail-writeback] notice ${documentId}: ${step.kind} hit a transient error, queueing the rest:`, message);
        queueRest = true;
        enqueueStep(ctx, plan, documentId, step, noticePdf);
        if (step.kind !== "attach") applyLocalColumn(ctx.db, plan.openFormLocalId!, step.kind, step.value);
        outcomes.push({ ...base, result: "queued", detail: "Monday didn't answer; retrying in the background." });
      } else {
        console.error(`[mail-writeback] notice ${documentId}: ${step.kind} failed:`, message);
        outcomes.push({ ...base, result: "failed", detail: message });
      }
    }
  }

  const state = overallState(outcomes);
  const firstError = outcomes.find((o) => o.result === "failed")?.detail ?? null;
  recordWriteBack(ctx.db, documentId, state, outcomes, firstError);
  return { plan, state, steps: outcomes };
}
