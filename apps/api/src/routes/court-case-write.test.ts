// =============================================================================
// Court case prep stage write tests
// =============================================================================
// What matters: only real Case Prep Status labels are written, the column id
// comes from the synced schema, and a stage that moved since the page loaded is
// refused rather than overwritten.
// =============================================================================

import { describe, it, expect } from "vitest";
import type { BoardColumns } from "@case-pipeline/query";
import { planPrepStageWrite, type CourtCaseRow } from "./court-case-write";

const SCHEMA: BoardColumns = {
  boardKey: "court_cases",
  mondayBoardId: "board-1",
  columns: [
    { columnId: "text_x", title: "Notes", type: "text", options: [], position: 0 },
    {
      columnId: "color_mkp7t3ds", title: "Case Prep Status", type: "status", position: 1,
      options: [
        { index: 8, label: "1 - Initial Set Up", color: "#cab641" },
        { index: 104, label: "2 - MCH Prep", color: "#7e3b8a" },
        { index: 101, label: "3 - Trial Prep", color: "#df2f4a" },
      ],
    },
  ],
} as BoardColumns;

const row = (stage: string | null, over: Partial<CourtCaseRow> = {}): CourtCaseRow => ({
  monday_item_id: "item-1",
  board_key: "court_cases",
  column_values: JSON.stringify(stage ? { case_prep_status: { label: stage } } : {}),
  ...over,
});

describe("planPrepStageWrite", () => {
  it("plans a move with the schema's column id", () => {
    expect(planPrepStageWrite({ stage: "2 - MCH Prep", from: "1 - Initial Set Up" }, row("1 - Initial Set Up"), SCHEMA)).toEqual({
      plan: { mondayItemId: "item-1", mondayBoardId: "board-1", columnId: "color_mkp7t3ds", from: "1 - Initial Set Up", to: "2 - MCH Prep" },
    });
  });

  it("treats an unset stage as from = null", () => {
    const r = planPrepStageWrite({ stage: "1 - Initial Set Up", from: null }, row(null), SCHEMA);
    expect(r).toMatchObject({ plan: { from: null, to: "1 - Initial Set Up" } });
  });

  it("refuses a label the board doesn't have", () => {
    const r = planPrepStageWrite({ stage: "4 - Done" }, row("1 - Initial Set Up"), SCHEMA);
    expect(r).toMatchObject({ rejection: { status: 400, allowed: ["1 - Initial Set Up", "2 - MCH Prep", "3 - Trial Prep"] } });
    expect(planPrepStageWrite({ stage: "" }, row(null), SCHEMA)).toMatchObject({ rejection: { status: 400 } });
  });

  it("refuses when the stage moved since the page loaded", () => {
    const r = planPrepStageWrite({ stage: "3 - Trial Prep", from: "1 - Initial Set Up" }, row("2 - MCH Prep"), SCHEMA);
    expect(r).toEqual({
      rejection: { status: 409, error: "This case's stage changed since you loaded the page", current: "2 - MCH Prep" },
    });
  });

  it("is a no-op when already there", () => {
    expect(planPrepStageWrite({ stage: "2 - MCH Prep", from: "2 - MCH Prep" }, row("2 - MCH Prep"), SCHEMA)).toEqual({ noop: true, stage: "2 - MCH Prep" });
  });

  it("refuses other boards, unsynced items, and a missing schema", () => {
    expect(planPrepStageWrite({ stage: "2 - MCH Prep" }, undefined, SCHEMA)).toMatchObject({ rejection: { status: 404 } });
    expect(planPrepStageWrite({ stage: "2 - MCH Prep" }, row(null, { board_key: "motions" }), SCHEMA)).toMatchObject({ rejection: { status: 404 } });
    expect(planPrepStageWrite({ stage: "2 - MCH Prep" }, row(null, { monday_item_id: null }), SCHEMA)).toMatchObject({ rejection: { status: 400 } });
    expect(planPrepStageWrite({ stage: "2 - MCH Prep" }, row(null), null)).toMatchObject({ rejection: { status: 409 } });
  });
});
