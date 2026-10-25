// @vitest-environment jsdom
// =============================================================================
// P11.3.6 Fee K Types — the Buzón document checklist editor ("Documents…")
// =============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { FeeKTypesTable } from "../api";

const mocks = vi.hoisted(() => ({ table: null as FeeKTypesTable | null, update: vi.fn() }));

vi.mock("../api", () => ({
  fetchFeeKTypes: async () => mocks.table,
  updateFeeKTypes: mocks.update,
}));
vi.mock("./FeeSheetPicker", () => ({ feeSheetOnce: () => new Promise(() => {}) }));

const { FeeKTypesSection } = await import("./FeeKTypesSection");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const button = (label: string) => Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === label);
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };
const click = async (el: Element | undefined) => {
  expect(el).toBeTruthy();
  await act(async () => { (el as HTMLElement).click(); });
  await flush();
};
async function type(label: string, value: string) {
  const el = document.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
  expect(el).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const BLANK = { spanish: "", board: "", feeSheetJob: "", services: "", servicesEs: "", excluded: "", excludedEs: "" };

beforeEach(async () => {
  document.body.innerHTML = "";
  mocks.table = {
    rows: [{ ...BLANK, feeKType: "I-130", spanish: "Petición" }], feeKTypes: ["I-130", "FOIA"], boards: [], draft: false,
    suggestedDocuments: { FOIA: [{ en: "Photo ID", es: "Identificación con foto", required: true }] },
  };
  mocks.update.mockReset().mockImplementation(async (rows) => ({ ...mocks.table!, rows }));
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => { root.render(<FeeKTypesSection />); });
  await flush();
});

describe("Fee K Types → Documents…", () => {
  it("adds a document with its Spanish name and saves it on that type only", async () => {
    const docs = Array.from(document.querySelectorAll("button")).filter((b) => b.textContent === "Documents…");
    expect(docs).toHaveLength(2);
    await click(docs[0]);
    expect(document.body.textContent).toContain("No documents: a Buzón for this case type has no checklist.");
    await click(button("+ Add a document"));
    await type("Document 1 for I-130", "Marriage certificate");
    await type("Document 1 in Spanish for I-130", "Acta de matrimonio");
    expect(button("Documents (1)")).toBeTruthy();
    await click(button("Save"));
    const rows = mocks.update.mock.calls[0]![0] as { feeKType: string; documents?: unknown[] }[];
    expect(rows.find((r) => r.feeKType === "I-130")?.documents).toEqual([{ en: "Marriage certificate", es: "Acta de matrimonio", required: true }]);
    expect(rows.find((r) => r.feeKType === "FOIA")?.documents).toEqual([]);
  });

  it("a suggested list fills an empty one only when asked, and is saved like any other", async () => {
    await click(button("Fill 1 empty document lists with suggestions"));
    expect(button("Documents (1)")).toBeTruthy();
    await click(button("Save"));
    const rows = mocks.update.mock.calls[0]![0] as { feeKType: string; documents?: unknown[] }[];
    expect(rows.find((r) => r.feeKType === "FOIA")?.documents).toEqual([{ en: "Photo ID", es: "Identificación con foto", required: true }]);
  });
});
