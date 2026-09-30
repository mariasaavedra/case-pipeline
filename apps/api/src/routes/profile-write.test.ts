// =============================================================================
// New contract (M11) note tests
// =============================================================================
// Every new Fee K gets a note — For/Fees header plus the optional description —
// as an update and as a "Contract note" E&A entry on the Fee K itself. The
// activity id must be the firm's existing type — a new one would give staff
// two identically named entries in monday's picker.
// =============================================================================

import { describe, it, expect } from "vitest";
import { contractActivity, contractNoteText, parseContractDescription, CONTRACT_NOTE_ACTIVITY_ID } from "./profile-write";

describe("parseContractDescription", () => {
  it("trims, and treats anything that isn't a string as no description", () => {
    expect(parseContractDescription("  payment plan: 3 × $500 \n")).toBe("payment plan: 3 × $500");
    expect(parseContractDescription("   ")).toBe("");
    expect(parseContractDescription(undefined)).toBe("");
    expect(parseContractDescription(42)).toBe("");
  });
});

describe("contractNoteText", () => {
  it("heads the note with For and Fees, then the description", () => {
    expect(contractNoteText("I-130 Petition", 1500, 675, "Paid deposit in cash")).toBe(
      "For: I-130 Petition\nFees: $1,500.00 AF $675.00 FF\n\nPaid deposit in cash",
    );
  });

  it("is just the header with no description, and a blank fee reads $0.00", () => {
    expect(contractNoteText("U-Visa", 2000, null, "")).toBe("For: U-Visa\nFees: $2,000.00 AF $0.00 FF");
  });
});

describe("contractActivity", () => {
  it("is a Contract note titled by case type, carrying the note", () => {
    expect(contractActivity("I-130 Petition", "For: I-130 Petition")).toEqual({
      title: "New contract — I-130 Petition",
      customActivityId: CONTRACT_NOTE_ACTIVITY_ID,
      content: "For: I-130 Petition",
    });
    expect(CONTRACT_NOTE_ACTIVITY_ID).toBe("89e0ea14-1f47-45ba-81ab-1f276b958f9c");
  });
});
