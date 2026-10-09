// =============================================================================
// Contract fees tests
// =============================================================================
// What matters: only the fees that changed are written, in Monday's number
// format ("" clears), bad amounts are refused, and a fee that changed on
// Monday since the page loaded is refused with the current values.
// =============================================================================

import { describe, it, expect } from "vitest";
import type { BoardColumns } from "@case-pipeline/query";
import { planContractFees, type ContractFeesRow } from "./contract-fees";

const SCHEMA: BoardColumns = {
  boardKey: "fee_ks",
  mondayBoardId: "4880153390",
  columns: [
    { columnId: "deal_value", title: "AF", type: "numbers", options: [], position: 0 },
    { columnId: "numbers__1", title: "FF", type: "numbers", options: [], position: 1 },
    { columnId: "numbers5__1", title: "PF", type: "numbers", options: [], position: 2 },
  ],
};

const row = (over: Partial<ContractFeesRow> = {}): ContractFeesRow => ({ monday_item_id: "item-1", af: "5500", ff: "0", pf: null, ...over });
const plan = (body: Record<string, unknown>, item: ContractFeesRow | undefined = row(), schema: BoardColumns | null = SCHEMA) =>
  planContractFees(body, item, schema);

describe("planContractFees", () => {
  it("writes only the fees that changed", () => {
    const r = plan({ fees: { af: "6,000", ff: 0, pf: "" }, from: { af: 5500, ff: 0, pf: null } });
    expect(r).toEqual({
      plan: {
        mondayItemId: "item-1", mondayBoardId: "4880153390",
        from: { af: 5500 }, to: { af: 6000 },
        values: { deal_value: "6000" }, local: { af: "6000" },
      },
    });
  });

  it("an empty fee clears the Monday number", () => {
    const r = plan({ fees: { af: "" }, from: { af: 5500 } });
    expect("plan" in r && r.plan.values).toEqual({ deal_value: "" });
  });

  it("sets a fee that was empty, rounded to cents", () => {
    const r = plan({ fees: { pf: "$165.004" }, from: { pf: null } });
    expect("plan" in r && r.plan.values).toEqual({ numbers5__1: "165" });
  });

  it("refuses bad amounts", () => {
    for (const af of ["abc", -1, 2_000_000]) {
      expect(plan({ fees: { af } })).toMatchObject({ rejection: { status: 400 } });
    }
  });

  it("refuses when nothing changed", () => {
    expect(plan({ fees: { af: 5500, ff: "0" } })).toMatchObject({ rejection: { status: 400, error: "Nothing changed" } });
  });

  it("refuses a fee that changed on Monday since the page loaded", () => {
    expect(plan({ fees: { af: 7000 }, from: { af: 5000 } })).toEqual({
      rejection: { status: 409, error: "This contract's fees changed since you loaded the page", current: { af: 5500, ff: 0, pf: null } },
    });
  });

  it("refuses unknown, unsynced or missing contracts", () => {
    expect(planContractFees({ fees: { af: 1 } }, undefined, SCHEMA)).toMatchObject({ rejection: { status: 404 } });
    expect(plan({ fees: { af: 1 } }, row({ monday_item_id: null }))).toMatchObject({ rejection: { status: 400 } });
    expect(plan({ fees: { af: 1 } }, row(), null)).toMatchObject({ rejection: { status: 409 } });
    expect(plan({ fees: { af: 1 } }, row(), { ...SCHEMA, columns: [] })).toMatchObject({ rejection: { status: 409 } });
  });
});
