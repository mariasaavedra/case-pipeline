import { describe, it, expect } from "vitest";
import { feeKIdFromReference, isFullyPaid, parseReference } from "./events";

describe("parseReference", () => {
  it("reads the references the app writes", () => {
    expect(parseReference("ANA LOPEZ I-212 - AF 4120.00")).toEqual({ description: "ANA LOPEZ I-212", fee: "AF", amount: 4120 });
    expect(parseReference("  ana  lopez - ff 1210.25 ")).toEqual({ description: "ANA LOPEZ", fee: "FF", amount: 1210.25 });
    expect(parseReference("Invoice 123")).toBeNull();
    expect(parseReference("ANA - XX 10")).toBeNull();
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
