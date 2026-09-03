import { describe, it, expect } from "vitest";
import { linkTargetForSite, CONSULT_FILE, E_FILE } from "./link-target.js";

describe("linkTargetForSite", () => {
  it("records a consult folder as a Consult File", () => {
    expect(linkTargetForSite("scalconsults")).toBe(CONSULT_FILE);
  });

  it("records a hired client's folder as an E-File", () => {
    expect(linkTargetForSite("scalefiles")).toBe(E_FILE);
  });

  it("records a CLOSED case as an E-File, not a consult", () => {
    // The whole point: a finished case must not be filed as a pending consult.
    expect(linkTargetForSite("SCALClosed")).toBe(E_FILE);
  });

  it("matches the site name case-insensitively", () => {
    expect(linkTargetForSite("SCALCONSULTS")).toBe(CONSULT_FILE);
  });
});
