// =============================================================================
// New contract (M11) description tests
// =============================================================================
// The description typed on M11 becomes a "Contract note" E&A entry on the
// client's profile. The activity id must be the firm's existing type — a new
// one would give staff two identically named entries in monday's picker.
// =============================================================================

import { describe, it, expect } from "vitest";
import { contractActivity, parseContractDescription, CONTRACT_NOTE_ACTIVITY_ID } from "./profile-write";

describe("parseContractDescription", () => {
  it("trims, and treats anything that isn't a string as no description", () => {
    expect(parseContractDescription("  payment plan: 3 × $500 \n")).toBe("payment plan: 3 × $500");
    expect(parseContractDescription("   ")).toBe("");
    expect(parseContractDescription(undefined)).toBe("");
    expect(parseContractDescription(42)).toBe("");
  });
});

describe("contractActivity", () => {
  it("logs a Contract note on the profile item, titled by case type", () => {
    expect(contractActivity("123456", "I-130 Petition", "Paid deposit in cash")).toEqual({
      itemId: "123456",
      title: "New contract — I-130 Petition",
      customActivityId: CONTRACT_NOTE_ACTIVITY_ID,
      content: "Paid deposit in cash",
    });
    expect(CONTRACT_NOTE_ACTIVITY_ID).toBe("89e0ea14-1f47-45ba-81ab-1f276b958f9c");
  });
});
