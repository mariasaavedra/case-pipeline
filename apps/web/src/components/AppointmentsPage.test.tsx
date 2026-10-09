// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { MyDayEntry, MyDayResult } from "../api";

const profile = (localId: string, name: string) =>
  ({ localId, name, mondayItemId: null, email: null, phone: null, priority: null, groupTitle: null, address: null,
     dateOfBirth: null, placeOfBirth: null, aNumber: null, eFile: null, consultFile: null }) as unknown as MyDayEntry["profile"];

function entry(o: Partial<MyDayEntry> & { localId: string; time: string }): MyDayEntry {
  return {
    mondayItemId: null, boardKey: "appointments_r", name: o.localId, status: null, date: "2026-10-07",
    language: null, phone: null, clientWrote: null, description: null, detainedAt: null, sameDayCount: 0,
    prep: null, profile: profile(`p-${o.localId}`, `Client ${o.localId}`), updates: [], caseSummary: null, ...o,
  };
}

const result: MyDayResult = {
  date: "2026-10-07",
  today: "2026-10-07",
  boardKey: "appointments_r",
  myBoard: "appointments_r",
  boards: [
    { boardKey: "appointments_r", displayName: "R", attorneyName: "Rekha Sharma-Crawford" },
    { boardKey: "appointments_m", displayName: "M", attorneyName: "Michael Sharma-Crawford" },
  ],
  entries: [
    entry({ localId: "early", time: "09:00", status: "Hire" }),
    entry({ localId: "missed", time: "10:00", status: "Today's consult (follow up)" }),
    entry({
      localId: "ana", time: "11:30", clientWrote: "Me llegó una carta de la corte.",
      prep: {
        at: "2026-10-06 21:12:00", author: "Karla", pending: false, apptType: "1st time", method: "Zoom",
        methodDetail: "https://zoom.us/j/1", interpreter: "Spanish — office", interpreterNeeded: true,
        description: "NTA received last week.", documents: [{ name: "Notice to Appear.pdf", url: "https://sp/nta.pdf" }],
      },
    }),
    entry({ localId: "walkin", time: "15:00", profile: null }),
    entry({ localId: "jail", time: "16:00", detainedAt: "Chase Co. (KS)" }),
  ],
};

// Like the server: the asked-for board, else the caller's own.
const fetchMyDay = vi.fn((board?: unknown) =>
  Promise.resolve(board === "appointments_m" ? { ...result, boardKey: "appointments_m", entries: [] } : result));
const changeBoardItemStatus = vi.fn((localId: string, status: string) => Promise.resolve({ localId, status, pending: false }));
const postConsultNote = vi.fn((..._args: unknown[]) => Promise.resolve({ posted: true as const, pending: false, summary: "started" as const }));

vi.mock("../api", () => ({
  fetchMyDay: (board?: unknown) => fetchMyDay(board),
  changeBoardItemStatus: (l: string, s: string) => changeBoardItemStatus(l, s),
  postConsultNote: (...a: unknown[]) => postConsultNote(...a),
}));
vi.mock("../auth/useAuth", () => ({ useAuth: () => ({ user: { name: "Rekha Sharma-Crawford" } }) }));
vi.mock("../StatusOptionsProvider", () => ({
  useBoardStatusOptions: () => ({
    boardKey: "appointments_r", mondayBoardId: "1", statusColumnId: "status",
    options: ["Hire", "No Hire", "Det Hire", "Det No Hire", "Follow Up", "Cancelled/No show", "No Hire for Now",
      "No Action Needed", "Send G-Review Link", "Upcoming", "Close File"].map((label) => ({ label })),
  }),
}));
vi.mock("./UpdatesTimeline", () => ({ UpdatesTimeline: () => <div>timeline</div> }));
vi.mock("./DocumentsTab", () => ({ DocumentsTab: () => <div>sharepoint browser</div> }));
const resolveFileLink = vi.fn();
vi.mock("../sharepoint/graph", () => ({ resolveFileLink: (url: string) => resolveFileLink(url) }));
vi.mock("./FilePreviewModal", () => ({ FilePreviewModal: ({ item }: { item: { name: string } }) => <div>M12 {item.name}</div> }));
vi.mock("./NewContractModal", () => ({
  NewContractModal: ({ clientName, onCreated }: { clientName: string; onCreated: (c: { name: string; pending: boolean }) => void }) => (
    <div>
      M11 for {clientName}
      <button type="button" onClick={() => onCreated({ name: "Fee K — Client ana", pending: false })}>create</button>
    </div>
  ),
}));
// D6 is tested on its own; here it only has to show what the page hands it.
vi.mock("./StatusEditor", () => ({
  StatusEditor: ({ status }: { status: string | null }) => <span data-status-picker="">status: {status ?? "none"}</span>,
}));
vi.mock("./ClientPeek", () => ({ ClientLink: ({ children }: { children: React.ReactNode }) => <a href="#c">{children}</a> }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let el: HTMLDivElement;
let root: Root;

async function render() {
  const { AppointmentsPage } = await import("./AppointmentsPage");
  el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root.render(<AppointmentsPage />); });
}

