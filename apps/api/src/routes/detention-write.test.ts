// =============================================================================
// Detention release tests
// =============================================================================
// Releasing clears Det. Facility in Monday, so the E&A entry it logs is the only
// record left of where the client was held. What matters: the note is never
// empty, a date is a real past-or-today calendar day, and the entry names the
// facility.
// =============================================================================

import { describe, it, expect } from "vitest";
import { parseReleaseBody, releaseActivity, CASENOTE_ACTIVITY_ID, RELEASE_NOTE_MAX } from "./detention-write";

const TODAY = "2026-09-30";

describe("parseReleaseBody", () => {
  it("accepts a note with no date", () => {
    expect(parseReleaseBody({ note: "  Released on bond  " }, TODAY)).toEqual({ ok: true, note: "Released on bond", releasedOn: null });
  });

  it("accepts a note with a date up to today", () => {
    expect(parseReleaseBody({ note: "x", releasedOn: "2026-09-30" }, TODAY)).toEqual({ ok: true, note: "x", releasedOn: "2026-09-30" });
  });

  it("requires a note", () => {
    expect(parseReleaseBody({ note: "   " }, TODAY)).toEqual({ ok: false, error: "note is required" });
    expect(parseReleaseBody(undefined, TODAY)).toEqual({ ok: false, error: "note is required" });
  });

  it("rejects an over-long note", () => {
    expect(parseReleaseBody({ note: "a".repeat(RELEASE_NOTE_MAX + 1) }, TODAY).ok).toBe(false);
  });

  it("rejects dates that are not real calendar days", () => {
    for (const releasedOn of ["09/28/2026", "2026-02-30", "2026-13-01", "yesterday"]) {
      expect(parseReleaseBody({ note: "x", releasedOn }, TODAY)).toEqual({ ok: false, error: "releasedOn must be a date (YYYY-MM-DD)" });
    }
  });

  it("rejects a future date", () => {
    expect(parseReleaseBody({ note: "x", releasedOn: "2026-10-01" }, TODAY)).toEqual({ ok: false, error: "releasedOn cannot be in the future" });
  });
});

describe("releaseActivity", () => {
  it("names the facility and logs as a Casenote", () => {
    expect(releaseActivity(["Chase Co. (KS)"], null, "Bond paid")).toEqual({
      title: "Released from detention — Chase Co. (KS)",
      customActivityId: CASENOTE_ACTIVITY_ID,
      content: "Bond paid",
    });
  });

  it("leads with the release date when given, without a timezone shift", () => {
    expect(releaseActivity(["Greene Co. (MO)"], "2026-09-28", "Bond paid").content).toBe("Released: Sep 28, 2026\n\nBond paid");
  });

  it("lists each facility once", () => {
    expect(releaseActivity(["Chase Co. (KS)", "Chase Co. (KS)", "Kay Co. (MO)"], null, "x").title)
      .toBe("Released from detention — Chase Co. (KS), Kay Co. (MO)");
  });
});
