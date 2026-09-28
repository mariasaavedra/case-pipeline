// =============================================================================
// Mail write-back executor tests
// =============================================================================
// Monday is mocked at the dataSource seam. What matters: the right writes in
// the right order, an outage turning the rest into queued retries (with the
// notice's PDF on disk), a rejected step not stopping the others, a retry
// never attaching the same file twice, and samples never reaching Monday.
// =============================================================================

import { test, expect, describe, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { initializeSchema } from "@case-pipeline/seed/db/schema";
import { NetworkError, MondayApiError } from "@case-pipeline/monday";
import {
  scanMailPages,
  saveMailScan,
  setMailScanPdfPath,
  resolveMailDocument,
  getMailDocument,
  readOpenFormState,
  settleQueuedMailStep,
} from "@case-pipeline/query";

const calls: Array<{ op: string; columnId: string; value: string }> = [];
const setColumnValue = vi.fn(async (_b: string, _i: string, columnId: string, value: string) => {
  calls.push({ op: "column", columnId, value });
});
const addFile = vi.fn(async (_i: string, columnId: string, fileName: string, bytes: Uint8Array) => {
  calls.push({ op: "file", columnId, value: `${fileName}:${bytes.length > 0}` });
  return "asset-1";
});
vi.mock("../data-source/index.js", () => ({
  dataSource: {
    setColumnValue: (...a: Parameters<typeof setColumnValue>) => setColumnValue(...a),
    addFile: (...a: Parameters<typeof addFile>) => addFile(...a),
  },
}));

const { executeMailWriteBack } = await import("./writeback.js");

let dataDir: string;

function setup(opts: { sample?: boolean; mondayItemId?: string | null } = {}) {
  const db = new Database(":memory:");
  initializeSchema(db);
  db.prepare("INSERT INTO seed_batches (batch_name, seed_value, status) VALUES ('t', 1, 'complete')").run();
  db.prepare("INSERT INTO profiles (batch_id, local_id, name, a_number) VALUES (1, 'p1', 'Juan Lopez', '123456789')").run();
  db.prepare(
    `INSERT INTO board_items (batch_id, local_id, monday_item_id, board_key, name, status, profile_local_id, column_values)
     VALUES (1, 'f1', ?, '_cd_open_forms', 'Juan Lopez', 'Sent Out', 'p1', ?)`,
  ).run(
    opts.mondayItemId === undefined ? "999" : opts.mondayItemId,
    JSON.stringify({ forms: { labels: ["I130"] }, receipt_status: { label: "Waiting on it" } }),
  );
  const col = db.prepare(
    `INSERT INTO board_columns (board_key, monday_board_id, column_id, title, type, options, position) VALUES ('_cd_open_forms', 'B1', ?, ?, ?, ?, ?)`,
  );
  col.run("text_mkrzbmt1", "Receipt No.", "text", null, 1);
  col.run(
    "color_mkrzddj2",
    "Receipt Status",
    "status",
    JSON.stringify([{ index: 1, label: "Received", color: "#0c0", border: "#0c0" }]),
    2,
  );
  col.run("file_mm223wma", "Receipt Doc", "file", null, 3);
  col.run("file_mm1sag13", "USCIS Notice", "file", null, 4);

  const saved = saveMailScan(
    db,
    { fileName: "mail.pdf", pdfPath: null, isSample: Boolean(opts.sample), uploadedBy: 7, uploadedByName: "Front Desk" },
    scanMailPages(db, ["Notice of Action Receipt Number: IOE0912345678 Form I-130 A# 123-456-789 Receipt Notice"]),
  );
  const docId = saved.documents[0]!.id!;
  return { db, docId, scanId: saved.scanId! };
}

async function storeScan(db: Database.Database, scanId: number) {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  fs.mkdirSync(path.join(dataDir, "mail"), { recursive: true });
  const rel = path.join("mail", `scan-${scanId}.pdf`);
  fs.writeFileSync(path.join(dataDir, rel), await pdf.save());
  setMailScanPdfPath(db, scanId, rel);
}

const ctx = (db: Database.Database) => ({ db, dataDir, tokenOptions: { sharedToken: "shared" }, authorOid: "oid-1" });
const queued = (db: Database.Database) =>
  db.prepare("SELECT op_type AS op, payload FROM write_queue ORDER BY id").all() as { op: string; payload: string }[];

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mail-wb-"));
  calls.length = 0;
  setColumnValue.mockClear();
  addFile.mockClear();
});
afterEach(() => fs.rmSync(dataDir, { recursive: true, force: true }));

