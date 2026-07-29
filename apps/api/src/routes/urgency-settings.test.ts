import { describe, test, expect } from "vitest";
import { sanitizeUrgencySettings, DEFAULT_URGENCY_SETTINGS } from "./urgency-settings.js";

describe("sanitizeUrgencySettings", () => {
  test("keeps valid values", () => {
    expect(sanitizeUrgencySettings({ criticalDays: 2, soonDays: 10, statusUrgencyAffectsBoard: false })).toEqual({
      criticalDays: 2,
      soonDays: 10,
      statusUrgencyAffectsBoard: false,
    });
  });

  test("falls back to defaults for bad/missing fields", () => {
    expect(sanitizeUrgencySettings({})).toEqual(DEFAULT_URGENCY_SETTINGS);
    expect(sanitizeUrgencySettings(null)).toEqual(DEFAULT_URGENCY_SETTINGS);
    expect(sanitizeUrgencySettings({ criticalDays: -5, soonDays: "x" })).toEqual(DEFAULT_URGENCY_SETTINGS);
  });

  test("clamps soonDays to be at least criticalDays (thresholds can't cross)", () => {
    const s = sanitizeUrgencySettings({ criticalDays: 10, soonDays: 3, statusUrgencyAffectsBoard: true });
    expect(s.criticalDays).toBe(10);
    expect(s.soonDays).toBe(10);
  });

  test("floors fractional days", () => {
    expect(sanitizeUrgencySettings({ criticalDays: 3.9, soonDays: 7.9 }).criticalDays).toBe(3);
  });
});
