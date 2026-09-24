// =============================================================================
// Consult booking tests
// =============================================================================
// POST /api/profiles/:localId/appointments creates a real item on a real
// attorney's board. Two things have to hold: the refusals fire for the right
// reason, and the column values are exactly what Monday expects — a date split
// into date/time keys, a people column shaped as personsAndTeams, and the
// profile relation present, because without that last one the consult never
// reaches the 360 view at all.
// =============================================================================

import { describe, it, expect } from "vitest";
import {
  planAppointmentWrite,
  type AppointmentBoardSchema,
  type AppointmentProfile,
} from "./appointment-write";
import { isBookable, bookableBoards, type AttorneyBoard } from "../attorney-boards";

const col = (columnId: string, title: string, type: string, options: string[] = []) => ({
  columnId,
  title,
  type,
  options: options.map((label) => ({ label })),
});

// Mirrors the real appointment boards: every one of them exposes these titles,
// which is what lets a board duplicated for a new attorney work with no config.
const schema: AppointmentBoardSchema = {
  mondayBoardId: "7788520205",
  columns: [
    col("date3__1", "Consult Date", "date"),
    col("long_text", "Description", "long_text"),
    col("status", "Status", "status", ["Upcoming", "Scheduled", "To be rescheduled", "Hire"]),
    col("connect_boards4__1", "Profiles", "board_relation"),
    col("people__1", "Attorney", "people"),
    col("date_1__1", "Consult Created on", "date"),
    col("text2", "Phone", "text"),
    col("text", "Email", "text"),
    col("text0__1", "Address", "text"),
    col("dup__of_first_name2__1", "Alien Number", "text"),
    col("date_of_birth_mkkvs9xh", "Date of Birth", "text"),
    col("country_of_birth__1", "Country of Birth", "text"),
  ],
};

const board: AttorneyBoard = {
  boardKey: "appointments_lb",
  mondayBoardId: "7788520205",
  displayName: "LB",
  attorneyName: "Lucy Betteridge",
  active: true,
};

const profile: AppointmentProfile = {
  monday_item_id: "8747421674",
  name: "Mahtarr JOHN",
  email: "client@example.test",
  phone: "816-555-0100",
  address: "1 Main St",
  date_of_birth: "1990-04-02",
  place_of_birth: "Gambia",
  a_number: "A123-456-789",
};

const plan = (input: Record<string, unknown>, over: Partial<Parameters<typeof planAppointmentWrite>[1]> = {}) =>
  planAppointmentWrite(input, { board, profile, schema, attorneyUserId: 42, today: "2026-09-24", ...over });

