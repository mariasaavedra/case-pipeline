// =============================================================================
// Motion status write tests
// =============================================================================
// What matters: only real Status labels are written, the right date goes with
// the status (Filed → MTN Filed on, Granted/Denied → Dec. Date), dates are
// sane, and a motion that changed since the page loaded is refused.
// =============================================================================

import { describe, it, expect } from "vitest";
import type { BoardColumns } from "@case-pipeline/query";
import { planMotionStatusWrite, type MotionRow } from "./motion-write";

const TODAY = "2026-10-03";

const SCHEMA: BoardColumns = {
  boardKey: "motions",
  mondayBoardId: "8025556892",
  columns: [
    {
      columnId: "project_status", title: "Status", type: "status", position: 0,
      options: [
        { index: 0, label: "Filed", color: "#579bfc" },
        { index: 1, label: "Granted", color: "#00c875" },
        { index: 2, label: "Denied", color: "#df2f4a" },
        { index: 3, label: "Granted - NO JUDGE ORDER", color: "#00c875" },
        { index: 4, label: "Withdrawn", color: "#c4c4c4" },
      ],
    },
    { columnId: "date_mkqg8972", title: "MTN Filed on:", type: "date", options: [], position: 1 },
    { columnId: "date_mkqyjq82", title: "Dec. Date", type: "date", options: [], position: 2 },
  ],
} as BoardColumns;

const row = (status: string | null, over: Partial<MotionRow> = {}): MotionRow => ({
  monday_item_id: "item-1",
  board_key: "motions",
  status,
  ...over,
});

const plan = (body: Record<string, unknown>, item: MotionRow | undefined = row("Filed"), schema: BoardColumns | null = SCHEMA) =>
  planMotionStatusWrite(body, item, schema, TODAY);

describe("planMotionStatusWrite", () => {
  it("Granted writes the status and Dec. Date", () => {
    const r = plan({ status: "Granted", from: "Filed", date: "2026-10-01" });
    expect(r).toEqual({
      plan: {
        mondayItemId: "item-1", mondayBoardId: "8025556892", statusColumnId: "project_status",
        from: "Filed", to: "Granted",
        date: { field: "decided_on", key: "dec_date", columnId: "date_mkqyjq82", value: "2026-10-01" },
      },
    });
  });

  it("Filed writes MTN Filed on, today by default", () => {
    const r = plan({ status: "Filed", from: null }, row(null));
    expect("plan" in r && r.plan.date).toEqual({ field: "filed_on", key: "mtn_filed_on", columnId: "date_mkqg8972", value: TODAY });
  });

  it("'Granted - NO JUDGE ORDER' is a decision too; Withdrawn carries no date", () => {
    const g = plan({ status: "Granted - NO JUDGE ORDER", from: "Filed" });
    expect("plan" in g && g.plan.date?.field).toBe("decided_on");
    const w = plan({ status: "Withdrawn", from: "Filed" });
    expect("plan" in w && w.plan.date).toBeNull();
  });

  it("same status with a new date only fixes the date; same status, no date → refused", () => {
    const fix = plan({ status: "Granted", from: "Granted", date: "2026-09-30" }, row("Granted"));
    expect("plan" in fix && fix.plan.date?.value).toBe("2026-09-30");
    const same = plan({ status: "Withdrawn", from: "Withdrawn" }, row("Withdrawn"));
    expect("rejection" in same && same.rejection.status).toBe(409);
  });

  it("refuses labels the board doesn't have", () => {
    const r = plan({ status: "Approved", from: "Filed" });
    expect("rejection" in r && r.rejection).toMatchObject({ status: 400, allowed: ["Filed", "Granted", "Denied", "Granted - NO JUDGE ORDER", "Withdrawn"] });
  });

  it("refuses when the motion changed since the page loaded", () => {
    const r = plan({ status: "Denied", from: "Filed" }, row("Granted"));
    expect("rejection" in r && r.rejection).toMatchObject({ status: 409, current: "Granted" });
  });

  it("refuses bad and future dates", () => {
    expect("rejection" in plan({ status: "Granted", from: "Filed", date: "10/01/2026" })).toBe(true);
    const future = plan({ status: "Granted", from: "Filed", date: "2026-10-04" });
    expect("rejection" in future && future.rejection.error).toBe("Date can't be in the future");
  });

  it("not a motion, not synced, or no schema", () => {
    expect(planMotionStatusWrite({ status: "Granted" }, undefined, SCHEMA, TODAY)).toMatchObject({ rejection: { status: 404 } });
    expect(plan({ status: "Granted" }, row("Filed", { board_key: "court_cases" }))).toMatchObject({ rejection: { status: 404 } });
    expect(plan({ status: "Granted" }, row("Filed", { monday_item_id: null }))).toMatchObject({ rejection: { status: 400 } });
    expect(plan({ status: "Granted" }, row("Filed"), null)).toMatchObject({ rejection: { status: 409 } });
  });

  it("the status still goes when the board has no date column", () => {
    const noDates = { ...SCHEMA, columns: SCHEMA.columns.filter((c) => c.type !== "date") } as BoardColumns;
    const r = plan({ status: "Granted", from: "Filed" }, row("Filed"), noDates);
    expect("plan" in r && r.plan).toMatchObject({ to: "Granted", date: null });
  });
});
