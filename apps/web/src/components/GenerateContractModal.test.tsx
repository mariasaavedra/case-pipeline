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
  tags: ["client_name"] as string[],
  fill: vi.fn(),
}));

vi.mock("../api", () => ({
  fetchContractPrefill: async () => ({
    clientName: "Ana Lopez", email: "ana@mail.com", address: "1 Main St, Kansas City, MO 64105",
    street: "1 Main St", cityStateZip: "Kansas City, MO 64105", attorneyName: "Jane Atty", attorneyEmail: "jane@firm.com",
    attorneys: [{ name: "Jane Atty", email: "jane@firm.com" }, { name: "Lucy Betteridge", email: "lucy@firm.com" }],
    contractFor: ["Court"], attorneyFee: 5000, filingFee: null, processingFee: null, hearingType: "Master Hearing", hearingDate: "2026-11-12",
  }),
  fetchEsignStatus: async () => ({ enabled: true }),
  fetchFeeKTypes: async () => ({
    feeKTypes: ["I-130 - Petition for Alien Relative", "Master (c)"], boards: [], draft: true,
    rows: [{ feeKType: "I-130 - Petition for Alien Relative", spanish: "Petición de familiar extranjero (I-130)", board: "", feeSheetJob: "",
      services: "Prepare and file Form I-130.", servicesEs: "Preparar el I-130.", excluded: "", excludedEs: "" }],
  }),
  logContractGenerated: mocks.log,
  sendContractForSignature: mocks.send,
}));
vi.mock("./ClientCaseModal", () => ({
  ClientCaseModal: ({ profileLocalId, behind, onClose }: { profileLocalId: string; behind: string; onClose: () => void }) => (
    <div data-testid="case-modal" data-profile={profileLocalId}>
      <button onClick={onClose}>{`Back to ${behind}`}</button>
    </div>
  ),
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
vi.mock("../lib/contract-fill", async (orig) => ({
  ...(await orig<typeof import("../lib/contract-fill")>()),
  inspectContractTemplate: () => ({ tags: mocks.tags, unknown: [], signTags: ["Sig_es_:signer2:signature"], errors: [] }),
  contractProblems: () => [],
  fillContractTemplate: mocks.fill,
  trialTotalOf: () => 0,
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
  mocks.tags = ["client_name"];
  mocks.fill.mockReset().mockReturnValue(new Blob(["filled"]));
  localStorage.clear();
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

  it("opens the client's notes / timeline / documents over the form and comes back to it", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    await act(async () => {
      createRoot(host).render(<GenerateContractModal contract={{ ...contract, clientLocalId: "p7" }} onClose={() => {}} />);
    });
    await flush();

    await act(async () => { button("Notes · Timeline · Documents")!.click(); });
    const modal = document.querySelector("[data-testid='case-modal']");
    expect(modal?.getAttribute("data-profile")).toBe("p7");
    expect(button("Preview PDF")).toBeDefined(); // the form stays underneath

    await act(async () => { button("Back to the contract")!.click(); });
    expect(document.querySelector("[data-testid='case-modal']")).toBeNull();
    expect(button("Preview PDF")?.disabled).toBe(false);
  });

  it("has no case button when the Fee K has no linked profile", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    await act(async () => { createRoot(host).render(<GenerateContractModal contract={contract} onClose={() => {}} />); });
    await flush();
    expect(button("Notes · Timeline · Documents")).toBeUndefined();
  });

  it("keeps the draft when closed, resumes it, and Start over goes back to Monday's pre-fill", async () => {
    localStorage.clear();
    const draftContract = { ...contract, localId: "c-draft" } as PendingContract;
    const open = async () => {
      document.body.innerHTML = "";
      const host = document.createElement("div");
      document.body.appendChild(host);
      const root = createRoot(host);
      await act(async () => { root.render(<GenerateContractModal contract={draftContract} onClose={() => {}} />); });
      await flush();
      return root;
    };
    const nameField = () => document.getElementById("m22-clientName") as HTMLInputElement;
    const typeInto = (el: HTMLInputElement, v: string) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };

    // Opening and closing without a change leaves nothing.
    let root = await open();
    expect(document.body.textContent).not.toContain("Picked up where you left off");
    await act(async () => { root.unmount(); });
    expect(localStorage.getItem("m22-draft:c-draft")).toBeNull();

    root = await open();
    await act(async () => { typeInto(nameField(), "Ana María Lopez"); });
    await act(async () => { root.unmount(); });

    root = await open();
    expect(nameField().value).toBe("Ana María Lopez");
    expect(document.body.textContent).toContain("Picked up where you left off");

    await act(async () => { button("Start over")!.click(); });
    await flush();
    expect(nameField().value).toBe("Ana Lopez");
    expect(document.body.textContent).not.toContain("Picked up where you left off");
    expect(localStorage.getItem("m22-draft:c-draft")).toBeNull();
    await act(async () => { root.unmount(); });
  });

  it("sending clears the draft", async () => {
    localStorage.clear();
    const host = document.createElement("div");
    document.body.appendChild(host);
    await act(async () => { createRoot(host).render(<GenerateContractModal contract={contract} onClose={() => {}} />); });
    await flush();
    const field = document.getElementById("m22-clientName") as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "Ana L.");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(localStorage.getItem("m22-draft:c1")).not.toBeNull();
    await act(async () => { button("Preview PDF")!.click(); });
    await flush();
    await act(async () => { button("Send for signature")!.click(); });
    await flush();
    expect(localStorage.getItem("m22-draft:c1")).toBeNull();
  });
});

