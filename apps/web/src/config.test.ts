import { describe, test, expect } from "vitest";
import { translateStatus, getStatusColor } from "./config";

describe("translateStatus", () => {
  test("curated relabels change label and tone", () => {
    expect(translateStatus("Sent Out")).toEqual({ label: "Filed", tone: "green" });
    expect(translateStatus("918b Request pending")).toEqual({ label: "Pending", tone: "yellow" });
    // Consistent with the contracts tab.
    expect(translateStatus("Create Project")).toEqual({ label: "Completed", tone: "green" });
  });

  test("tone-only overrides keep the original label", () => {
    expect(translateStatus("Send to North Pole")).toEqual({ label: "Send to North Pole", tone: "gray" });
    expect(translateStatus("Interview done")).toEqual({ label: "Interview done", tone: "green" });
  });

  test("fixes a known typo", () => {
    expect(translateStatus("Inverview going alone").label).toBe("Interview going alone");
  });

  test("matches override regardless of case/whitespace (firm has variants)", () => {
    for (const v of ["SENT OUT", "Sent out", "  Sent Out  "]) {
      expect(translateStatus(v)).toEqual({ label: "Filed", tone: "green" });
    }
  });

  test("word boundaries avoid false-positive tones", () => {
    expect(translateStatus("Assigned").tone).not.toBe("green"); // not 'signed'
    expect(translateStatus("Unpaid").tone).not.toBe("green"); // not 'paid'
  });

  test("infers a sensible tone for the long tail (no exact entry)", () => {
    expect(translateStatus("Not going forward").tone).toBe("gray");
    expect(translateStatus("Denied").tone).toBe("red");
    expect(translateStatus("Interview scheduled").tone).toBe("yellow");
    expect(translateStatus("Payment link sent. Waiting on payment").tone).toBe("yellow");
    expect(translateStatus("Requested REFUND").tone).toBe("gray");
    // Unknown, no keyword → neutral blue (not mis-colored).
    expect(translateStatus("New Detainee").tone).toBe("blue");
    // The long tail keeps its raw label.
    expect(translateStatus("New Detainee").label).toBe("New Detainee");
  });

  test("null status is a neutral dash", () => {
    expect(translateStatus(null)).toEqual({ label: "—", tone: "gray" });
  });

  test("accepts a caller-supplied override map (the Phase-2 admin path)", () => {
    const admin = { "Sent Out": { label: "Shipped", tone: "purple" as const } };
    expect(translateStatus("Sent Out", admin)).toEqual({ label: "Shipped", tone: "purple" });
    // A status not in the supplied map still infers a tone.
    expect(translateStatus("Denied", admin).tone).toBe("red");
  });

  test("getStatusColor delegates to the translated tone", () => {
    expect(getStatusColor("Sent Out")).toBe("green");
    expect(getStatusColor(null)).toBe("gray");
  });
});