describe("executeMailWriteBack", () => {
  test("receipt notice: number, status, then the notice's pages — and the mirror learns the number", async () => {
    const { db, docId, scanId } = setup();
    await storeScan(db, scanId);
    resolveMailDocument(db, docId, { action: "assign", openFormLocalId: "f1" }, { userId: 7, userName: "Front Desk" });

    const r = await executeMailWriteBack(ctx(db), docId);
    expect(r.state).toBe("done");
    expect(calls.map((c) => [c.op, c.columnId])).toEqual([
      ["column", "text_mkrzbmt1"],
      ["column", "color_mkrzddj2"],
      ["file", "file_mm223wma"],
    ]);
    expect(calls[0]!.value).toBe("IOE0912345678");
    expect(calls[2]!.value).toMatch(/Receipt Notice - I130 - IOE0912345678.*\(mail \d+\)\.pdf:true/);
    expect(readOpenFormState(db, "f1")).toMatchObject({ receiptNo: "IOE0912345678", receiptStatus: "Received" });
    expect(getMailDocument(db, docId)).toMatchObject({ writebackState: "done", writebackError: null });
    expect(fs.existsSync(path.join(dataDir, "mail", `notice-${docId}.pdf`))).toBe(true);
  });

  test("an outage mid-way queues that step and the rest, in order, with the PDF on disk", async () => {
    const { db, docId, scanId } = setup();
    await storeScan(db, scanId);
    resolveMailDocument(db, docId, { action: "assign", openFormLocalId: "f1" }, { userId: 7, userName: "x" });
    setColumnValue
      .mockImplementationOnce(async (_b, _i, columnId, value) => void calls.push({ op: "column", columnId, value }))
      .mockRejectedValueOnce(new NetworkError("socket hang up"));

    const r = await executeMailWriteBack(ctx(db), docId);
    expect(r.steps.map((s) => [s.kind, s.result])).toEqual([
      ["receipt_no", "done"],
      ["receipt_status", "queued"],
      ["attach", "queued"],
    ]);
    expect(r.state).toBe("queued");
    expect(addFile).not.toHaveBeenCalled();

    const q = queued(db);
    expect(q.map((x) => x.op)).toEqual(["change_column", "add_file"]);
    const filePayload = JSON.parse(q[1]!.payload);
    expect(filePayload).toMatchObject({ columnId: "file_mm223wma", mailDocumentId: docId, mailStepKind: "attach" });
    expect(fs.existsSync(path.join(dataDir, filePayload.filePath))).toBe(true);
    // Queued status is mirrored optimistically, like the status editor does.
    expect(readOpenFormState(db, "f1")!.receiptStatus).toBe("Received");

    // The queue later settles both steps.
    settleQueuedMailStep(db, docId, "receipt_status", "done");
    settleQueuedMailStep(db, docId, "attach", "done");
    expect(getMailDocument(db, docId)!.writebackState).toBe("done");
  });

  test("a step Monday rejects fails alone; a retry redoes only that step", async () => {
    const { db, docId, scanId } = setup();
    await storeScan(db, scanId);
    resolveMailDocument(db, docId, { action: "assign", openFormLocalId: "f1" }, { userId: 7, userName: "x" });
    addFile.mockRejectedValueOnce(new MondayApiError("Monday API errors: invalid file column", 200, false));

    const first = await executeMailWriteBack(ctx(db), docId);
    expect(first.state).toBe("partial");
    expect(getMailDocument(db, docId)!.writebackError).toMatch(/invalid file column/);
    expect(setColumnValue).toHaveBeenCalledTimes(2);

    calls.length = 0;
    const retry = await executeMailWriteBack(ctx(db), docId);
    expect(retry.state).toBe("done");
    // Receipt No. and Status were not written again; only the file was.
    expect(calls.map((c) => c.op)).toEqual(["file"]);
  });

  test("a sample scan never reaches Monday", async () => {
    const { db, docId, scanId } = setup({ sample: true });
    await storeScan(db, scanId);
    resolveMailDocument(db, docId, { action: "assign", openFormLocalId: "f1" }, { userId: 7, userName: "x" });
    const r = await executeMailWriteBack(ctx(db), docId);
    expect(r.state).toBe("blocked");
    expect(calls).toEqual([]);
    expect(queued(db)).toEqual([]);
    expect(getMailDocument(db, docId)).toMatchObject({ writebackState: "skipped" });
    expect(getMailDocument(db, docId)!.writebackError).toMatch(/Sample/);
  });

  test("seed data (no Monday item) is blocked too", async () => {
    const { db, docId } = setup({ mondayItemId: null });
    resolveMailDocument(db, docId, { action: "assign", openFormLocalId: "f1" }, { userId: 7, userName: "x" });
    expect((await executeMailWriteBack(ctx(db), docId)).state).toBe("blocked");
    expect(calls).toEqual([]);
  });

  test("a different receipt already on the form is left alone; the rest still goes", async () => {
    const { db, docId, scanId } = setup();
    await storeScan(db, scanId);
    db.prepare(`UPDATE board_items SET column_values = json_set(column_values, '$.receipt_no', 'MSC2290000001') WHERE local_id = 'f1'`).run();
    resolveMailDocument(db, docId, { action: "assign", openFormLocalId: "f1" }, { userId: 7, userName: "x" });
    const r = await executeMailWriteBack(ctx(db), docId);
    expect(calls.map((c) => c.columnId)).toEqual(["color_mkrzddj2", "file_mm223wma"]);
    expect(r.steps.find((s) => s.kind === "receipt_no")).toMatchObject({ result: "skipped" });
    expect(readOpenFormState(db, "f1")!.receiptNo).toBe("MSC2290000001");
  });
});
