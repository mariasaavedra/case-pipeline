// =============================================================================
// Contract signing step tests
// =============================================================================
// What matters: each step writes its stage and the date that goes with it in
// one write, only from the stages it belongs to, never to a stage Monday no
// longer has, and a contract that moved since the page loaded is refused.
// =============================================================================

import { describe, it, expect } from "vitest";
import type { BoardColumns } from "@case-pipeline/query";
import { planContractStep, type ContractRow } from "./contract-step";

const TODAY = "2026-10-05";

const STAGES = ["Needs to be sent", "Atty Reviewing", "Sent to Client", "Needs Payment Link", "Payment link sent", "HOLD"];
const SCHEMA: BoardColumns = {
  boardKey: "fee_ks",
  mondayBoardId: "4880153390",
  columns: [
    { columnId: "deal_stage", title: "Contract Stage", type: "status", position: 0, options: STAGES.map((label, index) => ({ index, label, color: "#579bfc" })) },
    { columnId: "date1__1", title: "Contract Sent On", type: "date", options: [], position: 1 },
    { columnId: "date8__1", title: "Signed Contract Received On", type: "date", options: [], position: 2 },
    { columnId: "date_mkzjh7f2", title: "Payment Link Sent On", type: "date", options: [], position: 3 },
  ],
} as BoardColumns;

const row = (stage: string | null, over: Partial<ContractRow> = {}): ContractRow => ({ monday_item_id: "item-1", stage, ...over });
const plan = (body: Record<string, unknown>, item: ContractRow | undefined = row("Needs to be sent"), schema: BoardColumns | null = SCHEMA) =>
  planContractStep(body, item, schema, TODAY);

describe("planContractStep", () => {
  it("sent for signature moves to Atty Reviewing, no date", () => {
    const r = plan({ step: "sent_for_signature", from: "Needs to be sent" });
    expect(r).toEqual({
      plan: {
        step: "sent_for_signature", mondayItemId: "item-1", mondayBoardId: "4880153390",
        from: "Needs to be sent", to: "Atty Reviewing",
        values: { deal_stage: { label: "Atty Reviewing" } },
        local: { contract_stage: { label: "Atty Reviewing" } },
      },
    });
  });

  it("sent for signature works with no stage set", () => {
    expect("plan" in plan({ step: "sent_for_signature", from: null }, row(null))).toBe(true);
  });

  it("attorney signed → Sent to Client + Contract Sent On today", () => {
    const r = plan({ step: "attorney_signed", from: "Atty Reviewing" }, row("Atty Reviewing"));
    expect("plan" in r && r.plan.values).toEqual({ deal_stage: { label: "Sent to Client" }, date1__1: { date: TODAY } });
    expect("plan" in r && r.plan.local).toEqual({ contract_stage: { label: "Sent to Client" }, contract_sent_on: { date: TODAY } });
  });

  it("client signed → Needs Payment Link + Signed Contract Received On", () => {
    const r = plan({ step: "client_signed", from: "Sent to Client" }, row("Sent to Client"));
    expect("plan" in r && r.plan.values).toEqual({ deal_stage: { label: "Needs Payment Link" }, date8__1: { date: TODAY } });
  });

  it("payment link sent → Payment link sent + Payment Link Sent On", () => {
    const r = plan({ step: "payment_link_sent", from: "Needs Payment Link" }, row("Needs Payment Link"));
    expect("plan" in r && r.plan.values).toEqual({ deal_stage: { label: "Payment link sent" }, date_mkzjh7f2: { date: TODAY } });
  });

  it("refuses a step from the wrong stage", () => {
    const r = plan({ step: "client_signed", from: "HOLD" }, row("HOLD"));
    expect("rejection" in r && r.rejection.status).toBe(409);
  });

  it("refuses when the stage changed since the page loaded", () => {
    const r = plan({ step: "attorney_signed", from: "Atty Reviewing" }, row("Sent to Client"));
    expect(r).toEqual({ rejection: { status: 409, error: "This contract's stage changed since you loaded the page", current: "Sent to Client" } });
  });

  it("refuses an unknown step", () => {
    const r = plan({ step: "delete_everything" });
    expect("rejection" in r && r.rejection.status).toBe(400);
  });

  it("refuses when Monday no longer has the target stage", () => {
    const schema = { ...SCHEMA, columns: [{ ...SCHEMA.columns[0]!, options: [{ index: 0, label: "Needs to be sent", color: "#000" }] }, ...SCHEMA.columns.slice(1)] };
    const r = plan({ step: "sent_for_signature", from: "Needs to be sent" }, row("Needs to be sent"), schema as BoardColumns);
    expect("rejection" in r && r.rejection.status).toBe(409);
  });

  it("still moves the stage when the date column is missing", () => {
    const schema = { ...SCHEMA, columns: SCHEMA.columns.filter((c) => c.columnId !== "date1__1") };
    const r = plan({ step: "attorney_signed", from: "Atty Reviewing" }, row("Atty Reviewing"), schema as BoardColumns);
    expect("plan" in r && r.plan.values).toEqual({ deal_stage: { label: "Sent to Client" } });
  });

  it("refuses a contract not on Monday yet, or missing", () => {
    expect("rejection" in plan({ step: "sent_for_signature" }, row("Needs to be sent", { monday_item_id: null }))).toBe(true);
    expect("rejection" in planContractStep({ step: "sent_for_signature" }, undefined, SCHEMA, TODAY)).toBe(true);
  });
});
