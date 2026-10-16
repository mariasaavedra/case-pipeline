// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { CaseTimeline, TimelineItem } from "../api";

const hearing = {
  date: "2026-09-30", track: "court" as const, kind: "hearing" as const, label: "Master hearing", status: "unknown" as const,
  detail: "Calendaring status: Added on Cal", source: "[9/30/26] MASTER: Ana RIVERA", boardKey: "calendaring", itemLocalId: "h1", updateLocalId: null,
};
const notes = {
  date: "2026-06-03", track: "court" as const, kind: "note" as const, label: "Hearing notes", status: null,
  detail: "6-3-2026 Indiv. Hearing, client present", source: "E&A · HEARING NOTES", boardKey: null, itemLocalId: null, updateLocalId: "u7",
};
let fetches = 0;
const timeline = (): CaseTimeline => ({
  profileLocalId: "p1",
  today: "2026-10-16",
  events: [notes, hearing],
  notesByMonth: [],
  summary: {
    standing: [],
    attention: [{ tone: "warn", date: "2026-09-30", text: "Master hearing — no outcome recorded", fix: { kind: "hearing_outcome", itemLocalId: "h1" } }],
    next: [],
  },
});
const item: TimelineItem = {
  localId: "h1", boardKey: "calendaring", boardName: "Calendaring", name: "[9/30/26] MASTER: Ana RIVERA", status: "Added on Cal", group: null,
  mondayBoardId: "9287895872", mondayItemId: "555",
  fields: [
    {
      key: "status", columnId: "color_1", title: "Calendaring Status", type: "status", value: "Added on Cal", primary: true,
      options: [{ index: 0, label: "Added on Cal", color: "#007eb5", border: "#007eb5" }, { index: 1, label: "ATTENDED", color: "#00c875", border: "#00c875" }, { index: 2, label: "RECHED/ CONT/ AC/ WD/ - NOT HAPPENING", color: "#bb3354", border: "#bb3354" }],
    },
    { key: "hearing_date_calendaring", columnId: "date_9", title: "Hearing Date", type: "date", value: "2026-09-30", primary: true, options: [] },
    { key: "judge", columnId: "text_3", title: "Judge", type: "text", value: "", primary: false, options: [] },
  ],
};

const api = vi.hoisted(() => ({
  changeBoardItemColumn: vi.fn(() => Promise.resolve({ localId: "h1", columnId: "color_1", value: "ATTENDED", pending: false })),
  postProfileUpdate: vi.fn(() => Promise.resolve({})),
  postTimelineReply: vi.fn(() => Promise.resolve({})),
}));
vi.mock("../api", () => ({
  fetchCaseTimeline: () => {
    fetches++;
    return Promise.resolve(timeline());
  },
  fetchTimelineItem: () => Promise.resolve(item),
  ...api,
}));
// The chart measures itself; jsdom has no layout.
globalThis.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} } as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView = () => {};

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function mount() {
  const { CaseTimelineTab } = await import("./CaseTimelineTab");
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => createRoot(el).render(<CaseTimelineTab profileLocalId="p1" />));
  await act(async () => {});
  return el;
}
const button = (text: string) => Array.from(document.querySelectorAll("button")).find((b) => b.textContent === text);
const settle = () => act(async () => {});

describe("CaseTimelineTab → M29 event panel", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    fetches = 0;
    vi.clearAllMocks();
  });

  it("Record outcome opens the hearing's item; an outcome is written and the timeline reloads on close", async () => {
    await mount();
    await act(async () => button("Record outcome")!.click());
    await settle();
    expect(document.body.textContent).toContain("Nobody recorded what happened at this hearing");
    // Only outcome statuses are offered as one-click answers.
    expect(button("ATTENDED")).toBeTruthy();
    expect(button("RECHED/ CONT/ AC/ WD/ - NOT HAPPENING")).toBeTruthy();
    expect(button("Added on Cal")).toBeUndefined();
    // The fields the timeline reads are shown; the rest wait behind a toggle.
    expect(document.body.textContent).toContain("Hearing Date");
    expect(document.body.textContent).not.toContain("Judge");
    expect(button("Other fields (1)")).toBeTruthy();

    await act(async () => button("ATTENDED")!.click());
    await settle();
    expect(api.changeBoardItemColumn).toHaveBeenCalledWith("h1", "color_1", "ATTENDED");

    expect(fetches).toBe(1);
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await settle();
    expect(fetches).toBe(2);
  });

  it("a story row opens its event; an E&A entry gets a reply, not a profile note", async () => {
    await mount();
    const row = Array.from(document.querySelectorAll<HTMLElement>("[data-tl-row]")).find((r) => r.textContent?.includes("Hearing notes"))!;
    await act(async () => row.click());
    await settle();
    expect(document.body.textContent).toContain("Reply to this entry");
    const box = document.querySelector<HTMLTextAreaElement>("#tl-note")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(box, "IJ set the individual for March");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button("Post note")!.click());
    await settle();
    expect(api.postTimelineReply).toHaveBeenCalledWith("u7", "IJ set the individual for March");
    expect(api.postProfileUpdate).not.toHaveBeenCalled();
  });
});