describe("M22 people on one contract", () => {
  const typeInto = (el: HTMLInputElement, v: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const byLabel = (label: string) => document.querySelector(`input[aria-label='${label}']`) as HTMLInputElement;
  const checkbox = () => Array.from(document.querySelectorAll("label")).find((l) => l.textContent?.includes("more than one person"))?.querySelector("input") as HTMLInputElement | undefined;
  const open = async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    await act(async () => { createRoot(host).render(<GenerateContractModal contract={contract} onClose={() => {}} />); });
    await flush();
  };

  it("no checkbox unless the template lists people", async () => {
    await open();
    expect(checkbox()).toBeUndefined();
  });

  it("the list shows only once ticked, and doesn't assume the signer is on it", async () => {
    mocks.tags = ["client_name", "has_people", "people", "person_name", "person_a_number"];
    await open();
    expect(checkbox()!.checked).toBe(false);
    expect(button("+ Add person")).toBeUndefined();

    await act(async () => { checkbox()!.click(); });
    // Two empty rows; the signer (Ana Lopez) isn't one of them.
    expect(byLabel("Person 1 name").value).toBe("");
    expect(byLabel("Person 2 name").value).toBe("");
    await act(async () => { typeInto(byLabel("Person 1 name"), "Pedro Lopez"); });
    await act(async () => { typeInto(byLabel("Person 1 A#"), "111"); });
    await act(async () => { button("+ Add person")!.click(); });
    await act(async () => { typeInto(byLabel("Person 2 name"), "Wrong Person"); });
    await act(async () => { typeInto(byLabel("Person 3 name"), "Juan Lopez"); });
    await act(async () => { (document.querySelector("button[aria-label='Remove person 2']") as HTMLButtonElement).click(); });
    expect(byLabel("Person 2 name").value).toBe("Juan Lopez");
    // The signer can be added on purpose.
    await act(async () => { button("+ Add Ana Lopez (signer)")!.click(); });
    expect(byLabel("Person 3 name").value).toBe("Ana Lopez");
    expect(button("+ Add Ana Lopez (signer)")).toBeUndefined();

    await act(async () => { button("Preview PDF")!.click(); });
    await flush();
    const input = mocks.fill.mock.calls[0]![1];
    expect(input.multiplePeople).toBe(true);
    expect(input.people).toEqual([
      { name: "Pedro Lopez", aNumber: "111", dob: "" },
      { name: "Juan Lopez", aNumber: "", dob: "" },
      { name: "Ana Lopez", aNumber: "", dob: "" },
    ]);
  });
});

describe("M22 case type and hearing type are picked, not typed", () => {
  const select = (id: string) => document.getElementById(id) as HTMLSelectElement;
  const choose = (el: HTMLSelectElement, v: string) => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, v);
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };

  it("picking a Fee K Type sets the English + Spanish title and the scope; hearing type is a list", async () => {
    mocks.tags = ["client_name", "form_name", "form_name_es", "services", "hearing_type"];
    const host = document.createElement("div");
    document.body.appendChild(host);
    await act(async () => { createRoot(host).render(<GenerateContractModal contract={contract} onClose={() => {}} />); });
    await flush();

    // The Fee K's own type ("Court") comes pre-picked; drop it, pick I-130.
    await act(async () => { (document.querySelector("button[aria-label='Remove Court']") as HTMLButtonElement).click(); });
    await act(async () => { choose(select("m22-feeKType"), "I-130 - Petition for Alien Relative"); });
    expect(document.body.textContent).toContain("Prints: I-130 - Petition for Alien Relative / Petición de familiar extranjero (I-130)");
    expect(Array.from(select("m22-hearingType").options).map((o) => o.value)).toEqual(["", "Master Hearing", "Individual Hearing"]);
    await act(async () => { choose(select("m22-hearingType"), "Individual Hearing"); });

    await act(async () => { button("Preview PDF")!.click(); });
    await flush();
    expect(mocks.fill.mock.calls[0]![1]).toMatchObject({
      feeKTypes: ["I-130 - Petition for Alien Relative"],
      formName: "I-130 - Petition for Alien Relative", formNameEs: "Petición de familiar extranjero (I-130)",
      services: "Prepare and file Form I-130.", hearingType: "Individual Hearing",
    });
  });
});

describe("M22 attorney is picked, and brings their e-mail", () => {
  it("picking the attorney who signs the letter sets the Adobe signer's e-mail, and the other way round", async () => {
    mocks.tags = ["client_name", "attorney_name"];
    const host = document.createElement("div");
    document.body.appendChild(host);
    await act(async () => { createRoot(host).render(<GenerateContractModal contract={contract} onClose={() => {}} />); });
    await flush();
    const name = document.getElementById("m22-attorneyName") as HTMLSelectElement;
    const email = document.getElementById("m22-atty-email") as HTMLSelectElement;
    const choose = (el: HTMLSelectElement, v: string) => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, v);
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    expect(name.value).toBe("Jane Atty");
    expect(email.value).toBe("jane@firm.com");
    await act(async () => { choose(name, "Lucy Betteridge"); });
    expect(email.value).toBe("lucy@firm.com");
    await act(async () => { choose(email, "jane@firm.com"); });
    expect(name.value).toBe("Jane Atty");
  });
});
