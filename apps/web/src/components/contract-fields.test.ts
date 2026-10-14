// =============================================================================
// Shared contract (Fee K) field tests
// =============================================================================
// M11 and M2's "this call requests a contract" section both create through
// toCreateContractInput, so the mapping is pinned here once for both.
// =============================================================================

import { describe, test, expect } from "vitest";
import { contractFieldProblems, contractNoteHeader, emptyContractFields, toConsultFees, toCreateContractInput } from "./contract-fields";

describe("toCreateContractInput", () => {
  test("blank fees are not set, not zero", () => {
    expect(toCreateContractInput({ ...emptyContractFields, caseType: "I-130" })).toEqual({
      caseType: "I-130",
      af: null,
      ff: null,
      pf: null,
      description: undefined,
      attorney: "",
      email: "",
      address: "",
    });
  });

  test("typed fees become numbers and the note is trimmed", () => {
    expect(
      toCreateContractInput({
        caseType: "I-130", af: "1500", ff: "675.5", pf: "0", description: "  Payment plan  ",
        attorney: " Jane Attorney ", email: " ana@example.com ", address: " 123  Main St ",
      }),
    ).toEqual({
      caseType: "I-130", af: 1500, ff: 675.5, pf: 0, description: "Payment plan",
      attorney: "Jane Attorney", email: "ana@example.com", address: "123 Main St",
    });
  });
});

describe("toCreateContractInput — new case type", () => {
  test("a new case type is flagged so Monday adds the label", () => {
    expect(toCreateContractInput({ ...emptyContractFields, caseType: "T Visa", newCaseType: true })).toMatchObject({
      caseType: "T Visa",
      newCaseType: true,
    });
    expect(toCreateContractInput({ ...emptyContractFields, caseType: "I-130" })).not.toHaveProperty("newCaseType");
  });
});

describe("contractNoteHeader", () => {
  test("matches the API's For/Fees header, blanks as $0.00", () => {
    expect(contractNoteHeader({ ...emptyContractFields, af: "1500" })).toBe("For: ___\nFees: $1,500.00 AF $0.00 FF");
  });
});

describe("toConsultFees (P4 fee quote)", () => {
  test("an untouched section is no quote", () => {
    expect(toConsultFees(emptyContractFields)).toBeNull();
  });

  test("case type + fees, no note; blank fees are not zero", () => {
    expect(toConsultFees({ ...emptyContractFields, caseType: "Bond", af: "3500", pf: "0", description: "ignored" }))
      .toEqual({ caseType: "Bond", af: 3500, ff: null, pf: 0 });
    expect(toConsultFees({ ...emptyContractFields, caseType: "Habeas", newCaseType: true }))
      .toEqual({ caseType: "Habeas", newCaseType: true, af: null, ff: null, pf: null });
  });

  test("fees without a case type still come back, so the page can ask for one", () => {
    expect(toConsultFees({ ...emptyContractFields, ff: "675" })).toEqual({ caseType: "", af: null, ff: 675, pf: null });
  });
});

describe("contractFieldProblems (M11, M2 — all five P14 fields required)", () => {
  const full = { ...emptyContractFields, caseType: "Bond", af: "3500", attorney: "Jane Attorney", email: "ana@example.com", address: "123 Main St" };

  test("complete → nothing missing; FF / PF / note stay optional", () => {
    expect(contractFieldProblems(full)).toEqual([]);
  });

  test("lists each missing field, in P14's order", () => {
    expect(contractFieldProblems(emptyContractFields)).toEqual(["case type", "attorney fee (AF)", "attorney", "client e-mail", "client address"]);
  });

  test("AF 0 is a fee; a bad e-mail is called out", () => {
    expect(contractFieldProblems({ ...full, af: "0" })).toEqual([]);
    expect(contractFieldProblems({ ...full, email: "ana@" })).toEqual(["a valid client e-mail"]);
  });

  test("the P4 quote never carries the client fields", () => {
    expect(toConsultFees(full)).toEqual({ caseType: "Bond", af: 3500, ff: null, pf: null });
  });
});
