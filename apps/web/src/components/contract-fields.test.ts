// =============================================================================
// Shared contract (Fee K) field tests
// =============================================================================
// M11 and M2's "this call requests a contract" section both create through
// toCreateContractInput, so the mapping is pinned here once for both.
// =============================================================================

import { describe, test, expect } from "vitest";
import { contractNoteHeader, emptyContractFields, toCreateContractInput } from "./contract-fields";

describe("toCreateContractInput", () => {
  test("blank fees are not set, not zero", () => {
    expect(toCreateContractInput({ ...emptyContractFields, caseType: "I-130" })).toEqual({
      caseType: "I-130",
      af: null,
      ff: null,
      pf: null,
      description: undefined,
    });
  });

  test("typed fees become numbers and the note is trimmed", () => {
    expect(
      toCreateContractInput({ caseType: "I-130", af: "1500", ff: "675.5", pf: "0", description: "  Payment plan  " }),
    ).toEqual({ caseType: "I-130", af: 1500, ff: 675.5, pf: 0, description: "Payment plan" });
  });
});

describe("contractNoteHeader", () => {
  test("matches the API's For/Fees header, blanks as $0.00", () => {
    expect(contractNoteHeader({ ...emptyContractFields, af: "1500" })).toBe("For: ___\nFees: $1,500.00 AF $0.00 FF");
  });
});
