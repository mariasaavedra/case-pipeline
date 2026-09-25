// =============================================================================
// Jail intake creation tests
// =============================================================================
// The column mapping is the risk here, not the validation. This board has three
// near-identical POC-name columns, and the query layer reads exactly one of
// them — write to the wrong one and the intake comes back with a blank contact
// on the board we just shipped. These pin the ids the plan targets.
// =============================================================================

import { describe, it, expect } from "vitest";
import { planJailIntakeWrite, type IntakeColumnIds } from "./jail-intake-write";

// The real ids from config/boards.yaml. `poc_name_and_relationship_with_detained`
// is text_mkkgcg74 — NOT text_mm22stss, the "…: 1" column beside it.
const columnIds: IntakeColumnIds = {
  status: "status",
  jail: "text_mkkg24xy",
  alien_number: "dup__of_first_name2__1",
  language: "status_1__1",
  poc_name_and_relationship_with_detained: "text_mkkgcg74",
  poc_phone: "text2",
  intake_created_on: "date_1__1",
  first_name: "text_mm3t37m8",
  last_name: "text_mm3tqjzb",
  link_to_call_log: "board_relation_mm0xdg80",
};

const TODAY = "2026-09-25";
const plan = (input: Record<string, unknown>, ids: IntakeColumnIds = columnIds) =>
  planJailIntakeWrite(input, { columnIds: ids, today: TODAY });

const full = {
  firstName: "Juan",
  lastName: "PEREZ",
  jail: "Kay County",
  alienNumber: "088-467-122",
  language: "Spanish",
  pocName: "Maria, sister",
  pocPhone: "316-869-3861",
};

describe("planJailIntakeWrite", () => {
  it("names the item after the detainee, the way the board does", () => {
    const out = plan(full);
    if (!("plan" in out)) throw new Error("expected a plan");
    expect(out.plan.itemName).toBe("Juan PEREZ");
  });

  it("writes the POC name to the column the list actually reads", () => {
    const out = plan(full);
    if (!("plan" in out)) throw new Error("expected a plan");
    expect(out.plan.columnValues["text_mkkgcg74"]).toBe("Maria, sister");
    // The decoy column must stay untouched.
    expect(out.plan.columnValues).not.toHaveProperty("text_mm22stss");
  });

  it("maps every captured field to its configured column", () => {
    const out = plan(full);
    if (!("plan" in out)) throw new Error("expected a plan");
    expect(out.plan.columnValues).toMatchObject({
      text_mm3t37m8: "Juan",
      text_mm3tqjzb: "PEREZ",
      text_mkkg24xy: "Kay County",
      dup__of_first_name2__1: "088-467-122",
      text2: "316-869-3861",
      status_1__1: { label: "Spanish" },
    });
  });

  it("starts every lead at New Detainee", () => {
    const out = plan(full);
    if (!("plan" in out)) throw new Error("expected a plan");
    expect(out.plan.columnValues["status"]).toEqual({ label: "New Detainee" });
  });

  it("stamps Intake Created with the firm's today, which the list filters on", () => {
    const out = plan(full);
    if (!("plan" in out)) throw new Error("expected a plan");
    expect(out.plan.columnValues["date_1__1"]).toEqual({ date: TODAY });
  });

  it("links the call it came from", () => {
    const out = plan({ ...full, callLogItemId: "123456" });
    if (!("plan" in out)) throw new Error("expected a plan");
    expect(out.plan.columnValues["board_relation_mm0xdg80"]).toEqual({ item_ids: [123456] });
    expect(out.plan.linkedCallItemId).toBe("123456");
  });

  it("does not link a call when the intake was started from the board", () => {
    const out = plan(full);
    if (!("plan" in out)) throw new Error("expected a plan");
    expect(out.plan.columnValues).not.toHaveProperty("board_relation_mm0xdg80");
    expect(out.plan.linkedCallItemId).toBeNull();
  });

  it("leaves a field the caller did not know unwritten, rather than blank", () => {
    // Half a story taken during a live call is still worth having; the board is
    // where the rest gets filled in.
    const out = plan({ firstName: "Juan", lastName: "PEREZ" });
    if (!("plan" in out)) throw new Error("expected a plan");
    expect(out.plan.columnValues).not.toHaveProperty("text_mkkg24xy");
    expect(out.plan.columnValues).not.toHaveProperty("text2");
    expect(out.plan.columnValues).not.toHaveProperty("status_1__1");
    // The ones it sets regardless are still there.
    expect(out.plan.columnValues["status"]).toEqual({ label: "New Detainee" });
  });

  it("trims whitespace rather than writing it", () => {
    const out = plan({ firstName: "  Juan  ", lastName: " PEREZ ", jail: "   " });
    if (!("plan" in out)) throw new Error("expected a plan");
    expect(out.plan.itemName).toBe("Juan PEREZ");
    expect(out.plan.columnValues).not.toHaveProperty("text_mkkg24xy");
  });

  it("skips a column the config does not map, instead of throwing", () => {
    const out = plan(full, { status: "status", first_name: "text_mm3t37m8" });
    if (!("plan" in out)) throw new Error("expected a plan");
    expect(Object.keys(out.plan.columnValues).sort()).toEqual(["status", "text_mm3t37m8"]);
  });

  it("accepts a first name alone", () => {
    const out = plan({ firstName: "Juan" });
    if (!("plan" in out)) throw new Error("expected a plan");
    expect(out.plan.itemName).toBe("Juan");
  });

  // --- Refusals --------------------------------------------------------------

  it("requires a name", () => {
    expect(plan({ jail: "Kay County" })).toEqual({
      rejection: { status: 400, error: "The detainee's name is required" },
    });
  });

  it("treats a whitespace-only name as missing", () => {
    expect(plan({ firstName: "   ", lastName: "  " })).toHaveProperty("rejection.status", 400);
  });
});
