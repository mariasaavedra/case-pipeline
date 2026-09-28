// =============================================================================
// Mail write-back plan tests
// =============================================================================
// The plan is what a person approves before anything reaches a client's case
// in Monday, so the tests pin down what it refuses: overwriting a different
// receipt number, writing a sample, writing to seed data.
// =============================================================================

import { test, expect, describe } from "vitest";
import Database from "better-sqlite3";
import { initializeSchema } from "@case-pipeline/seed/db/schema";
import type { BoardColumns, StatusColumnOption } from "./types";
import type { NoticeFields } from "./mail";
import {
  planMailWriteBack,
  readOpenFormState,
  applyLocalColumn,
  overallState,
  noticeFileName,
  type OpenFormState,
} from "./mail-writeback";

const opt = (label: string): StatusColumnOption => ({ index: 0, label, color: "#000", border: "#000" });

const SCHEMA: BoardColumns = {
  boardKey: "_cd_open_forms",
  mondayBoardId: "8025566986",
  columns: [
    { columnId: "text_mkrzbmt1", title: "Receipt No.", type: "text", options: [], position: 1 },
    { columnId: "color_mkrzddj2", title: "Receipt Status", type: "status", options: [opt("Received"), opt("Waiting on it")], position: 2 },
    { columnId: "file_mm223wma", title: "Receipt Doc", type: "file", options: [], position: 3 },
    { columnId: "file_mm1sag13", title: "USCIS Notice", type: "file", options: [], position: 4 },
    // Look-alikes that must NOT be picked: a mirror with a similar title.
    { columnId: "lookup_x", title: "Receipt NO. - ORIGINALS", type: "mirror", options: [], position: 5 },
  ],
};

function fields(over: Partial<NoticeFields> = {}): NoticeFields {
  return {
    receiptNumbers: ["IOE0912345678"],
    aNumbers: ["123456789"],
    formType: "I130",
    noticeType: "Receipt Notice",
    noticeDate: "2026-09-22",
    people: [],
    ...over,
  };
}

const doc = (over: Partial<Parameters<typeof planMailWriteBack>[0]> = {}) => ({
  id: 5,
  fields: fields(),
  isSample: false,
  reviewState: "assigned" as const,
  hasPdf: true,
  ...over,
});

const FORM: OpenFormState = { localId: "f1", mondayItemId: "999", receiptNo: null, receiptStatus: "Waiting on it" };

