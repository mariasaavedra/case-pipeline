// =============================================================================
// Status write-back validation tests
// =============================================================================
// PATCH /api/board-items/:localId/status changes a status on a real client
// record. What matters is that it refuses for the RIGHT reason, in the right
// order, and never lets a label Monday does not define reach the mutation.
// =============================================================================

import { describe, it, expect } from "vitest";
import type { BoardStatusOptions } from "@case-pipeline/query";
import { planStatusWrite, type BoardItemStatusRow } from "./status-write";

const opt = (index: number, label: string) => ({ index, label, color: null, border: null });

const item = (over: Partial<BoardItemStatusRow> = {}): BoardItemStatusRow => ({
  monday_item_id: "555",
  board_key: "court_cases",
  status: "Filed",
  ...over,
});

const def: BoardStatusOptions = {
  boardKey: "court_cases",
  mondayBoardId: "board-7",
  statusColumnId: "status_col",
  options: [opt(0, "Filed"), opt(1, "Approved"), opt(2, "Denied")],
};

describe("planStatusWrite", () => {
  it("plans the write when everything checks out", () => {
    const result = planStatusWrite("Approved", item(), def);
    expect(result).toEqual({
      plan: {
        status: "Approved",
        previous: "Filed",
        boardKey: "court_cases",
        mondayItemId: "555",
        mondayBoardId: "board-7",
        statusColumnId: "status_col",
      },
    });
  });

  it("trims the requested label before matching", () => {
    expect(planStatusWrite("  Approved  ", item(), def)).toHaveProperty("plan.status", "Approved");
  });

  // --- Refusals, in the order they are checked -------------------------------

  it("requires a status", () => {
    expect(planStatusWrite("", item(), def)).toEqual({
      rejection: { status: 400, error: "status is required" },
    });
  });

  it("treats a whitespace-only status as missing", () => {
    expect(planStatusWrite("   ", item(), def)).toHaveProperty("rejection.error", "status is required");
  });

  it("treats a null or undefined status as missing rather than throwing", () => {
    for (const raw of [null, undefined]) {
      expect(planStatusWrite(raw, item(), def)).toHaveProperty("rejection.status", 400);
    }
  });

  it("404s when no such board item exists", () => {
    expect(planStatusWrite("Approved", null, def)).toEqual({
      rejection: { status: 404, error: "Board item not found" },
    });
  });

  // A row created locally while Monday was down has no item to write to yet;
  // the queued create has to land first.
  it("refuses an item that has no Monday id yet", () => {
    const result = planStatusWrite("Approved", item({ monday_item_id: null }), def);
    expect(result).toHaveProperty("rejection.status", 400);
    expect(result).toHaveProperty(
      "rejection.error",
      "Board item has no Monday.com item ID — cannot change status",
    );
  });

  it("409s when the board's status options were never synced", () => {
    expect(planStatusWrite("Approved", item(), null)).toEqual({
      rejection: { status: 409, error: "No status options synced for this board yet — run a sync first" },
    });
  });

  it("refuses a label the board does not define, listing the legal ones", () => {
    expect(planStatusWrite("Escalated", item(), def)).toEqual({
      rejection: {
        status: 400,
        error: "Status is not a valid option for this board",
        allowed: ["Filed", "Approved", "Denied"],
      },
    });
  });

  // Monday's labels are case-sensitive; "approved" is a different label from
  // "Approved" and create_labels_if_missing is off, so it must be refused.
  it("is case-sensitive about labels", () => {
    expect(planStatusWrite("approved", item(), def)).toHaveProperty("rejection.status", 400);
  });

  // --- Ordering --------------------------------------------------------------
  // Each of these has two things wrong at once; the more specific reason wins.

  it("reports a missing status before a missing item", () => {
    expect(planStatusWrite("", null, def)).toHaveProperty("rejection.error", "status is required");
  });

  it("reports a missing item before an unsynced board", () => {
    expect(planStatusWrite("Approved", null, null)).toHaveProperty("rejection.status", 404);
  });

  it("reports a missing Monday id before an unsynced board", () => {
    const result = planStatusWrite("Approved", item({ monday_item_id: null }), null);
    expect(result).toHaveProperty("rejection.status", 400);
  });

  // --- Edge cases ------------------------------------------------------------

  it("allows re-writing the status an item already has", () => {
    expect(planStatusWrite("Filed", item({ status: "Filed" }), def)).toHaveProperty("plan.status", "Filed");
  });

  it("carries a null previous status through for the audit entry", () => {
    expect(planStatusWrite("Approved", item({ status: null }), def)).toHaveProperty("plan.previous", null);
  });

  it("refuses every label when the board synced with an empty option list", () => {
    expect(planStatusWrite("Approved", item(), { ...def, options: [] })).toEqual({
      rejection: { status: 400, error: "Status is not a valid option for this board", allowed: [] },
    });
  });
});
