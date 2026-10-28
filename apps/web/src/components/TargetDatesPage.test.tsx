// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { TargetDateCaseView, TargetDatesView } from "../api";

function c(o: Partial<TargetDateCaseView> & { localId: string }): TargetDateCaseView {
  return {
    clientName: `Client ${o.localId}`, clientLocalId: null, formName: "I-130", status: "Needs Forms Appt", targetDate: "2026-10-30",
    urgency: "soon", daysUntilTarget: 4, dateUrgency: "soon", statusUrgency: "none", isCourtCase: false, assignees: ["Mayra Ruiz"],
    priority: null, forms: ["I130"], attorney: "Lucy Betteridge", urgent: false, northPoleUntil: null, snoozed: false, parked: false,
    mondayItemId: "m1", eFile: null, eFileOnProfile: false, formsApptDate: null, formsSentDate: null, hireDate: null, onOpenFormsSince: null,
    bucket: "week", daysLeft: 4, moves: 0, lastChange: null, ...o,
  };
}

const view: TargetDatesView = {
  today: "2026-10-26",
  cases: [
    c({ localId: "late", targetDate: "2026-10-17", bucket: "overdue", daysLeft: -9, moves: 3,
      lastChange: { at: "2026-10-20T15:00:00Z", userId: "9", from: "2026-10-10", to: "2026-10-17", by: "Mayra Ruiz", byAdmin: false } }),
    c({ localId: "soon" }),
    c({ localId: "far", targetDate: "2026-12-20", bucket: "later", daysLeft: 55, assignees: ["Lucy B"] }),
    c({ localId: "nodate", targetDate: null, bucket: "none", daysLeft: null }),
  ],
  counts: { overdue: 1, week: 1, twoWeeks: 0, later: 1, none: 1 },
  paralegals: ["Lucy B", "Mayra Ruiz"],
  snoozedCount: 2,
  openFormStatuses: [{ index: 0, label: "Needs Forms Appt", color: "#fdab3d", border: "#fdab3d" }, { index: 1, label: "Forms Appt Set", color: "#00c875", border: "#00c875" }],
};

const moveTargetDate = vi.fn(() => Promise.resolve({ localId: "late", field: "target_date", value: "2026-11-02", pending: false }));

vi.mock("./CaseCardModal", () => ({
  CaseCardModal: ({ card, statuses }: { card: { kind: string; c: { clientName: string } }; statuses: { label: string }[] }) => (
    <div data-testid="m27">{`M27 ${card.kind} ${card.c.clientName} · ${statuses.map((s) => s.label).join("|")}`}</div>
  ),
}));

vi.mock("../api", () => ({
  fetchTargetDates: () => Promise.resolve(view),
  fetchStaff: () => Promise.resolve({ staff: [], roles: [] }),
  moveTargetDate: (...a: unknown[]) => (moveTargetDate as (...x: unknown[]) => unknown)(...a),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("TargetDatesPage", () => {
  it("shows overdue and this week open, later and no-date behind a click, flags a non-admin change", async () => {
    const { TargetDatesPage } = await import("./TargetDatesPage");
    const el = document.createElement("div");
    const root = createRoot(el);
    await act(async () => root.render(<TargetDatesPage />));
    const text = el.textContent ?? "";

    expect(text).toContain("Client late");
    expect(text).toContain("9d late");
    expect(text).toContain("Moved 3×");
    expect(text).toContain("Changed by Mayra Ruiz");
    expect(text).toContain("Client soon");
    expect(text).not.toContain("Client far");
    expect(text).not.toContain("Client nodate");
    expect(text).toContain("2 parked at the North Pole not shown");

    const later = Array.from(el.querySelectorAll("button")).find((b) => b.textContent?.includes("Later") && b.getAttribute("aria-expanded") !== null)!;
    await act(async () => later.click());
    expect(el.textContent).toContain("Client far");

    const lucy = Array.from(el.querySelectorAll("button")).find((b) => b.textContent === "Lucy B")!;
    await act(async () => lucy.click());
    expect(el.textContent).not.toContain("Client late");
    expect(el.textContent).toContain("Client far");
    root.unmount();
  });

  it("opens the Open Form's case card (M27) from the client's name, with the board's statuses", async () => {
    const { TargetDatesPage } = await import("./TargetDatesPage");
    const el = document.createElement("div");
    const root = createRoot(el);
    await act(async () => root.render(<TargetDatesPage />));
    const name = Array.from(el.querySelectorAll("button")).find((b) => b.textContent === "Client soon")!;
    await act(async () => name.click());
    expect(el.querySelector("[data-testid=m27]")?.textContent).toBe("M27 open_form Client soon · Needs Forms Appt|Forms Appt Set");
    root.unmount();
  });

  it("M33 offers +1/+2/+3/+5 days and a calendar", async () => {
    const { TargetDatesPage } = await import("./TargetDatesPage");
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => root.render(<TargetDatesPage />));
    const move = Array.from(el.querySelectorAll("button")).find((b) => b.textContent === "Move date")!;
    await act(async () => move.click());
    const dialog = document.body;
    const presets = Array.from(dialog.querySelectorAll("button")).map((b) => b.textContent).filter((t) => /^\+\d+d$/.test(t ?? ""));
    expect(presets).toEqual(["+1d", "+2d", "+3d", "+5d"]);
    expect(dialog.querySelector("[aria-label='Next month']")).not.toBeNull();
    root.unmount();
    el.remove();
  });
});
