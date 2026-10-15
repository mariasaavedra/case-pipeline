// @vitest-environment jsdom
// =============================================================================
// M22 preview — the PDF on screen is the PDF that is sent
// =============================================================================
// Graph, the API and the template engine are mocked; what's under test is the
// flow: Preview makes the PDF once and shows it, Send lives only in the preview
// and sends that same file, Back drops it.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { PendingContract } from "../api";

const pdf = new Blob(["%PDF-1.4 preview"], { type: "application/pdf" });
const mocks = vi.hoisted(() => ({
  convert: vi.fn(),
  send: vi.fn(),
  log: vi.fn(),
}));

vi.mock("../api", () => ({
  fetchContractPrefill: async () => ({
    clientName: "Ana Lopez", email: "ana@mail.com", address: "1 Main St, Kansas City, MO 64105",
    street: "1 Main St", cityStateZip: "Kansas City, MO 64105", attorneyName: "Jane Atty", attorneyEmail: "jane@firm.com",
    contractFor: ["Court"], attorneyFee: 5000, filingFee: null, processingFee: null, hearingType: "Master Hearing", hearingDate: "2026-11-12",
  }),
  fetchEsignStatus: async () => ({ enabled: true }),
  logContractGenerated: mocks.log,
  sendContractForSignature: mocks.send,
}));
vi.mock("../auth/useAuth", () => ({ useAuth: () => ({ user: { name: "Rafael Cruz" } }) }));
vi.mock("../sharepoint/graph", () => ({
  CONTRACT_TEMPLATES_FOLDER: "https://example.test/folder",
  GraphConsentRequiredError: class extends Error {},
  getGraphToken: async () => "t",
  listContractTemplates: async () => ({ driveId: "d", items: [{ id: "t1", name: "COURT Fee K.docx", webUrl: "https://example.test/t1" }] }),
  downloadDriveFile: async () => new Blob(["docx"]),
  convertDocxToPdf: mocks.convert,
}));
vi.mock("../lib/contract-fill", () => ({
  inspectContractTemplate: () => ({ tags: ["client_name"], unknown: [], signTags: ["Sig_es_:signer2:signature"], errors: [] }),
  contractProblems: () => [],
  fillContractTemplate: () => new Blob(["filled"]),
  surchargeOf: () => 150,
  totalOf: () => 5150,
  money: (n: number) => `$${n}`,
  halfOf: (n: number) => n / 2,
  contractDocumentName: () => "Ana Lopez - Court - 10-15-2026",
}));

const { GenerateContractModal } = await import("./GenerateContractModal");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const contract = { localId: "c1", clientName: "Ana Lopez", contractFor: ["Court"] } as unknown as PendingContract;
const buttons = () => Array.from(document.querySelectorAll("button"));
const button = (label: string) => buttons().find((b) => b.textContent?.trim() === label);
const flush = async () => { for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); }); };

beforeEach(() => {
  document.body.innerHTML = "";
  mocks.convert.mockReset().mockResolvedValue(pdf);
  mocks.send.mockReset().mockResolvedValue({ id: 1, stage: "Atty Reviewing", warning: null });
  mocks.log.mockReset();
  URL.createObjectURL = vi.fn(() => "blob:preview-1");
  URL.revokeObjectURL = vi.fn();
});

describe("M22 preview", () => {
  it("previews, then sends the same PDF; Send only exists in the preview", async () => {
    const onSent = vi.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);
    await act(async () => { createRoot(host).render(<GenerateContractModal contract={contract} onClose={() => {}} onSent={onSent} />); });
    await flush();

    // The only template is picked by itself; the form has Preview, not Send.
    expect(button("Preview PDF")?.disabled).toBe(false);
    expect(button("Send for signature")).toBeUndefined();

    await act(async () => { button("Preview PDF")!.click(); });
    await flush();
    expect(mocks.convert).toHaveBeenCalledTimes(1);
    const frame = document.querySelector("iframe[title='Contract preview']");
    expect(frame?.getAttribute("src")).toBe("blob:preview-1#view=FitH");
    expect(document.body.textContent).toContain("jane@firm.com");
    expect(document.body.textContent).toContain("ana@mail.com");

    await act(async () => { button("Send for signature")!.click(); });
    await flush();
    expect(mocks.convert).toHaveBeenCalledTimes(1); // not made again
    // The standard name goes with it: Adobe's document and the signed copy carry it.
    expect(mocks.send).toHaveBeenCalledWith("c1", pdf, { attorneyEmail: "jane@firm.com", clientEmail: "ana@mail.com", documentName: "Ana Lopez - Court - 10-15-2026" });
    expect(onSent).toHaveBeenCalled();
  });

  it("Back to edit drops the preview", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    await act(async () => { createRoot(host).render(<GenerateContractModal contract={contract} onClose={() => {}} />); });
    await flush();
    await act(async () => { button("Preview PDF")!.click(); });
    await flush();

    await act(async () => { button("← Back to edit")!.click(); });
    await flush();
    expect(document.querySelector("iframe")).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview-1");
    expect(button("Preview PDF")).toBeDefined();
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
