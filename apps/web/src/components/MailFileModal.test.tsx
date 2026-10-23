// @vitest-environment jsdom
// =============================================================================
// M32 — filing one letter
// =============================================================================
// SharePoint, Outlook and the API are stubbed. Under test: what is pre-filled
// from the reading, the order of the steps (E-File → CC, then the e-mail with
// the letter, then the API), that a failed step resumes without repeating the
// ones before it, and that a client with no E-File can't be filed.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { MailScanDocument, NoticeFields } from "../api";

const mocks = vi.hoisted(() => ({
  steps: [] as string[],
  failFile: false,
  eFile: "https://sharmacrawford.sharepoint.com/sites/scalefiles/Shared Documents/L/LOPEZ, Juan" as string | null,
  filedBody: null as null | Record<string, unknown>,
  mail: null as null | { to: string; attachments?: { name: string }[] },
}));

vi.mock("../api", async (orig) => ({
  ...(await orig<typeof import("../api")>()),
  fetchMailClient: async (id: string) => ({
    localId: id, name: "Juan Lopez", email: "juan@example.com", eFile: mocks.eFile,
    openForms: [{ localId: "f1", mondayItemId: "9", name: "Juan I-130", status: "Sent Out", formType: "I130", receiptNo: null, receivedDate: null, profileLocalId: id, profileName: "Juan Lopez" }],
  }),
  fetchMailWriteBackPlan: async () => ({ openFormLocalId: "f1", mondayItemId: "9", steps: [], skipped: [], blockers: [] }),
  searchClients: async () => [],
  fileMailDocument: async (_id: number, body: Record<string, unknown>) => {
    mocks.steps.push("file");
    if (mocks.failFile) throw new Error("Server down");
    mocks.filedBody = body;
    return { writebackState: "done", note: "posted" };
  },
}));
vi.mock("../auth/useAuth", () => ({ useAuth: () => ({ user: { name: "Rosa" } }) }));
vi.mock("./ClientPeek", () => ({ ClientLink: ({ children }: { children: unknown }) => children }));
vi.mock("../sharepoint/graph", () => {
  class GraphConsentRequiredError extends Error {}
  return {
    GraphConsentRequiredError,
    getGraphToken: async () => "t",
    getMailToken: async () => "t",
    findCcFolder: async () => {
      mocks.steps.push("cc");
      return { driveId: "d", itemId: "cc", name: "CC's", webUrl: "u", isFolder: true, created: false, eFileName: "LOPEZ, Juan" };
    },
    uploadFile: async (_d: string, _p: string, file: File) => {
      mocks.steps.push(`upload:${file.name}`);
      return { id: "x", name: file.name, webUrl: "https://sharmacrawford.sharepoint.com/x.pdf" };
    },
    sendMailAsMe: async (msg: { to: string; attachments?: { name: string }[] }) => {
      mocks.steps.push("mail");
      mocks.mail = msg;
    },
  };
});

const { MailFileModal } = await import("./MailFileModal");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
URL.createObjectURL = () => "blob:x";
URL.revokeObjectURL = () => {};

const fields: NoticeFields = {
  receiptNumbers: ["IOE0911111111"], aNumbers: ["123456789"], formType: "I130", caseType: "I130 - PETITION",
  noticeType: "Receipt Notice", noticeDate: "2026-10-20", receivedDate: null, priorityDate: null,
  petitioner: null, beneficiary: "LOPEZ, JUAN", applicant: null, dateOfBirth: null, section: null, names: [], people: [],
};
const doc = {
  id: 5, pages: [1, 2], splitReason: "first_page", uncertainPages: [], ocrPages: [], ocrConfidence: null, fields, needsReview: false,
  match: {
    status: "matched", reason: null, message: "Matched Juan Lopez's I-130.", proposedAction: "fill_receipt",
    profile: { localId: "p1", name: "Juan Lopez", aNumber: "123456789" },
    openForm: { localId: "f1", mondayItemId: "9", name: "Juan I-130", status: "Sent Out", formType: "I130", receiptNo: null, receivedDate: null, profileLocalId: "p1", profileName: "Juan Lopez" },
    candidateForms: [], candidateProfiles: [],
  },
} as unknown as MailScanDocument & { id: number };

const button = (re: RegExp) => Array.from(document.querySelectorAll("button")).find((b) => re.test(b.textContent ?? ""));
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };

async function open() {
  const filed: unknown[] = [];
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => {
    root.render(<MailFileModal doc={doc} pdf={new File(["%PDF-1.4"], "scan.pdf", { type: "application/pdf" })} onClose={() => {}} onFiled={(f) => filed.push(f)} />);
  });
  await flush();
  return filed;
}

beforeEach(() => {
  document.body.innerHTML = "";
  mocks.steps = [];
  mocks.failFile = false;
  mocks.filedBody = null;
  mocks.mail = null;
  mocks.eFile = "https://sharmacrawford.sharepoint.com/sites/scalefiles/Shared Documents/L/LOPEZ, Juan";
});

describe("M32", () => {
  it("pre-fills the client, the Open Form, the file name and the e-mail", async () => {
    await open();
    const radios = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    expect(radios.filter((r) => r.checked).map((r) => r.closest("label")?.textContent)).toEqual([
      expect.stringContaining("Juan Lopez"),
      expect.stringContaining("I130"),
    ]);
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("input:not([type])")).map((i) => i.value);
    expect(inputs).toContain("2026-10-20 Receipt Notice I130.pdf");
    expect(document.querySelector<HTMLInputElement>('input[type="email"]')?.value).toBe("juan@example.com");
  });

  it("saves to CC, e-mails with the letter, then files — in that order", async () => {
    const filed = await open();
    await act(async () => button(/File it & e-mail/)!.click());
    await flush();
    expect(mocks.steps).toEqual(["cc", "upload:2026-10-20 Receipt Notice I130.pdf", "mail", "file"]);
    expect(mocks.mail).toMatchObject({ to: "juan@example.com", attachments: [{ name: "2026-10-20 Receipt Notice I130.pdf" }] });
    expect(mocks.filedBody).toMatchObject({
      profileLocalId: "p1", openFormLocalId: "f1", emailedTo: "juan@example.com",
      savedTo: { folder: "E-File LOPEZ, Juan → CC's" },
    });
    expect(filed).toHaveLength(1);
  });

  it("a failed last step resumes without saving or e-mailing again", async () => {
    mocks.failFile = true;
    const filed = await open();
    await act(async () => button(/File it/)!.click());
    await flush();
    expect(document.body.textContent).toContain("Server down");
    mocks.failFile = false;
    await act(async () => button(/Continue filing/)!.click());
    await flush();
    expect(mocks.steps.filter((s) => s !== "file")).toEqual(["cc", "upload:2026-10-20 Receipt Notice I130.pdf", "mail"]);
    expect(filed).toHaveLength(1);
  });

  it("no E-File: says how to get one, and can't be filed", async () => {
    mocks.eFile = null;
    await open();
    expect(document.body.textContent).toContain("has no E-File link yet");
    expect(button(/File it/)!.disabled).toBe(true);
  });
});
