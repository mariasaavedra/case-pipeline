import { describe, it, expect } from "vitest";
import { lawPayLink, formatLawPayAmount } from "./lawpay";

describe("lawPayLink", () => {
  it("matches the firm's script for an attorney fee", () => {
    expect(lawPayLink("Change of Address - Rafael Contreras I765", "AF", 800)).toBe(
      "https://secure.lawpay.com/pages/scal/operating?amount=800&readOnlyFields=reference,amount" +
        "&reference=CHANGE%20OF%20ADDRESS%20-%20RAFAEL%20CONTRERAS%20I765%20-%20AF%20800",
    );
  });

  it("sends filing fees to Trust and processing fees to Operating", () => {
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
