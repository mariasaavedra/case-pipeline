import { describe, it, expect } from "vitest";
import { parseAmount, parseFeeSheet } from "./fee-sheet";

describe("parseAmount", () => {
  it("reads plain amounts, US and European", () => {
    expect(parseAmount(5000)).toBe(5000);
    expect(parseAmount("1060")).toBe(1060);
    expect(parseAmount("$3,500.00")).toBe(3500);
    expect(parseAmount("$3.500,00")).toBe(3500);
    expect(parseAmount("$1,095")).toBe(1095);
    expect(parseAmount("$100.00")).toBe(100);
    expect(parseAmount("0")).toBe(0);
  });
  it("leaves anything that isn't a plain amount alone", () => {
    for (const s of ["TBD", "", "Unknown", "$4000-inter. extra", "$185 for K's it is $265", "2000/2000/2000", "$3500.00 (+)", "E-Copy $50.00", "$20.00 per page", "Check filing category + EAD tab"]) {
      expect(parseAmount(s)).toBeNull();
    }
  });
});

describe("parseFeeSheet", () => {
  const sheet = [
    ["Job", "AF", "AF surcharge fee", "FF", "FF surcharge fee", ""],
    ["BIA Appeal", 5000, "", 1060, "", "E-26 or E-29"],
    ["I-130 (paper)", 3000, "", 675, "", ""],
    ["EOIR 42B (emergency)", "$3.500,00", "", 1690, "", "+check payment for biometrics/$100 postage fee"],
    ["I-589 (Asylum)", "$4000-inter. extra", "", "$100.00 + $100 Annual fee per year asylum app is pending", "", ""],
    ["I-485 (SIJS, VAWA or Refugee Adjustment of Status in Court)", 3800, 3500, 1590, "", ""],
    ["", "", "", "", "", ""],
  ];

  it("reads each job's AF + FF and keeps the remarks", () => {
    const rows = parseFeeSheet(sheet);
    expect(rows.map((r) => r.job)).toEqual(["BIA Appeal", "I-130 (paper)", "EOIR 42B (emergency)", "I-589 (Asylum)", "I-485 (SIJS, VAWA or Refugee Adjustment of Status in Court)"]);
    expect(rows[0]).toEqual({ job: "BIA Appeal", attorneyFee: 5000, filingFee: 1060, attorneyFeeText: "", filingFeeText: "", note: "E-26 or E-29" });
    expect(rows[2]).toMatchObject({ attorneyFee: 3500, filingFee: 1690, note: "+check payment for biometrics/$100 postage fee" });
  });

  it("a non-amount stays as text for the user to read", () => {
    expect(parseFeeSheet(sheet)[3]).toMatchObject({
      attorneyFee: null, attorneyFeeText: "$4000-inter. extra",
      filingFee: null, filingFeeText: "$100.00 + $100 Annual fee per year asylum app is pending",
    });
  });

  it("ignores the surcharge columns (the app works surcharges out itself)", () => {
    expect(parseFeeSheet(sheet)[4]!.note).toBe("");
  });

  it("finds the header row even with a title above it, and returns nothing without one", () => {
    expect(parseFeeSheet([["FIRM FEES 2026"], ...sheet])).toHaveLength(5);
    expect(parseFeeSheet([["Name", "Price"]])).toEqual([]);
  });
});
