import { describe, it, expect } from "vitest";
import { consultOutcome } from "./consult-status.js";

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
