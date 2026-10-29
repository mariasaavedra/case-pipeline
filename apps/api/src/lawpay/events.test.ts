import { describe, it, expect } from "vitest";
import { feeKIdFromReference, isFullyPaid, paidFees, parseReference, partsLeft } from "./events";

describe("parseReference", () => {
  it("reads the references the app writes", () => {
    expect(parseReference("ANA LOPEZ I-212 - AF 4120.00")).toEqual({ description: "ANA LOPEZ I-212", fee: "AF", amount: 4120 });
    expect(parseReference("  ana  lopez - ff 1210.25 ")).toEqual({ description: "ANA LOPEZ", fee: "FF", amount: 1210.25 });
    expect(parseReference("Invoice 123")).toBeNull();
    expect(parseReference("ANA - XX 10")).toBeNull();
  });
  it("reads a split fee's part", () => {
    expect(parseReference("ANA LOPEZ K8F2XQ1 - AF 1/2 2000")).toEqual({ description: "ANA LOPEZ K8F2XQ1", fee: "AF", amount: 2000, part: { n: 1, of: 2 } });
    expect(parseReference("ANA - af 3/3 700.50")?.part).toEqual({ n: 3, of: 3 });
    expect(parseReference("ANA - AF 3/2 700")).toBeNull();
  });
});

describe("paidFees", () => {
  it("a whole payment pays its fee", () => {
    expect(paidFees(["ANA - AF 4120", "ANA - FF 675"])).toEqual(new Set(["AF", "FF"]));
  });
  it("a split fee is paid only when every part is", () => {
    expect(paidFees(["ANA - AF 1/2 2000"])).toEqual(new Set());
    expect(paidFees(["ANA - AF 1/2 2000", "ANA - AF 1/2 2000"])).toEqual(new Set());
    expect(paidFees(["ANA - AF 1/2 2000", "ANA - AF 2/2 2120"])).toEqual(new Set(["AF"]));
    expect(paidFees(["ANA - AF 1/2 2000", "ANA - AF 2/3 1000"])).toEqual(new Set());
  });
  it("counts the parts left", () => {
    const ref = parseReference("ANA - AF 1/3 1000")!;
    expect(partsLeft(ref, ["ANA - AF 1/3 1000"])).toBe(2);
    expect(partsLeft(ref, ["ANA - AF 1/3 1000", "ANA - AF 2/3 1000", "ANA - AF 3/3 1120"])).toBe(0);
    expect(partsLeft(parseReference("ANA - AF 4120")!, [])).toBeNull();
  });
});

describe("isFullyPaid", () => {
  it("against the links handed out", () => {
    const issued = [{ fee: "AF" as const, amount: 4120, paidAt: null }, { fee: "FF" as const, amount: 1210.25, paidAt: null }];
    expect(isFullyPaid(issued, {}, new Set(["AF"]))).toBe(false);
    expect(isFullyPaid(issued, {}, new Set(["AF", "FF"]))).toBe(true);
  });
  it("without a ledger, against the Fee K's own fees", () => {
    expect(isFullyPaid([], { AF: 900, FF: null, PF: 0 }, new Set(["AF"]))).toBe(true);
    expect(isFullyPaid([], { AF: 900, FF: 675 }, new Set(["AF"]))).toBe(false);
    expect(isFullyPaid([], {}, new Set(["AF"]))).toBe(false);
  });
});

describe("feeKIdFromReference", () => {
  it("reads the Fee K code M21 adds (K + Monday id in base 36)", () => {
    const id = 18323456789;
    const code = `K${id.toString(36).toUpperCase()}`;
    expect(feeKIdFromReference(`ANA LOPEZ I-212 ${code}`)).toBe(String(id));
    expect(feeKIdFromReference(parseReference(`ANA LOPEZ I-212 ${code} - AF 4120`)!.description)).toBe(String(id));
  });
  it("no code → null (a hand-made reference, or a K-word that isn't at the end)", () => {
    expect(feeKIdFromReference("NORA TEST FOR ISAAC TEST ADMIN FEE")).toBeNull();
    expect(feeKIdFromReference("KIM LEE I-130")).toBeNull();
  });
});

describe("personName", () => {
  it("keeps the person, drops A-numbers and [tags]", async () => {
    const { personName } = await import("./events");
    expect(personName("Isaac GONZALEZ MOLINA A214-099-391 [DETAINED IN CHASE]")).toBe("ISAAC GONZALEZ MOLINA");
    expect(personName("[10/19/26 - BOND] - Isaac GONZALEZ MOLINA A214-099-391 [DETAINED IN CHASE]")).toBe("ISAAC GONZALEZ MOLINA");
    expect(personName("Keyra Crystal MOLINA OLIVAS [A241-089-171] DETAINED CHASE")).toBe("KEYRA CRYSTAL MOLINA OLIVAS");
    expect(personName("Claudio MOLINA AVILA [A201-510-130]")).toBe("CLAUDIO MOLINA AVILA");
    expect(personName("Luis A. SANDOVAL-MOLINA")).toBe("LUIS A. SANDOVAL-MOLINA");
    expect(personName("Ana LOPEZ")).toBe("ANA LOPEZ");
  });
});
