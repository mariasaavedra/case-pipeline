// @vitest-environment jsdom
// =============================================================================
// P11.5 Integrations — what the admin changes is what gets saved
// =============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { IntegrationsStatus } from "../api";

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  test: vi.fn(),
  check: vi.fn(),
}));

const status: IntegrationsStatus = {
  slack: {
    mode: "dry-run",
    tokenSet: true,
    bot: { name: "quarterbot", team: "SCAAL" },
    webhookSet: false,
    envChannels: { events: "C1111111111", ops: "C1111111111", alerts: null },
    catalog: [
      { key: "contract_signed", kind: "events", label: "Contract signed", description: "d" },
      { key: "sms_sent", kind: "events", label: "Text sent", description: "d" },
      { key: "ops_backup", kind: "ops", label: "Backup failed", description: "d" },
    ],
    settings: {
      events: {
        contract_signed: { enabled: true, channel: null },
        sms_sent: { enabled: true, channel: null },
        ops_backup: { enabled: true, channel: null },
      },
      opsRepeatMinutes: 60,
    },
    opsRepeatLimits: { min: 5, max: 1440 },
  },
  sms: { mode: "on", configured: true, fromNumber: "(816) 994-2300", templates: 2, tenDlcNote: "10DLC note" },
};

vi.mock("../api", () => ({
  fetchIntegrations: async () => structuredClone(status),
  fetchSlackChannels: async () => [
    { id: "C1111111111", name: "testing-grounds", isPrivate: true, isMember: true },
    { id: "C2222222222", name: "court-prepping-squad", isPrivate: true, isMember: true },
    { id: "C3333333333", name: "secret", isPrivate: true, isMember: false },
  ],
  updateNotifySettings: mocks.save,
  sendSlackTest: mocks.test,
  checkSmsConnection: mocks.check,
}));
vi.mock("../router", () => ({ navigate: () => {} }));

const { IntegrationsSection } = await import("./IntegrationsSection");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const button = (label: string) => Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === label)!;
const select = (label: string) => document.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement;
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };
async function change(el: HTMLSelectElement | HTMLInputElement, value: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  await act(async () => { el.dispatchEvent(new Event("change", { bubbles: true })); el.dispatchEvent(new Event("input", { bubbles: true })); });
}

async function open() {
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => { root.render(<IntegrationsSection />); });
  await flush();
}

beforeEach(() => {
  document.body.innerHTML = "";
  mocks.save.mockReset().mockImplementation(async (s: unknown) => s);
  mocks.test.mockReset().mockResolvedValue({ posted: true });
  mocks.check.mockReset().mockResolvedValue({ ok: true, steps: [{ ok: true, label: "JWT signs in" }] });
});

describe("IntegrationsSection", () => {
  it("shows both connections and their modes", async () => {
    await open();
    const text = document.body.textContent!;
    expect(text).toContain("Posting as quarterbot in SCAAL");
    expect(text).toContain("Test mode — logs only");
    expect(text).toContain("Texts go out from (816) 994-2300");
    expect(select("Channel for Contract signed").options[0]!.text).toBe("Default (🔒testing-grounds)");
    // A private channel the bot isn't in can't be picked.
    expect(Array.from(select("Channel for Contract signed").options).find((o) => o.value === "C3333333333")!.disabled).toBe(true);
  });

  it("saves exactly what was changed: an event off, one rerouted, a new repeat limit", async () => {
    await open();
    await act(async () => { (document.querySelector('input[aria-label="Post Text sent"]') as HTMLInputElement).click(); });
    await change(select("Channel for Contract signed"), "C2222222222");
    await change(document.querySelector('input[type="number"]') as HTMLInputElement, "30");
    await act(async () => { button("Save").click(); });
    await flush();
    expect(mocks.save).toHaveBeenCalledWith({
      events: {
        contract_signed: { enabled: true, channel: "C2222222222" },
        sms_sent: { enabled: false, channel: null },
        ops_backup: { enabled: true, channel: null },
      },
      opsRepeatMinutes: 30,
    });
    expect(document.body.textContent).toContain("Saved");
  });

  it("sends a test message to the picked channel", async () => {
    await open();
    await act(async () => { button("Send test message").click(); });
    await flush();
    expect(mocks.test).toHaveBeenCalledWith("C1111111111");
    expect(document.body.textContent).toContain("Posted in 🔒testing-grounds");
  });

  it("shows Slack's refusal from the test", async () => {
    mocks.test.mockRejectedValue(new Error("Slack: not_in_channel"));
    await open();
    await act(async () => { button("Send test message").click(); });
    await flush();
    expect(document.body.textContent).toContain("✗ Slack: not_in_channel");
  });

  it("runs the texting check and lists its steps", async () => {
    await open();
    await act(async () => { button("Check connection").click(); });
    await flush();
    expect(document.body.textContent).toContain("✓ JWT signs in");
  });
});
