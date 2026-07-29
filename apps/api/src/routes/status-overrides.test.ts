import { describe, test, expect } from "vitest";
import { sanitizeStatusOverrides } from "./status-overrides.js";

describe("sanitizeStatusOverrides", () => {
  test("keeps valid { label, tone } rules", () => {
    expect(
      sanitizeStatusOverrides({
        "Sent Out": { label: "Filed", tone: "green" },
        "Send to North Pole": { tone: "gray" },
      }),
    ).toEqual({
      "Sent Out": { label: "Filed", tone: "green" },
      "Send to North Pole": { tone: "gray" },
    });
  });

  test("drops rules with a bad or missing tone", () => {
    expect(
      sanitizeStatusOverrides({
        A: { label: "x", tone: "chartreuse" }, // not a valid tone
        B: { label: "y" }, // no tone
        C: { tone: "blue" }, // ok
      }),
    ).toEqual({ C: { tone: "blue" } });
  });

  test("trims labels and drops blank ones (tone-only rule remains)", () => {
    expect(sanitizeStatusOverrides({ A: { label: "  ", tone: "red" } })).toEqual({ A: { tone: "red" } });
    expect(sanitizeStatusOverrides({ A: { label: "  Hi  ", tone: "red" } })).toEqual({ A: { label: "Hi", tone: "red" } });
  });

  test("keeps a valid urgency and drops a bad one", () => {
    expect(
      sanitizeStatusOverrides({
        A: { tone: "red", urgency: "critical" },
        B: { tone: "blue", urgency: "later" }, // 'later' is not an assignable status urgency
      }),
    ).toEqual({
      A: { tone: "red", urgency: "critical" },
      B: { tone: "blue" },
    });
  });

  test("drops non-object rules, blank keys, and non-object input", () => {
    expect(sanitizeStatusOverrides({ "": { tone: "blue" }, A: "nope", B: null })).toEqual({});
    expect(sanitizeStatusOverrides(null)).toEqual({});
    expect(sanitizeStatusOverrides(["green"])).toEqual({});
    expect(sanitizeStatusOverrides("green")).toEqual({});
  });
});
