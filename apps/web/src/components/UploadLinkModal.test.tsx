// @vitest-environment jsdom
// =============================================================================
// M30 — make a client upload link, copy it, text it; Received from client
// =============================================================================
// The API is mocked. Under test: the link is shown once after Make link, a
// second link asks first, Extend / Turn off call the API, "Text it" opens M28
// on the Upload link template with the link filled in, and the Documents list
// says where each file stands.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { ClientBuzon, ConsultList, SmsConfig, UploadChecklist, UploadLinkInfo } from "../api";

const URL_ = "https://app.example.com/u/" + "x".repeat(43);
const mocks = vi.hoisted(() => ({
  links: [] as UploadLinkInfo[],
  create: vi.fn(),
  extend: vi.fn(),
  revoke: vi.fn(),
  checklist: { items: [], feeKs: [] } as UploadChecklist,
  addFeeK: vi.fn(),
  addCaseType: vi.fn(),
  addConsult: vi.fn(),
  consultLists: [] as ConsultList[],
  updateItem: vi.fn(),
  buzon: null as unknown as ClientBuzon,
  updateBuzon: vi.fn(),
  remind: vi.fn(),
}));

vi.mock("../api", () => ({
  fetchUploadLinks: async () => ({ enabled: true, links: mocks.links }),
  createUploadLink: mocks.create,
  extendUploadLink: mocks.extend,
  revokeUploadLink: mocks.revoke,
  fetchUploadChecklist: async () => mocks.checklist,
  addFeeKChecklist: mocks.addFeeK,
  addChecklistItem: vi.fn(),
  updateChecklistItem: mocks.updateItem,
  removeChecklistItem: vi.fn(),
  addConsultChecklist: mocks.addConsult,
  addCaseTypeChecklist: mocks.addCaseType,
  fetchConsultLists: async () => ({ lists: mocks.consultLists, draft: true }),
  fetchClientBuzon: async () => mocks.buzon,
  updateClientBuzon: mocks.updateBuzon,
  remindNow: mocks.remind,
  fetchSmsConfig: async (): Promise<SmsConfig> => ({
    mode: "dry-run",
    fromNumber: "(816) 994-2300",
    firm: { firmName: "Sharma-Crawford", firmPhone: "(816) 994-2300" },
    templates: [
      { key: "consult_link", label: "Consultation link", en: "Book: {{link}}", es: "Agende: {{link}}" },
      { key: "upload_link", label: "Upload link", en: "Hi {{firstName}}, send us documents: {{uploadLink}}", es: "Hola {{firstName}}, envíenos documentos: {{uploadLink}}" },
    ],
  }),
  sendSms: vi.fn(),
}));

const { UploadLinkModal } = await import("./UploadLinkModal");
const { ClientUploadsList, uploadStatus } = await import("./ClientUploadsList");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const button = (label: string) => Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === label);
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };
const click = async (el: Element | undefined) => {
  expect(el).toBeTruthy();
  await act(async () => { (el as HTMLElement).click(); });
  await flush();
};

const activeLink = (over: Partial<UploadLinkInfo> = {}): UploadLinkInfo => ({
  id: 7, language: "es", active: true, createdAt: "2026-10-20 15:00:00", createdBy: "Ana Reyes",
  expiresAt: "2026-11-19 15:00:00", revokedAt: null, revokedBy: null, lastUsedAt: null, uploads: [], ...over,
});

async function open(props: Partial<Parameters<typeof UploadLinkModal>[0]> = {}) {
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => {
    root.render(
      <UploadLinkModal profileLocalId="p1" name="Itzel MARTINEZ" firstName="Itzel" phone="816-555-1234"
        language="Espanol" onClose={() => {}} {...props} />,
    );
  });
  await flush();
}

