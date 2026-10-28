import { describe, it, expect } from "vitest";
import { findCaseTypeOption } from "./fee-k-case-type";

describe("findCaseTypeOption", () => {
  const options = [{ label: "Bond MTN  (c)" }, { label: "U Visa" }];

  it("matches Monday's label whatever the spacing or case, and returns it as Monday has it", () => {
    expect(findCaseTypeOption(options, "Bond MTN (c)")?.label).toBe("Bond MTN  (c)");
    expect(findCaseTypeOption(options, " bond mtn  (C) ")?.label).toBe("Bond MTN  (c)");
    expect(findCaseTypeOption(options, "u visa")?.label).toBe("U Visa");
  });

  it("a different label matches nothing", () => {
    expect(findCaseTypeOption(options, "Bond MTN")).toBeUndefined();
  });
});