describe("planAppointmentWrite", () => {
  it("splits date and time the way Monday's date column expects", () => {
    const out = plan({ date: "2026-10-01", time: "14:30" });
    expect(out).toHaveProperty("plan");
    if (!("plan" in out)) return;
    expect(out.plan.columnValues["date3__1"]).toEqual({ date: "2026-10-01", time: "14:30:00" });
  });

  it("omits time entirely when none was given, rather than sending an empty one", () => {
    const out = plan({ date: "2026-10-01" });
    if (!("plan" in out)) throw new Error("expected a plan");
    expect(out.plan.columnValues["date3__1"]).toEqual({ date: "2026-10-01" });
    expect(out.plan.time).toBeNull();
  });

  it("links the profile — without this the consult never reaches the 360 view", () => {
    const out = plan({ date: "2026-10-01" });
    if (!("plan" in out)) throw new Error("expected a plan");
    expect(out.plan.columnValues["connect_boards4__1"]).toEqual({ item_ids: [8747421674] });
  });

  it("shapes the attorney as a people value", () => {
    const out = plan({ date: "2026-10-01" });
    if (!("plan" in out)) throw new Error("expected a plan");
    expect(out.plan.columnValues["people__1"]).toEqual({ personsAndTeams: [{ id: 42, kind: "person" }] });
  });

  it("leaves the attorney unset rather than refusing when the user could not be resolved", () => {
    // The board already identifies the attorney; a missing people id is cosmetic.
    const out = plan({ date: "2026-10-01" }, { attorneyUserId: null });
    if (!("plan" in out)) throw new Error("expected a plan");
    expect(out.plan.columnValues).not.toHaveProperty("people__1");
  });

  it("carries the client's details across so nobody retypes them", () => {
    const out = plan({ date: "2026-10-01" });
    if (!("plan" in out)) throw new Error("expected a plan");
    expect(out.plan.columnValues["text2"]).toBe("816-555-0100");
    expect(out.plan.columnValues["text"]).toBe("client@example.test");
    expect(out.plan.columnValues["dup__of_first_name2__1"]).toBe("A123-456-789");
    expect(out.plan.columnValues["country_of_birth__1"]).toBe("Gambia");
  });

  it("skips a detail the profile does not have instead of writing an empty string", () => {
    const out = plan({ date: "2026-10-01" }, { profile: { ...profile, phone: null, a_number: null } });
    if (!("plan" in out)) throw new Error("expected a plan");
    expect(out.plan.columnValues).not.toHaveProperty("text2");
    expect(out.plan.columnValues).not.toHaveProperty("dup__of_first_name2__1");
  });

  it("stamps 'Consult Created on' with today, not the consult date", () => {
    const out = plan({ date: "2026-12-25" });
    if (!("plan" in out)) throw new Error("expected a plan");
    expect(out.plan.columnValues["date_1__1"]).toEqual({ date: "2026-09-24" });
  });

  it("defaults the status to Upcoming", () => {
    const out = plan({ date: "2026-10-01" });
    if (!("plan" in out)) throw new Error("expected a plan");
    expect(out.plan.columnValues["status"]).toEqual({ label: "Upcoming" });
  });

  it("names the item after the client", () => {
    const out = plan({ date: "2026-10-01" });
    if (!("plan" in out)) throw new Error("expected a plan");
    expect(out.plan.itemName).toBe("Mahtarr JOHN");
  });

  it("omits the description when it is blank rather than clearing the column", () => {
    const out = plan({ date: "2026-10-01", description: "   " });
    if (!("plan" in out)) throw new Error("expected a plan");
    expect(out.plan.columnValues).not.toHaveProperty("long_text");
  });

  // --- Refusals --------------------------------------------------------------

  it("requires a date", () => {
    expect(plan({})).toEqual({ rejection: { status: 400, error: "date is required as YYYY-MM-DD" } });
  });

  it("rejects a date that is not ISO", () => {
    expect(plan({ date: "10/01/2026" })).toHaveProperty("rejection.error", "date is required as YYYY-MM-DD");
  });

  it("rejects a malformed time", () => {
    expect(plan({ date: "2026-10-01", time: "2pm" })).toHaveProperty("rejection.error", "time must be HH:MM (24-hour)");
  });

  it("rejects a status the board does not define, and says what is allowed", () => {
    const out = plan({ date: "2026-10-01", status: "Definitely Maybe" });
    expect(out).toHaveProperty("rejection.status", 400);
    if (!("rejection" in out)) return;
    expect(out.rejection.allowed).toContain("Upcoming");
  });

  it("refuses when the board has no Consult Date column, rather than booking a dateless consult", () => {
    const stripped = { ...schema, columns: schema.columns.filter((c) => c.title !== "Consult Date") };
    expect(plan({ date: "2026-10-01" }, { schema: stripped })).toHaveProperty("rejection.status", 409);
  });
});

// =============================================================================
// Who is offered for booking
// =============================================================================
// `active` gates whether a board's appointments appear in the daily reads.
// Whether an attorney takes NEW consults is a separate question, and conflating
// them would mean hiding a departed attorney's history to stop new bookings.

describe("isBookable", () => {
  const b = (over: Partial<AttorneyBoard>): AttorneyBoard => ({
    boardKey: "appointments_x",
    mondayBoardId: "1",
    displayName: "X",
    active: true,
    ...over,
  });

  it("falls back to `active` when acceptingConsults is absent — no migration needed", () => {
    expect(isBookable(b({ active: true }))).toBe(true);
    expect(isBookable(b({ active: false }))).toBe(false);
  });

  it("keeps an attorney's history readable while closing them to new consults", () => {
    expect(isBookable(b({ active: true, acceptingConsults: false }))).toBe(false);
  });

  it("can open a board to consults whose data is not in the daily reads", () => {
    expect(isBookable(b({ active: false, acceptingConsults: true }))).toBe(true);
  });

  it("bookableBoards returns an array even with no config file present", () => {
    expect(Array.isArray(bookableBoards())).toBe(true);
  });
});
