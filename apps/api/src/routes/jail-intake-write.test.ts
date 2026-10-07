// =============================================================================
// Jail intake creation tests
// =============================================================================
// The column mapping is the risk here, not the validation. This board has three
// near-identical POC-name columns, and the query layer reads exactly one of
// them — write to the wrong one and the intake comes back with a blank contact
// on the board we just shipped. These pin the ids the plan targets.
// =============================================================================

import { describe, it, expect } from "vitest";
import {
  planJailIntakeWrite,
  appendToDescription,
  LONG_TEXT_LIMIT,
  planIntakeConsult,
  BOOKABLE_INTAKE_STATUS,
  type IntakeColumnIds,
} from "./jail-intake-write";

// The real ids from config/boards.yaml. `poc_name_and_relationship_with_detained`
// is text_mkkgcg74 — NOT text_mm22stss, the "…: 1" column beside it.
const columnIds: IntakeColumnIds = {
  status: "status",
  jail: "text_mkkg24xy",
  alien_number: "dup__of_first_name2__1",
  language: "status_1__1",
  poc_name_and_relationship_with_detained: "text_mkkgcg74",
  poc_phone: "text2",
  poc_email: "text",
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

describe("planJailIntakeWrite — POC e-mail and starting status", () => {
  const values = (input: Record<string, unknown>) => {
    const out = plan({ firstName: "Juan", ...input });
    if (!("plan" in out)) throw new Error(out.rejection.error);
    return out.plan.columnValues;
  };

  it("writes the POC e-mail to the board's POC Email column, and nothing when blank", () => {
    expect(values({ pocEmail: " maria@example.com " }).text).toBe("maria@example.com");
    expect("text" in values({ pocEmail: "  " })).toBe(false);
  });

  it("refuses something that is not an e-mail", () => {
    expect(plan({ firstName: "Juan", pocEmail: "316-869-3861" })).toEqual({
      rejection: { status: 400, error: "The POC e-mail doesn't look like an e-mail address" },
    });
  });

  it("starts as New Detainee, or Payment link sent when chosen", () => {
    expect(values({}).status).toEqual({ label: "New Detainee" });
    expect(values({ status: "Payment link sent. Waiting on payment" }).status)
      .toEqual({ label: "Payment link sent. Waiting on payment" });
  });

  it("refuses any other starting status", () => {
    const out = plan({ firstName: "Juan", status: "Scheduled" });
    expect("rejection" in out && out.rejection.status).toBe(400);
  });
});

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
      status_1__1: { label: "Espanol" },
    });
  });

  it("translates the Call Log's language labels to this board's", () => {
    // Monday rejects a label the column lacks: the Call Log says "Spanish" and
    // "Portugese", Jail Intakes has "Espanol" and "Portuguese".
    const label = (language: string) => {
      const out = plan({ ...full, language });
      if (!("plan" in out)) throw new Error("expected a plan");
      return out.plan.columnValues["status_1__1"];
    };
    expect(label("Spanish")).toEqual({ label: "Espanol" });
    expect(label("Portugese")).toEqual({ label: "Portuguese" });
    expect(label("English")).toEqual({ label: "English" });
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

// =============================================================================
// Appending a note to the board's Description
// =============================================================================
// Setting a long-text column REPLACES it, and monday caps the column at 2,000
// characters — a longer value is rejected outright. So an append-forever field
// has to be checked, and a client note is not something to silently halve.

describe("appendToDescription", () => {
  const opts = { author: "Rafael", today: "2026-09-28" };

  it("dates and attributes the entry", () => {
    const { next } = appendToDescription(null, "Family called about a bond hearing.", opts);
    expect(next).toBe("2026-09-28 — Rafael: Family called about a bond hearing.");
  });

  it("keeps what was already there and separates the new entry", () => {
    const { next } = appendToDescription("Picked up at a traffic stop.", "Bond hearing requested.", opts);
    expect(next).toBe("Picked up at a traffic stop.\n\n2026-09-28 — Rafael: Bond hearing requested.");
  });

  it("does not leave a leading blank line when the column was empty", () => {
    expect(appendToDescription("   ", "First note.", opts).next).toBe("2026-09-28 — Rafael: First note.");
  });

  it("trims the note rather than writing its whitespace", () => {
    expect(appendToDescription(null, "  Spaced out.  ", opts).next).toBe("2026-09-28 — Rafael: Spaced out.");
  });

  it("refuses rather than truncating when the column is full", () => {
    // The note has already been posted as an update and an activity by this
    // point, so refusing here loses nothing — truncating would lose half a
    // client note with no sign of it.
    const nearlyFull = "x".repeat(LONG_TEXT_LIMIT - 10);
    const res = appendToDescription(nearlyFull, "This will not fit at all.", opts);
    expect(res.full).toBe(true);
    expect(res.next).toBeNull();
  });

  it("accepts a note that exactly reaches the limit", () => {
    const entry = "2026-09-28 — Rafael: ";
    const note = "y".repeat(LONG_TEXT_LIMIT - entry.length);
    const res = appendToDescription(null, note, opts);
    expect(res.full).toBe(false);
    expect(res.next).toHaveLength(LONG_TEXT_LIMIT);
  });

  it("rejects one character over the limit", () => {
    const entry = "2026-09-28 — Rafael: ";
    const note = "y".repeat(LONG_TEXT_LIMIT - entry.length + 1);
    expect(appendToDescription(null, note, opts).full).toBe(true);
  });

  it("counts the existing text and the separator toward the limit", () => {
    const existing = "z".repeat(LONG_TEXT_LIMIT - 30);
    expect(appendToDescription(existing, "a short note", opts).full).toBe(true);
  });
});

// =============================================================================
// Book consult (M9) — Consult Date + Appt with, before Monday's Create Appt
// =============================================================================

describe("planIntakeConsult", () => {
  const opts = {
    status: BOOKABLE_INTAKE_STATUS as string | null,
    columnIds: { consult_date: "date3__1", appt_with: "status_1_mkkghdn7" } as IntakeColumnIds,
    // The column's real labels: attorney badges mixed with workflow labels.
    apptWithLabels: ["PRIOR ORDER needs appt asap", "M", "LB", "WH", "R", "Appt requested. Waiting on date"],
    attorneyBadges: ["R", "M", "LB"],
    today: "2026-09-30",
  };

  it("writes the date (with time) first, then the attorney's badge, to the pinned ids", () => {
    const out = planIntakeConsult({ date: "2026-10-02", time: "14:30", apptWith: "LB" }, opts);
    expect("plan" in out && out.plan.writes).toEqual([
      { key: "consult_date", columnId: "date3__1", value: { date: "2026-10-02", time: "19:30:00" } }, // 2:30 PM CDT in UTC
      { key: "appt_with", columnId: "status_1_mkkghdn7", value: { label: "LB" } },
    ]);
  });

  it("leaves the time off when none is given", () => {
    const out = planIntakeConsult({ date: "2026-10-02", apptWith: "M" }, opts);
    expect("plan" in out && out.plan.writes[0]!.value).toEqual({ date: "2026-10-02" });
  });

  it("refuses an intake that is not waiting to be scheduled", () => {
    const out = planIntakeConsult({ date: "2026-10-02", apptWith: "M" }, { ...opts, status: "Payment link sent. Waiting on payment" });
    expect("rejection" in out && out.rejection.status).toBe(409);
  });

  it("refuses a workflow label, and an attorney not taking consults", () => {
    for (const apptWith of ["Appt requested. Waiting on date", "WH", ""]) {
      const out = planIntakeConsult({ date: "2026-10-02", apptWith }, opts);
      expect("rejection" in out && out.rejection).toMatchObject({ status: 400, allowed: ["M", "LB", "R"] });
    }
  });

  it("refuses a past, malformed or impossible date, and a bad time", () => {
    for (const input of [
      { date: "2026-09-29", apptWith: "M" },
      { date: "10/02/2026", apptWith: "M" },
      { date: "2026-02-30", apptWith: "M" },
      { date: "2026-10-02", time: "3pm", apptWith: "M" },
    ]) {
      const out = planIntakeConsult(input, opts);
      expect("rejection" in out && out.rejection.status).toBe(400);
    }
  });

  it("accepts today", () => {
    expect("plan" in planIntakeConsult({ date: "2026-09-30", apptWith: "R" }, opts)).toBe(true);
  });
});
