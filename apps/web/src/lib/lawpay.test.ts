import { describe, it, expect } from "vitest";
import { lawPayLink, formatLawPayAmount, partsAddUp, rebalanceParts, splitEvenly } from "./lawpay";

describe("lawPayLink", () => {
  it("matches the firm's script for an attorney fee", () => {
    expect(lawPayLink("Change of Address - Rafael Contreras I765", "AF", 800)).toBe(
      "https://secure.lawpay.com/pages/scal/operating?amount=800&readOnlyFields=reference,amount" +
        "&reference=CHANGE%20OF%20ADDRESS%20-%20RAFAEL%20CONTRERAS%20I765%20-%20AF%20800",
    );
  });

  it("sends filing fees to Trust and postage fees to Operating", () => {
    expect(lawPayLink("Murray Osorio Habeas", "FF", 405)).toMatch(/^https:\/\/secure\.lawpay\.com\/pages\/scal\/trust\?amount=405&/);
    expect(lawPayLink("Murray Osorio Habeas", "PF", 50)).toMatch(/\/scal\/operating\?amount=50&.*-%20PF%2050$/);
  });

  it("refuses an empty description or a zero amount", () => {
    expect(lawPayLink("  ", "AF", 800)).toBeNull();
    expect(lawPayLink("X", "AF", 0)).toBeNull();
  });
});

describe("formatLawPayAmount", () => {
  it("keeps whole dollars bare and pads cents", () => {
    expect(formatLawPayAmount(3500)).toBe("3500");
    expect(formatLawPayAmount("105.5")).toBe("105.50");
    expect(formatLawPayAmount("$1,200")).toBe("1200");
  });
});

describe("split payments", () => {
  it("a part's reference carries n/N before the amount", () => {
    expect(lawPayLink("Ana Lopez", "AF", 2000, { n: 1, of: 2 })).toMatch(/&reference=ANA%20LOPEZ%20-%20AF%201%2F2%202000$/);
  });
  it("splits evenly, leftover cents on the last part", () => {
    expect(splitEvenly(4000, 2)).toEqual([2000, 2000]);
    expect(splitEvenly(100, 3)).toEqual([33.33, 33.33, 33.34]);
  });
  it("typing one part fills in the others", () => {
    expect(rebalanceParts(4000, [1500, 2000], 0)).toEqual([1500, 2500]);
    expect(rebalanceParts(4000, [1000, 1000, 1000], 0)).toEqual([1000, 1500, 1500]);
    expect(rebalanceParts(4000, [1000, 1500, 1500], 1)).toEqual([1000, 1500, 1500]);
    expect(rebalanceParts(4000, [1000, 1000, 2500], 2)).toEqual([750, 750, 2500]);
    // Nothing left to share: unchanged.
    expect(rebalanceParts(4000, [4000, 0], 0)).toEqual([4000, 0]);
  });
  it("parts must be positive and add up to the cent", () => {
    expect(partsAddUp(100, [33.33, 33.33, 33.34])).toBe(true);
    expect(partsAddUp(100, [50, 49])).toBe(false);
    expect(partsAddUp(100, [100, 0])).toBe(false);
    expect(partsAddUp(100, [100])).toBe(false);
  });
});
