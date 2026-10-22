// @vitest-environment jsdom
// =============================================================================
// M28 — the text on screen is the text that is sent
// =============================================================================
// The API is mocked; under test: the template is filled (name, firm, link) in
// the call's language, Send stays off while a {{placeholder}} is unfilled, and
// what Send posts is exactly the text shown.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { SmsConfig } from "../api";

const mocks = vi.hoisted(() => ({ send: vi.fn(), create: vi.fn(), edit: vi.fn(), mode: "on" as "on" | "dry-run" | "off" }));

vi.mock("../api", () => ({
  fetchSmsConfig: async (): Promise<SmsConfig> => ({
    mode: mocks.mode,
    fromNumber: "(816) 994-2300",
    firm: { firmName: "Sharma-Crawford", firmPhone: "(816) 994-2300" },
    templates: [
      { key: "consult_link", label: "Consultation link", en: "Hi {{firstName}}, book here: {{link}} — {{firmName}}", es: "Hola {{firstName}}, agende aquí: {{link}} — {{firmName}}" },
      { key: "plain", label: "Plain", en: "Call us at {{firmPhone}}", es: "" },
    ],
  }),
  sendSms: mocks.send,
  createSmsTemplate: mocks.create,
  editSmsTemplate: mocks.edit,
}));

const { SendSmsModal } = await import("./SendSmsModal");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const button = (label: string) => Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === label);
const textarea = () => document.querySelector("textarea")!;
const flush = async () => { for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); }); };

/** React tracks input values; set through the native setter so onChange fires. */
async function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  await act(async () => { el.dispatchEvent(new Event("input", { bubbles: true })); });
}

async function open(props: Partial<Parameters<typeof SendSmsModal>[0]> = {}) {
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => {
    root.render(
      <SendSmsModal context="call_log" templateKey="consult_link" phone="816-555-1234" name="GARCIA LOPEZ, Maria"
        profileLocalId="p1" onClose={() => {}} {...props} />,
    );
  });
  await flush();
}

beforeEach(() => {
  document.body.innerHTML = "";
  mocks.mode = "on";
  mocks.create.mockReset();
  mocks.edit.mockReset();
  mocks.send.mockReset().mockResolvedValue({ mode: "on", status: "Queued", activity: "logged", segments: 1 });
});

describe("SendSmsModal", () => {
  it("fills the template, blocks Send until the link is in, and sends exactly what is shown", async () => {
    await open();
    expect(textarea().value).toBe("Hi Maria, book here: {{link}} — Sharma-Crawford");
    expect(button("Send text")!.disabled).toBe(true);
    expect(document.body.textContent).toContain("Fill in {{link}}");

    await type(document.querySelector('input[type="url"]') as HTMLInputElement, "https://calendly.com/scal/consult");
    expect(textarea().value).toBe("Hi Maria, book here: https://calendly.com/scal/consult — Sharma-Crawford");
    expect(button("Send text")!.disabled).toBe(false);

    await act(async () => { button("Send text")!.click(); });
    await flush();
    expect(mocks.send).toHaveBeenCalledWith({
      to: "+18165551234",
      body: "Hi Maria, book here: https://calendly.com/scal/consult — Sharma-Crawford",
      context: "call_log",
      templateKey: "consult_link",
      language: "en",
      profileLocalId: "p1",
    });
    expect(document.body.textContent).toContain("Text sent");
    expect(document.body.textContent).toContain("Logged in the client");
  });

  it("a Spanish call starts in Spanish", async () => {
    await open({ language: "Spanish" });
    expect(textarea().value).toMatch(/^Hola Maria, agende aquí/);
    expect(document.body.textContent).toContain("accents like á/í/ó/ú");
  });

  it("a hand-edited text is what goes out", async () => {
    await open({ templateKey: "plain" });
    expect(textarea().value).toBe("Call us at (816) 994-2300");
    await type(textarea(), "Call us tomorrow");
    await act(async () => { button("Send text")!.click(); });
    await flush();
    expect(mocks.send.mock.calls[0]![0].body).toBe("Call us tomorrow");
  });

  it("the profile's Espanol + First Name are used; Phone 2 is one click away", async () => {
    await open({ language: "Espanol", firstName: "Ana", phone: "816-555-1234", altPhones: ["913-555-0000", null] });
    expect(textarea().value).toMatch(/^Hola Ana,/);
    await act(async () => { button("Use (913) 555-0000 instead")!.click(); });
    expect((document.querySelector('input[type="tel"]') as HTMLInputElement).value).toBe("913-555-0000");
    // …and the number just left is offered back.
    expect(button("Use (816) 555-1234 instead")).toBeTruthy();
  });

  it('templateKey "" starts on free text', async () => {
    await open({ templateKey: "" });
    expect((document.querySelector("select") as HTMLSelectElement).value).toBe("");
    expect(textarea().value).toBe("");
    expect(button("Send text")!.disabled).toBe(true);
  });

  it("refuses a number that isn't a US number", async () => {
    await open({ templateKey: "plain", phone: "+52 55 1234 5678" });
    expect(document.body.textContent).toContain("Not a US number");
    expect(button("Send text")!.disabled).toBe(true);
  });

  it("test mode says so on the button and the result", async () => {
    mocks.mode = "dry-run";
    mocks.send.mockResolvedValue({ mode: "dry-run", status: "DryRun", activity: "none", segments: 1 });
    await open({ templateKey: "plain" });
    expect(document.body.textContent).toContain("not sent");
    await act(async () => { button("Send (test)")!.click(); });
    await flush();
    expect(document.body.textContent).toContain("Test text recorded (not sent)");
  });

  it("+ New template: anyone adds one, and it is picked", async () => {
    mocks.create.mockResolvedValue({ key: "court", label: "Court reminder", en: "Hi {{firstName}}, court is tomorrow.", es: "" });
    await open({ templateKey: "plain" });
    await act(async () => { button("+ New template")!.click(); });
    const inputs = document.querySelectorAll<HTMLInputElement>('input[type="text"]');
    await type(inputs[inputs.length - 1]!, "Court reminder");
    await type(document.querySelectorAll("textarea")[0]!, "Hi {{firstName}}, court is tomorrow.");
    await act(async () => { button("Add template")!.click(); });
    await flush();
    expect(mocks.create).toHaveBeenCalledWith({ label: "Court reminder", en: "Hi {{firstName}}, court is tomorrow.", es: "" });
    expect((document.querySelector("select") as HTMLSelectElement).value).toBe("court");
    expect(textarea().value).toBe("Hi Maria, court is tomorrow.");
  });

  it("Edit template changes the picked one in place", async () => {
    mocks.edit.mockResolvedValue({ key: "plain", label: "Plain", en: "Call us today at {{firmPhone}}", es: "" });
    await open({ templateKey: "plain" });
    await act(async () => { button("Edit template")!.click(); });
    await type(document.querySelectorAll("textarea")[0]!, "Call us today at {{firmPhone}}");
    await act(async () => { button("Save template")!.click(); });
    await flush();
    expect(mocks.edit).toHaveBeenCalledWith("plain", { label: "Plain", en: "Call us today at {{firmPhone}}", es: "" });
    expect(textarea().value).toBe("Call us today at (816) 994-2300");
  });
});