beforeEach(() => {
  document.body.innerHTML = "";
  mocks.links = [];
  mocks.checklist = { items: [], feeKs: [] };
  mocks.addFeeK.mockReset();
  mocks.addCaseType.mockReset();
  mocks.addConsult.mockReset();
  mocks.consultLists = [];
  mocks.updateItem.mockReset();
  mocks.buzon = {
    client: { name: "Itzel MARTINEZ", hasPhone: true, language: "es" },
    settings: { noAutoTexts: false, reminders: null, days: null },
    firmReminders: { on: true, days: [3, 7, 14], fromHour: 9, toHour: 18, weekdaysOnly: true },
    reminderDays: [3, 7, 14], nextReminder: null, canRemind: true, missing: [], texts: [],
  };
  mocks.updateBuzon.mockReset().mockImplementation(async (_p: string, s: ClientBuzon["settings"]) => ({ ...mocks.buzon, settings: s }));
  mocks.remind.mockReset();
  mocks.create.mockReset().mockResolvedValue({ id: 8, url: URL_, expiresAt: "2026-11-20 15:00:00", replaced: false });
  mocks.extend.mockReset().mockResolvedValue({ id: 7, expiresAt: "2026-12-01 00:00:00" });
  mocks.revoke.mockReset().mockResolvedValue({ id: 7, revoked: true });
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

describe("UploadLinkModal", () => {
  it("makes a Spanish link for a Spanish-speaking client and shows it once", async () => {
    await open();
    expect(document.body.textContent).toContain("No active link for this client.");
    await click(button("Make link"));
    expect(mocks.create).toHaveBeenCalledWith("p1", { language: "es" });
    expect((document.querySelector('input[aria-label="Upload link"]') as HTMLInputElement).value).toBe(URL_);
    expect(document.body.textContent).toContain("This is the only time the link is shown");
  });

  it("English page when the profile says English", async () => {
    await open({ language: "English" });
    await click(button("Make link"));
    expect(mocks.create).toHaveBeenCalledWith("p1", { language: "en" });
  });

  it("a second link asks first; No = nothing made", async () => {
    mocks.links = [activeLink({ uploads: [{ id: 1 } as UploadLinkInfo["uploads"][number]] })];
    await open();
    expect(document.body.textContent).toContain("Active link");
    expect(document.body.textContent).toContain("1 file received");
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    await click(button("Make a new link"));
    expect(mocks.create).not.toHaveBeenCalled();
    await click(button("Make a new link"));
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it("Extend and Turn off call the API for the active link", async () => {
    mocks.links = [activeLink()];
    await open();
    await click(button("Extend 30 days"));
    expect(mocks.extend).toHaveBeenCalledWith(7, 30);
    await click(button("Turn off"));
    expect(mocks.revoke).toHaveBeenCalledWith(7);
  });

  it("Text it opens the text popup on the Upload link template with the link filled in", async () => {
    await open();
    await click(button("Make link"));
    await click(button("Text it to the client"));
    const text = (document.querySelector("textarea") as HTMLTextAreaElement).value;
    expect(text).toBe(`Hola Itzel, envíenos documentos: ${URL_}`);
    expect(document.body.textContent).not.toContain("Fill in");
  });

  it("no phone on file: Text it is off", async () => {
    await open({ phone: null });
    await click(button("Make link"));
    expect(button("Text it to the client")?.hasAttribute("disabled")).toBe(true);
  });
});

describe("Buzón checklist in M30", () => {
  const item = (over: Partial<UploadChecklist["items"][number]> = {}): UploadChecklist["items"][number] => ({
    id: 1, labelEn: "Passport", labelEs: "Pasaporte", required: true, status: "missing", feeKLocalId: "k1",
    feeKType: "I-130", folder: "EVIDENCE I-130", receivedAt: null, files: 0, addedBy: "Ana Reyes", ...over,
  });

  const pick = async (label: string, value: string) => {
    const el = document.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement;
    expect(el).toBeTruthy();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, value);
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();
  };

  it("Ask for → Evidence → a case type: any type with a list, the client's own first; added ones can't be picked again", async () => {
    mocks.checklist = { items: [], feeKs: [], caseTypes: [
      { feeKType: "I-130", documents: 3, theirs: true, added: false },
      { feeKType: "N-400", documents: 5, theirs: false, added: false },
    ] };
    mocks.addCaseType.mockResolvedValue({ added: 1, items: [item()], feeKs: [], caseTypes: [{ feeKType: "I-130", documents: 3, theirs: true, added: true }] });
    await open();
    await pick("Ask for", "evidence");
    const options = Array.from(document.querySelectorAll('select[aria-label="Type of case"] option')).map((o) => o.textContent);
    expect(options).toEqual(["Type of case…", "I-130 · their case (3)", "N-400 (5)"]);
    await pick("Type of case", "N-400");
    await click(button("Add list"));
    expect(mocks.addCaseType).toHaveBeenCalledWith("p1", "N-400");
    expect(document.body.textContent).toContain("0 of 1 received");
    expect(document.querySelector('select[aria-label="Type of case"] option[value="I-130"]')?.hasAttribute("disabled")).toBe(true);
  });

  it("Ask for → Consult → the appointment and a consult list; Other needs no list", async () => {
    mocks.checklist = { items: [], feeKs: [], consults: [{ mondayId: "5001", name: "Consult", date: "2026-10-30", lists: [] }] };
    mocks.consultLists = [{ key: "family", name: "Consult – family petition", documents: [{ en: "ID", es: "ID", required: true }] }];
    mocks.addConsult.mockResolvedValue({ ...mocks.checklist, added: 1, items: [item({ appointmentMondayId: "5001", folder: "Consult File → CONSULT" })] });
    await open();
    await pick("Ask for", "consult");
    await pick("Consult list", "family");
    await click(button("Add list"));
    expect(mocks.addConsult).toHaveBeenCalledWith("p1", "family", "5001");
    await pick("Ask for", "other");
    expect(document.body.textContent).toContain("No list needed");
  });

  it("shows where each stands; Already have it / Ask again call the API", async () => {
    mocks.checklist = { feeKs: [], items: [
      item(),
      item({ id: 2, labelEn: "Marriage certificate", status: "received", receivedAt: "2026-10-23 15:00:00", files: 2 }),
    ] };
    mocks.updateItem.mockResolvedValue(mocks.checklist);
    await open();
    expect(document.body.textContent).toContain("1 of 2 received");
    expect(document.body.textContent).toContain("✓ Received Oct 23 · 2 files");
    expect(document.body.textContent).toContain("→ EVIDENCE I-130");
    await click(button("Already have it"));
    expect(mocks.updateItem).toHaveBeenCalledWith(1, { status: "not_needed" });
    await click(button("Ask again"));
    expect(mocks.updateItem).toHaveBeenCalledWith(2, { status: "missing" });
  });
});

describe("Received from client", () => {
  it("lists every link's files, newest first, linked once filed", async () => {
    mocks.links = [
      activeLink({ uploads: [
        { id: 3, received_at: "2026-10-21 15:00:00", stored_name: "2026-10-21 Notice - b.pdf", size: 1, content_type: "application/pdf", kind: "notice", note: "llegó el lunes", sharepoint_url: null, filed_where: null, filed_at: null, last_error: null },
      ] }),
      activeLink({ id: 6, active: false, uploads: [
        { id: 1, received_at: "2026-10-01 15:00:00", stored_name: "2026-10-01 ID - a.jpg", size: 1, content_type: "image/jpeg", kind: "id", note: null, sharepoint_url: "https://sp/a", filed_where: "E-File", filed_at: "2026-10-01 15:20:00", last_error: null },
      ] }),
    ];
    const root = createRoot(document.body.appendChild(document.createElement("div")));
    await act(async () => { root.render(<ClientUploadsList profileLocalId="p1" />); });
    await flush();
    const rows = Array.from(document.querySelectorAll("li")).map((li) => li.textContent);
    expect(rows[0]).toContain("2026-10-21 Notice - b.pdf");
    expect(rows[0]).toContain("“llegó el lunes”");
    expect(rows[1]).toContain("Filed in E-File");
    expect((document.querySelector("a") as HTMLAnchorElement).href).toBe("https://sp/a");
  });

  it("nothing received = nothing shown", async () => {
    mocks.links = [activeLink()];
    const root = createRoot(document.body.appendChild(document.createElement("div")));
    await act(async () => { root.render(<ClientUploadsList profileLocalId="p1" />); });
    await flush();
    expect(document.body.textContent).toBe("");
  });

  it("status words", () => {
    expect(uploadStatus({ filed_at: "x", filed_where: "Consult File", last_error: null })).toEqual({ text: "Filed in Consult File", tone: "ok" });
    expect(uploadStatus({ filed_at: null, filed_where: null, last_error: "waiting: no E-File or Consult File link on the profile" }).text).toBe("Waiting: no E-File on the profile");
    expect(uploadStatus({ filed_at: null, filed_where: null, last_error: "Graph 500" })).toEqual({ text: "Not filed yet: Graph 500", tone: "bad" });
    expect(uploadStatus({ filed_at: null, filed_where: null, last_error: null }).tone).toBe("wait");
  });
});

describe("Buzón texts in M30", () => {
  it("no automatic texts saves for this client; Remind now shows when something is missing and asks first", async () => {
    mocks.links = [activeLink()];
    mocks.buzon = { ...mocks.buzon, missing: ["Pasaporte"], texts: [{ kind: "link", sentAt: "2026-10-23 15:00:00", status: "sent", error: null, byName: null }] };
    mocks.remind.mockResolvedValue({ ...mocks.buzon, status: "sent" });
    await open();
    expect(document.body.textContent).toContain("Link (automatic) · sent");
    const box = Array.from(document.querySelectorAll("label")).find((l) => l.textContent?.includes("No automatic texts"))!.querySelector("input")!;
    await click(box);
    expect(mocks.updateBuzon).toHaveBeenCalledWith("p1", { noAutoTexts: true, reminders: null, days: null });
    expect(document.body.textContent).toContain("The app won't text the link, reminders");
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    await click(button("Remind now"));
    expect(mocks.remind).not.toHaveBeenCalled();
    await click(button("Remind now"));
    expect(mocks.remind).toHaveBeenCalledWith("p1");
    expect(document.body.textContent).toContain("Reminder sent.");
  });
});
