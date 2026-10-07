import { describe, it, expect } from "vitest";
import type { MyDayEntry } from "../api";
import {
  hasOutcome, formatTime, hasStarted, rowStates, nowLineIndex, defaultSelection, outcomeLabels, fileKind, addDays, prepStamp, detaineeReason, layoutFor, firstName,
} from "./my-day";

const entry = (id: string, time: string | null, status: string | null = null, date = "2026-10-07") =>
  ({ localId: id, time, status, date }) as MyDayEntry;

describe("P4 My Day rules", () => {
  it("knows which statuses record an outcome", () => {
    expect(hasOutcome("Hire")).toBe(true);
    expect(hasOutcome("Cancelled/No show")).toBe(true); // R's board spells it this way
    expect(hasOutcome("No Hire For Now")).toBe(true);
    expect(hasOutcome("Today's consult (1st time)")).toBe(false);
    expect(hasOutcome("Needs update by Atty")).toBe(false);
    expect(hasOutcome(null)).toBe(false);
  });

  it("formats times for the time column", () => {
    expect(formatTime("09:00")).toEqual({ clock: "9:00", ampm: "AM", full: "9:00 AM" });
    expect(formatTime("12:30")).toEqual({ clock: "12:30", ampm: "PM", full: "12:30 PM" });
    expect(formatTime("00:15").full).toBe("12:15 AM");
    expect(formatTime(null).full).toBe("No time");
  });

  it("tags rows: done, started without an outcome, the next one, later", () => {
    const day = [entry("a", "09:00", "Hire"), entry("b", "10:00"), entry("c", "11:30"), entry("d", "13:00")];
    expect(rowStates(day, "2026-10-07", "11:05")).toEqual(["done", "needs-outcome", "next", "later"]);
    expect(nowLineIndex(day, "2026-10-07", "11:05")).toBe(2);
    expect(defaultSelection(day, rowStates(day, "2026-10-07", "11:05"))).toBe("c");
  });

  it("treats a past day as started and a future day as not", () => {
    expect(hasStarted(entry("x", "16:00", null, "2026-10-06"), "2026-10-07", "08:00")).toBe(true);
    const future = [entry("x", "09:00", null, "2026-10-08")];
    expect(rowStates(future, "2026-10-07", "23:00")).toEqual(["later"]);
    expect(nowLineIndex(future, "2026-10-07", "23:00")).toBe(-1);
  });

  it("puts the now line after the last row once everything has started", () => {
    const day = [entry("a", "09:00"), entry("b", "10:00")];
    expect(nowLineIndex(day, "2026-10-07", "17:00")).toBe(2);
    expect(defaultSelection(day, rowStates(day, "2026-10-07", "17:00"))).toBe("a");
  });

  // R's board, as Monday spells it.
  const R = ["Hire", "No Hire", "Det Hire", "Det No Hire", "Hold for Docs", "Cancelled/No show", "Follow Up",
    "No Action Needed", "Send G-Review Link", "No Hire for Now", "Upcoming"];

  it("offers the attorneys' quick outcomes in the board's own spelling, and skips ones it lacks", () => {
    expect(outcomeLabels(R)).toEqual(["Hire", "No Hire", "No Hire for Now", "Hold for Docs", "No Action Needed", "Send G-Review Link"]);
    // LB has no G-review link status.
    expect(outcomeLabels(["Hire", "No Hire", "No Action Needed"])).toEqual(["Hire", "No Hire", "No Action Needed"]);
  });

  it("swaps Hire / No Hire for Det Hire / Det No Hire on a detainee consult only", () => {
    expect(outcomeLabels(R, true)).toEqual(["Det Hire", "Det No Hire", "No Hire for Now", "Hold for Docs", "No Action Needed", "Send G-Review Link"]);
    expect(outcomeLabels(R, false)).not.toContain("Det Hire");
  });

  it("knows a detainee consult from the prep, the status, or the court case", () => {
    const prep = (apptType: string) => ({ apptType }) as MyDayEntry["prep"];
    expect(detaineeReason({ prep: prep("Detained appt — Chase Co. (KS)"), status: null, detainedAt: null })).toBe("Detained at Chase Co. (KS)");
    expect(detaineeReason({ prep: null, status: "Today's consult (detainee)", detainedAt: null })).toBe("Detainee consult");
    expect(detaineeReason({ prep: null, status: null, detainedAt: "Butler Co." })).toBe("Detained at Butler Co.");
    expect(detaineeReason({ prep: prep("1st time"), status: "Upcoming", detainedAt: null })).toBeNull();
  });

  it("badges a picked document by its extension", () => {
    expect(fileKind("Notice to Appear.pdf")).toBe("PDF");
    expect(fileKind("Declaration FINAL.docx ")).toBe("DOCX");
    expect(fileKind("Consult folder")).toBe("FILE");
  });

  it("picks the layout from the page's own width", () => {
    expect(layoutFor(null)).toBe("wide");
    expect(layoutFor(1240)).toBe("wide");
    expect(layoutFor(960)).toBe("medium"); // a tablet, or a laptop with the sidebar open
    expect(layoutFor(380)).toBe("narrow");
  });

  it("gives the tablet's time column a first name, skipping titles", () => {
    expect(firstName("Mr. Corbin Kiehn DDS")).toBe("Corbin");
    expect(firstName("Ana Lucía Ferreira")).toBe("Ana");
    expect(firstName("Walk-in")).toBe("Walk-in");
  });

  it("steps dates and stamps the prep", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-10-01", -1)).toBe("2026-09-30");
    expect(prepStamp("2026-10-06 21:12:00", "Karla")).toMatch(/^Prepped by Karla · Oct 6/);
  });
});