const button = (text: string) =>
  Array.from(el.querySelectorAll("button")).find((b) => b.textContent?.trim() === text) as HTMLButtonElement;
const docButton = (name: string) =>
  Array.from(el.querySelectorAll("button")).find((b) => b.textContent?.includes(name)) as HTMLButtonElement;
const click = async (b: Element) => { await act(async () => { (b as HTMLElement).click(); }); };

describe("AppointmentsPage (P4 My Day)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 7, 11, 5));
    vi.clearAllMocks();
    window.history.replaceState(null, "", "/appointments");
  });
  afterEach(() => {
    act(() => root.unmount());
    el.remove();
    vi.useRealTimers();
  });

  it("opens on the attorney's own day, on the next appointment, with reception's prep", async () => {
    await render();
    expect(el.textContent).toContain("Good morning, Rekha");
    expect(button("R (you)")).toBeTruthy();
    expect(el.textContent).toContain("1 still needs an outcome");
    expect(el.textContent).toContain("Needs outcome");
    // Ana (11:30) is next, so she is open.
    expect(el.querySelector("h1")?.textContent).toBe("Good morning, Rekha");
    expect(el.textContent).toContain("Prepped by Karla");
    expect(el.textContent).toContain("NTA received last week.");
    expect(el.textContent).toContain("“Me llegó una carta de la corte.”");
    expect(el.textContent).toContain("Interpreter: Spanish — office");
    expect(el.querySelector('a[href="https://zoom.us/j/1"]')?.textContent).toContain("Join Zoom");
  });

  it("changes the status at once from a quick outcome, and keeps the status picker in step", async () => {
    await render();
    expect(el.querySelector("[data-status-picker]")?.textContent).toBe("status: none");
    await click(button("Hire"));
    expect(changeBoardItemStatus).toHaveBeenCalledWith("ana", "Hire");
    expect(el.textContent).toContain("Status set to Hire.");
    expect(el.querySelector("[data-status-picker]")?.textContent).toBe("status: Hire");
    expect(button("Hire").getAttribute("aria-pressed")).toBe("true");
    // The row's tag follows.
    expect(Array.from(el.querySelectorAll("button")).find((b) => b.textContent?.includes("Client ana"))?.textContent).toContain("Hire");
  });

  const type = async (text: string) => {
    const note = el.querySelector("textarea")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(note, text);
      note.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  it("saves the consult note on its own, and says the post-consult summary is on its way", async () => {
    await render();
    await type("Hired for removal defense.");
    await click(button("Save consult note"));
    expect(postConsultNote).toHaveBeenCalledWith("ana", "Hired for removal defense.");
    expect(changeBoardItemStatus).not.toHaveBeenCalled();
    expect(el.textContent).toContain("Consult note logged on the profile");
    expect(el.textContent).toContain("The Consultation Summary is being written to the client's CONSULT folder");
    expect(el.querySelector("textarea")!.value).toBe("");
  });

  it("stays in step with reception: refreshes when the attorney comes back, keeping their place and draft", async () => {
    await render();
    await click(Array.from(el.querySelectorAll("button")).find((b) => b.textContent?.includes("Client missed"))!);
    await type("half-written");
    expect(fetchMyDay).toHaveBeenCalledTimes(1);
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(fetchMyDay).toHaveBeenCalledTimes(2);
    expect(el.querySelector('[aria-current="true"]')?.textContent).toContain("Client missed");
    expect(el.querySelector("textarea")!.value).toBe("half-written");
    expect(el.textContent).toContain("stays in step with Receptionists");
  });

  it("offers the attorneys' quick outcomes, in the board's own spelling", async () => {
    await render();
    expect(button("Send G-Review Link")).toBeTruthy();
    expect(button("No Action Needed")).toBeTruthy();
    expect(button("Cancelled/No show")).toBeUndefined();
    expect(button("Follow Up")).toBeUndefined();
    expect(button("Hold for Docs")).toBeUndefined(); // this board lacks it
    expect(button("Det Hire")).toBeUndefined();
    expect(el.textContent).not.toContain("Detainee consult");
  });

  it("flags a detainee consult and records Det Hire / Det No Hire", async () => {
    await render();
    const row = Array.from(el.querySelectorAll("button")).find((b) => b.textContent?.includes("Client jail"))!;
    expect(row.textContent).toContain("Detained");
    await click(row);
    expect(el.textContent).toContain("Detainee consultHire and No Hire are recorded as Det Hire / Det No Hire.");
    // Where they're held is said once, in the client panel.
    expect(el.textContent?.split("Detained at Chase Co. (KS)").length).toBe(2);
    expect(button("Hire")).toBeUndefined();
    await click(button("Det Hire"));
    expect(changeBoardItemStatus).toHaveBeenCalledWith("jail", "Det Hire");
    expect(button("Det No Hire")).toBeTruthy();
  });

  it("lists only the documents reception picked, and nothing from the rest of the file", async () => {
    await render();
    const doc = docButton("Notice to Appear.pdf");
    expect(doc?.textContent).toContain("PDF");
    expect(el.textContent).not.toContain("In their file");
  });

  it("opens a picked document in M12 instead of a new tab", async () => {
    resolveFileLink.mockResolvedValue({ driveId: "d", item: { id: "i", name: "Notice to Appear.pdf", webUrl: "https://sp/nta.pdf" } });
    await render();
    await click(docButton("Notice to Appear.pdf"));
    expect(resolveFileLink).toHaveBeenCalledWith("https://sp/nta.pdf");
    expect(el.textContent).toContain("M12 Notice to Appear.pdf");
  });

  it("opens New contract (M11) for the client and shows it once created", async () => {
    await render();
    await click(button("+ New contract"));
    expect(el.textContent).toContain("M11 for Client ana");
    await click(button("create"));
    expect(el.textContent).toContain("Contract created: Fee K — Client ana");
  });

  it("shows notes and documents in their tabs", async () => {
    await render();
    await click(button("Notes (0)"));
    expect(el.textContent).toContain("No notes yet for this client.");
    await click(button("E-file / Consult file"));
    expect(el.textContent).toContain("sharepoint browser");
  });

  it("on a phone, shows the day, then the client as its own screen with a way back", async () => {
    // The page measures itself; pretend it is 380px wide.
    vi.stubGlobal("ResizeObserver", class {
      constructor(private cb: (e: Array<{ contentRect: { width: number } }>) => void) {}
      observe() { this.cb([{ contentRect: { width: 380 } }]); }
      disconnect() {}
    });
    try {
      await render();
      expect(el.textContent).toContain("Good morning, Rekha");
      expect(button("Save consult note")).toBeUndefined(); // the list only
      await click(Array.from(el.querySelectorAll("button")).find((b) => b.textContent?.includes("Client ana"))!);
      expect(button("Save consult note")).toBeTruthy();
      expect(el.textContent).not.toContain("Good morning"); // the client gets the screen
      await click(button("All appointments"));
      expect(button("Save consult note")).toBeUndefined();
      expect(el.textContent).toContain("Good morning, Rekha");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("on a tablet, the day becomes a column of times beside the client and the actions", async () => {
    vi.stubGlobal("ResizeObserver", class {
      constructor(private cb: (e: Array<{ contentRect: { width: number } }>) => void) {}
      observe() { this.cb([{ contentRect: { width: 900 } }]); }
      disconnect() {}
    });
    try {
      await render();
      const rail = el.querySelector('nav[aria-label="Appointments"]');
      expect(rail?.querySelector('[aria-current="true"]')?.getAttribute("aria-label")).toBe("11:30 AM Client ana");
      expect(button("Save consult note")).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("switches to another attorney's calendar", async () => {
    await render();
    expect(fetchMyDay).toHaveBeenCalledTimes(1);
    await click(button("M"));
    expect(fetchMyDay).toHaveBeenLastCalledWith("appointments_m");
    expect(fetchMyDay).toHaveBeenCalledTimes(2);
    expect(el.querySelector("h1")?.textContent).toBe("Michael Sharma-Crawford’s day");
    expect(el.textContent).toContain("No appointments today");
  });

  it("explains an appointment with no client profile", async () => {
    await render();
    await click(Array.from(el.querySelectorAll("button")).find((b) => b.textContent?.includes("walkin"))!);
    expect(el.textContent).toContain("Documents reception picks during prep show here.");
    expect(el.textContent).toContain("Link this appointment to a client profile first.");
    expect(button("+ New contract").disabled).toBe(true);
  });
});
