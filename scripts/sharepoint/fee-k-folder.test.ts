import { describe, it, expect } from "vitest";
import { pickFeeKFolder } from "./fee-k-folder.js";

const f = (name: string, folder = true) => ({ name, ...(folder ? { folder: {} } : {}) });

describe("pickFeeKFolder", () => {
  it("finds the Fee K folder whatever its spelling", () => {
    for (const name of ["FEE Ks", "FEE K's", "Fee K's", "FEE K'S", "FEEKs", "Fee K’s", " FEE KS "]) {
      expect(pickFeeKFolder([f("CONSULT"), f(name)])?.name).toBe(name);
    }
  });
  it("prefers a Fee K folder over Contracts, and uses Contracts when that is all there is", () => {
    expect(pickFeeKFolder([f("Contracts"), f("FEE Ks")])?.name).toBe("FEE Ks");
    expect(pickFeeKFolder([f("CONSULT"), f("CONTRACTS")])?.name).toBe("CONTRACTS");
  });
  it("ignores files and look-alikes", () => {
    expect(pickFeeKFolder([f("FEE Ks", false), f("Fee K drafts"), f("EVIDENCE")])).toBeNull();
  });
});
