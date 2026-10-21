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
import type { SmsConfig, UploadLinkInfo } from "../api";

const URL_ = "https://app.example.com/u/" + "x".repeat(43);
const mocks = vi.hoisted(() => ({
  links: [] as UploadLinkInfo[],
  create: vi.fn(),
  extend: vi.fn(),
  revoke: vi.fn(),
}));

vi.mock("../api", () => ({
  fetchUploadLinks: async () => ({ enabled: true, links: mocks.links }),
  createUploadLink: mocks.create,
  extendUploadLink: mocks.extend,
  revokeUploadLink: mocks.revoke,
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
    expect(rows[1]).toContain("Filed in E-File → CAF");
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
    expect(uploadStatus({ filed_at: "x", filed_where: "Consult File", last_error: null })).toEqual({ text: "Filed in Consult File → CAF", tone: "ok" });
    expect(uploadStatus({ filed_at: null, filed_where: null, last_error: "waiting: no E-File or Consult File link on the profile" }).text).toBe("Waiting: no E-File on the profile");
    expect(uploadStatus({ filed_at: null, filed_where: null, last_error: "Graph 500" })).toEqual({ text: "Not filed yet: Graph 500", tone: "bad" });
    expect(uploadStatus({ filed_at: null, filed_where: null, last_error: null }).tone).toBe("wait");
  });
});