describe("planMailWriteBack", () => {
  test("receipt notice on an empty form: number, status, file to Receipt Doc", () => {
    const plan = planMailWriteBack(doc(), FORM, SCHEMA);
    expect(plan.blockers).toEqual([]);
    expect(plan.steps.map((s) => [s.kind, s.columnId, s.value])).toEqual([
      ["receipt_no", "text_mkrzbmt1", "IOE0912345678"],
      ["receipt_status", "color_mkrzddj2", "Received"],
      ["attach", "file_mm223wma", noticeFileName(doc())],
    ]);
    expect(plan.steps[1]!.current).toBe("Waiting on it");
    expect(plan).toMatchObject({ mondayItemId: "999", mondayBoardId: "8025566986" });
  });

  test("a different receipt number already on the form is never overwritten", () => {
    const plan = planMailWriteBack(doc(), { ...FORM, receiptNo: "MSC2290000001" }, SCHEMA);
    expect(plan.steps.map((s) => s.kind)).toEqual(["receipt_status", "attach"]);
    expect(plan.skipped[0]).toMatchObject({ kind: "receipt_no" });
    expect(plan.skipped[0]!.reason).toContain("MSC2290000001");
  });

  test("the same number and status already there are skipped, not rewritten", () => {
    const plan = planMailWriteBack(doc(), { ...FORM, receiptNo: "IOE0912345678", receiptStatus: "Received" }, SCHEMA);
    expect(plan.steps.map((s) => s.kind)).toEqual(["attach"]);
    expect(plan.skipped.map((s) => s.kind)).toEqual(["receipt_no", "receipt_status"]);
  });

  test("a non-receipt notice attaches to USCIS Notice and leaves the status alone", () => {
    const plan = planMailWriteBack(doc({ fields: fields({ noticeType: "Approval Notice" }) }), { ...FORM, receiptNo: "IOE0912345678" }, SCHEMA);
    expect(plan.steps.map((s) => [s.kind, s.columnId])).toEqual([["attach", "file_mm1sag13"]]);
  });

  test("two receipt numbers on one notice: no number is written", () => {
    const plan = planMailWriteBack(doc({ fields: fields({ receiptNumbers: ["IOE0900000001", "IOE0900000002"] }) }), FORM, SCHEMA);
    expect(plan.steps.some((s) => s.kind === "receipt_no")).toBe(false);
  });

  test("no stored PDF: nothing to attach, the rest still goes", () => {
    const plan = planMailWriteBack(doc({ hasPdf: false }), FORM, SCHEMA);
    expect(plan.steps.map((s) => s.kind)).toEqual(["receipt_no", "receipt_status"]);
    expect(plan.skipped.map((s) => s.kind)).toEqual(["attach"]);
  });

  test("blockers: sample, client-only, seed data, unsynced board", () => {
    expect(planMailWriteBack(doc({ isSample: true }), FORM, SCHEMA).blockers[0]).toMatch(/Sample/);
    expect(planMailWriteBack(doc(), null, SCHEMA).blockers[0]).toMatch(/client only/);
    expect(planMailWriteBack(doc(), { ...FORM, mondayItemId: null }, SCHEMA).blockers[0]).toMatch(/no Monday item/);
    expect(planMailWriteBack(doc(), FORM, null).blockers[0]).toMatch(/synced/);
    for (const plan of [planMailWriteBack(doc({ isSample: true }), FORM, SCHEMA), planMailWriteBack(doc(), FORM, null)]) {
      expect(plan.steps).toEqual([]);
    }
  });

  test("a missing column is a skip with a reason, not a crash", () => {
    const bare: BoardColumns = { ...SCHEMA, columns: [] };
    const plan = planMailWriteBack(doc(), FORM, bare);
    expect(plan.steps).toEqual([]);
    expect(plan.skipped.map((s) => s.kind)).toEqual(["receipt_no", "receipt_status", "attach"]);
  });
});

describe("mirror helpers", () => {
  function db() {
    const d = new Database(":memory:");
    initializeSchema(d);
    d.prepare("INSERT INTO seed_batches (batch_name, seed_value, status) VALUES ('t', 1, 'complete')").run();
    d.prepare(
      `INSERT INTO board_items (batch_id, local_id, monday_item_id, board_key, name, profile_local_id, column_values)
       VALUES (1, 'f1', '999', '_cd_open_forms', 'Juan', 'p1', ?)`,
    ).run(JSON.stringify({ receipt_no: "ioe-0912345678", receipt_status: { label: "Waiting on it" } }));
    return d;
  }

  test("readOpenFormState normalizes the receipt and reads the status label", () => {
    expect(readOpenFormState(db(), "f1")).toEqual({
      localId: "f1",
      mondayItemId: "999",
      receiptNo: "IOE0912345678",
      receiptStatus: "Waiting on it",
    });
  });

  test("applyLocalColumn writes the same shapes the sync does", () => {
    const d = db();
    applyLocalColumn(d, "f1", "receipt_no", "MSC2290000001");
    applyLocalColumn(d, "f1", "receipt_status", "Received");
    expect(readOpenFormState(d, "f1")).toMatchObject({ receiptNo: "MSC2290000001", receiptStatus: "Received" });
  });

  test("overallState", () => {
    const s = (result: "done" | "queued" | "failed" | "skipped") => ({ kind: "attach" as const, columnTitle: "x", value: "y", result });
    expect(overallState([s("done"), s("done")])).toBe("done");
    expect(overallState([s("done"), s("failed")])).toBe("partial");
    expect(overallState([s("failed")])).toBe("failed");
    expect(overallState([s("done"), s("queued")])).toBe("queued");
    expect(overallState([s("skipped")])).toBe("skipped");
  });
});
