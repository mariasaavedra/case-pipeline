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
  description: "long_text",
  country_of_birth: "country_of_birth__1",
  date_of_birth: "date_of_birth_mkn33y83",
  have_you_even_been_removed: "status_1_mkkgm2z6",
  what_date_did_you_get_picked_up_by_ice: "date_mkkg7br7",
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
  description: "Picked up at a traffic stop; family wants a bond hearing.",
  countryOfBirth: "Mexico",
  dateOfBirth: "03/07/1980",
  priorRemoval: "Yes",
  pickedUpByIce: "2026-02-21",
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

  it("puts the description in the board's own Description column", () => {
    const out = plan(full);
    if (!("plan" in out)) throw new Error("expected a plan");
    expect(out.plan.columnValues["long_text"]).toBe("Picked up at a traffic stop; family wants a bond hearing.");
  });

  it("writes country and date of birth as TEXT, matching what the board holds", () => {
    // Date of Birth is a text column and staff have typed both "03/07/1980" and
    // "05-27-95" into it. Sending a date object, or forcing ISO, would make the
    // new rows the odd ones out.
    const out = plan(full);
    if (!("plan" in out)) throw new Error("expected a plan");
    expect(out.plan.columnValues["country_of_birth__1"]).toBe("Mexico");
    expect(out.plan.columnValues["date_of_birth_mkn33y83"]).toBe("03/07/1980");
  });

  it("shapes prior removal as a status label", () => {
    const out = plan(full);
    if (!("plan" in out)) throw new Error("expected a plan");
    expect(out.plan.columnValues["status_1_mkkgm2z6"]).toEqual({ label: "Yes" });
  });

  it("omits prior removal when unanswered, rather than guessing No", () => {
    const out = plan({ ...full, priorRemoval: "" });
    if (!("plan" in out)) throw new Error("expected a plan");
    expect(out.plan.columnValues).not.toHaveProperty("status_1_mkkgm2z6");
  });

  it("writes the ICE pickup date as a DATE, not the text DOB is", () => {
    // date_mkkg7br7 is a real date column holding ISO values on 799 rows, so it
    // takes {date} — unlike Date of Birth beside it, which is free text.
    const out = plan(full);
    if (!("plan" in out)) throw new Error("expected a plan");
    expect(out.plan.columnValues["date_mkkg7br7"]).toEqual({ date: "2026-02-21" });
  });

  it("refuses an ICE pickup date that is not ISO", () => {
    expect(plan({ ...full, pickedUpByIce: "21/02/2026" })).toEqual({
      rejection: { status: 400, error: "pickedUpByIce must be YYYY-MM-DD" },
    });
  });

  it("omits the ICE pickup date when it was not asked", () => {
    const out = plan({ ...full, pickedUpByIce: "" });
    if (!("plan" in out)) throw new Error("expected a plan");
    expect(out.plan.columnValues).not.toHaveProperty("date_mkkg7br7");
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

  it("writes First Name and Last Name to their own columns, not just the item name", () => {
    // Both were unmapped in boards.yaml when this route first shipped, so the
    // intake got a correct item name and two blank columns beside it. Caught by
    // reading the live config after deploying, not by a test.
    const out = plan(full);
    if (!("plan" in out)) throw new Error("expected a plan");
    expect(out.plan.columnValues["text_mm3t37m8"]).toBe("Juan");
    expect(out.plan.columnValues["text_mm3tqjzb"]).toBe("PEREZ");
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
