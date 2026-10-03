// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { AddressChange, AddressChangesResult } from "../api";

function item(o: Partial<AddressChange> & { localId: string }): AddressChange {
  return {
    itemName: o.localId,
    clientName: `Client ${o.localId}`,
    clientLocalId: null,
    status: "PAID - Needs Address Change",
    phase: "firm",
    withWho: "COURT",
    court: true,
    method: "ECAS",
    oldAddress: "1 Old Rd",
    newAddress: "2 New St",
    assistant: "Laura Torres",
    receivedOn: "2026-09-01",
    ageDays: 31,
    ageLevel: "late",
    hearingDate: null,
    daysToHearing: null,
    hearingSoon: false,
    flags: [],
    ...o,
  };
}

const result: AddressChangesResult = {
  items: [
    item({ localId: "ours" }),
    item({ localId: "unpaid", phase: "payment", status: "Waiting for Payment", ageLevel: "fresh", ageDays: 10 }),
    item({ localId: "ancient", phase: "payment", status: "Waiting for Payment", ageDays: 900, flags: ["stale_payment"] }),
  ],
  statusOptions: [],
  statusColumnId: null,
  dateSentColumnId: null,
  thresholds: {
    firm: { waitingDays: 7, lateDays: 14 },
    review: { waitingDays: 7, lateDays: 14 },
    submitted: { waitingDays: 30, lateDays: 60 },
    payment: { waitingDays: 30, lateDays: 60 },
    hold: { waitingDays: 30, lateDays: 60 },
  },
};

vi.mock("../api", () => ({
  fetchAddressChanges: () => Promise.resolve(result),
  changeBoardItemStatus: vi.fn(),
  changeBoardItemColumn: vi.fn(),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("AddressChangesPage", () => {
  it("lists our turn first and hides unpaid-for-6-months until asked", async () => {
    const { AddressChangesPage } = await import("./AddressChangesPage");
    const el = document.createElement("div");
    const root = createRoot(el);
    await act(async () => root.render(<AddressChangesPage />));
    const text = el.textContent ?? "";
    expect(text).toContain("3 open");
    expect(text).toContain("1 paid, our turn");
    expect(text.indexOf("Paid: our turn")).toBeLessThan(text.indexOf("Waiting on payment"));
    expect(text).toContain("Client unpaid");
    expect(text).not.toContain("Client ancient");
    expect(text).toContain("Show 1 unpaid 6+ months");

    const show = Array.from(el.querySelectorAll("button")).find((b) => b.textContent?.startsWith("Show 1 unpaid"))!;
    await act(async () => show.click());
    expect(el.textContent).toContain("Client ancient");
    act(() => root.unmount());
  });
});
