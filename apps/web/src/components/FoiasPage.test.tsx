// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Foia, FoiasResult } from "../api";

function item(o: Partial<Foia> & { localId: string }): Foia {
  return {
    itemName: o.localId,
    clientName: `Client ${o.localId}`,
    clientLocalId: null,
    status: "TO-DO",
    phase: "ours",
    paralegals: ["Mayra Ruiz"],
    attorney: "Lucy Betteridge",
    quoted: ["EOIR", "FBI"],
    filed: ["EOIR"],
    toFile: ["FBI"],
    onFoiasSince: "2026-09-01",
    filedOn: null,
    inquiryEligible: null,
    requestNumbers: [],
    ageDays: 34,
    ageLevel: "late",
    whereToFile: null,
    flags: [],
    ...o,
  };
}

const result: FoiasResult = {
  items: [
    item({ localId: "ours" }),
    item({ localId: "waiting", phase: "agency", status: "Sent Out", filedOn: "2026-09-20", ageDays: 15, ageLevel: "fresh", inquiryEligible: "2026-10-01", flags: ["inquiry_due"] }),
    item({ localId: "ancient", phase: "agency", status: "Sent Out", filedOn: "2025-01-01", ageDays: 640, flags: ["stale"] }),
  ],
  doneCount: 100,
  doneLast30: 4,
  thresholds: {
    decide: { waitingDays: 14, lateDays: 30 },
    ours: { waitingDays: 14, lateDays: 30 },
    agency: { waitingDays: 30, lateDays: 60 },
    parked: { waitingDays: 60, lateDays: 120 },
  },
};

vi.mock("../api", () => ({
  fetchFoias: () => Promise.resolve(result),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("FoiasPage", () => {
  it("lists our turn first, shows agencies to file, hides stale until asked", async () => {
    const { FoiasPage } = await import("./FoiasPage");
    const el = document.createElement("div");
    const root = createRoot(el);
    await act(async () => root.render(<FoiasPage />));
    const text = el.textContent ?? "";
    expect(text).toContain("3 open");
    expect(text).toContain("1 our turn");
    expect(text).toContain("1 inquiry due");
    expect(text).toContain("100 done (4 results in the last 30 days)");
    expect(text.indexOf("Our turn")).toBeLessThan(text.indexOf("Waiting on the agency"));
    expect(text).toContain("FBI to file");
    expect(text).toContain("Client waiting");
    expect(text).not.toContain("Client ancient");

    const show = Array.from(el.querySelectorAll("button")).find((b) => b.textContent?.startsWith("Show 1 with no results"))!;
    await act(async () => show.click());
    expect(el.textContent).toContain("Client ancient");
    act(() => root.unmount());
  });
});
