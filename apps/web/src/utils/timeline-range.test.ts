import { describe, test, expect } from "vitest";
import { resolveRange, rangeLabel, toYmd } from "./timeline-range";

// A fixed "now" so the period arithmetic is deterministic. Mid-month and
// mid-year, then specific cases pin the boundary crossings.
const NOW = new Date(2026, 7, 7, 14, 30); // 2026-08-07, local

describe("toYmd", () => {
  test("formats in the local calendar, zero-padded", () => {
    expect(toYmd(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(toYmd(new Date(2026, 11, 31))).toBe("2026-12-31");
  });

  test("does not shift the date across the UTC boundary", () => {
    // toISOString() on a late-evening local time rolls to the next UTC day in
    // western timezones. The chip must show the day the user is living in.
    const lateEvening = new Date(2026, 2, 15, 23, 30);
    expect(toYmd(lateEvening)).toBe("2026-03-15");
  });
});

describe("resolveRange", () => {
  test("all time is no bound at all", () => {
    expect(resolveRange("all", {}, NOW)).toEqual({});
  });

  test("30 days counts back from today", () => {
    expect(resolveRange("30d", {}, NOW)).toEqual({ from: "2026-07-08" });
  });

  test("90 days crosses month boundaries correctly", () => {
    expect(resolveRange("90d", {}, NOW)).toEqual({ from: "2026-05-09" });
  });

  test("12 months crosses the year boundary", () => {
    expect(resolveRange("12m", {}, NOW)).toEqual({ from: "2025-08-07" });
  });

  test("a named period sets no upper bound", () => {
    // Deliberate: an entry dated slightly ahead (a scheduled appointment note)
    // should not be hidden by a "last 30 days" chip.
    expect(resolveRange("30d", {}, NOW).to).toBeUndefined();
  });

  test("custom passes the explicit range through untouched", () => {
    const custom = { from: "2026-03-01", to: "2026-03-31" };
    expect(resolveRange("custom", custom, NOW)).toEqual(custom);
  });

  test("custom with only one end keeps it open on the other", () => {
    expect(resolveRange("custom", { from: "2026-03-01" }, NOW)).toEqual({ from: "2026-03-01" });
    expect(resolveRange("custom", { to: "2026-03-31" }, NOW)).toEqual({ to: "2026-03-31" });
  });

  test("a named period ignores any leftover custom range", () => {
    // Switching back to a preset must not keep filtering by the old range.
    expect(resolveRange("all", { from: "2026-03-01", to: "2026-03-31" }, NOW)).toEqual({});
  });

  test("counting back from March 1 lands in the previous year on a leap-adjacent date", () => {
    const march1 = new Date(2026, 2, 1, 9, 0);
    expect(resolveRange("30d", {}, march1)).toEqual({ from: "2026-01-30" });
  });
});

describe("rangeLabel", () => {
  test("both ends", () => {
    expect(rangeLabel({ from: "2026-03-01", to: "2026-03-31" })).toBe("Mar 1 – Mar 31");
  });

  test("open-ended each way", () => {
    expect(rangeLabel({ from: "2026-03-01" })).toBe("Since Mar 1");
    expect(rangeLabel({ to: "2026-03-31" })).toBe("Until Mar 31");
  });

  test("empty range falls back to the prompt", () => {
    expect(rangeLabel({})).toBe("Range…");
  });

  test("reads back the date that was picked, not the day before", () => {
    // `new Date("2026-03-01")` parses as UTC midnight and renders as Feb 28 in
    // western timezones; the label parses as local midnight to avoid that.
    expect(rangeLabel({ from: "2026-03-01" })).toBe("Since Mar 1");
  });
});
