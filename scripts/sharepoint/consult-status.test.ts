import { describe, it, expect } from "vitest";
import { consultOutcome, consultHasTakenPlace } from "./consult-status.js";

describe("consultOutcome", () => {
  it("treats a No Hire as a consultation that HAPPENED", () => {
    // The point of the whole module: not hiring is an outcome, not an absence.
    expect(consultOutcome("No Hire")).toBe("proceeded");
    expect(consultOutcome("Det No Hire")).toBe("proceeded");
    expect(consultOutcome("No Hire For Now")).toBe("proceeded");
  });

  it("recognises the other ways a consult concluded", () => {
    for (const s of ["Past Consult", "Hire", "Det Hire", "Refund", "Hold for Docs", "Follow up"]) {
      expect(consultOutcome(s)).toBe("proceeded");
    }
  });

  it("counts today's consults as proceeding — the folder is wanted now", () => {
    expect(consultOutcome("Today's consult (1st time)")).toBe("proceeded");
    expect(consultOutcome("Today's consult (detainee)")).toBe("proceeded");
  });

  it("holds off on appointments still ahead", () => {
    expect(consultOutcome("Upcoming")).toBe("not-yet");
    expect(consultOutcome("Scheduled")).toBe("not-yet");
    expect(consultOutcome("To be rescheduled")).toBe("not-yet");
  });

  it("creates nothing for a cancellation or no-show", () => {
    expect(consultOutcome("Cancelled/No Show")).toBe("did-not-happen");
    expect(consultOutcome("Cancelled/No show")).toBe("did-not-happen");
    expect(consultOutcome("TPs - CANCELED")).toBe("did-not-happen");
  });

  it("is case- and space-insensitive, matching the board's own inconsistency", () => {
    expect(consultOutcome("  no hire  ")).toBe("proceeded");
    expect(consultOutcome("Follow Up")).toBe("proceeded");
  });

  it("refuses to assume for an unknown or empty status", () => {
    // A label somebody adds to the board later must not silently create folders.
    expect(consultOutcome("Some New Label")).toBe("unknown");
    expect(consultOutcome("")).toBe("unknown");
    expect(consultOutcome(null)).toBe("unknown");
  });
});

describe("consultHasTakenPlace", () => {
  const morning = new Date("2026-10-13T12:32:00Z");

  it("waits for a today's consult's scheduled time (Patrick FERREIRA TOSCANO, 2026-10-13)", () => {
    // The 12:32 UTC sweep wrote the summary for a 14:00 UTC consult.
    expect(consultHasTakenPlace("Today's consult (1st time)", "2026-10-13", "14:00", morning)).toBe(false);
    expect(consultHasTakenPlace("Today's consult (1st time)", "2026-10-13", "14:00",
      new Date("2026-10-13T14:00:00Z"))).toBe(true);
  });

  it("with no time, waits for the day after", () => {
    expect(consultHasTakenPlace("Today's consult (detainee)", "2026-10-13", null, morning)).toBe(false);
    expect(consultHasTakenPlace("Today's consult (detainee)", "2026-10-13", null,
      new Date("2026-10-14T00:00:00Z"))).toBe(true);
    expect(consultHasTakenPlace("Today's consult (detainee)", null, null, morning)).toBe(false);
  });

  it("trusts a concluded status regardless of the clock", () => {
    expect(consultHasTakenPlace("No Hire", "2026-10-13", "23:00", morning)).toBe(true);
    expect(consultHasTakenPlace("Past Consult", null, null, morning)).toBe(true);
  });

  it("never for an appointment ahead, cancelled or unknown", () => {
    expect(consultHasTakenPlace("Upcoming", "2026-10-01", "10:00", morning)).toBe(false);
    expect(consultHasTakenPlace("Cancelled/No Show", "2026-10-01", "10:00", morning)).toBe(false);
    expect(consultHasTakenPlace("Something new", "2026-10-01", "10:00", morning)).toBe(false);
  });
});
