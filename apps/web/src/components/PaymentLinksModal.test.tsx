// @vitest-environment jsdom
// =============================================================================
// M21 → M28 — texting the payment links
// =============================================================================
// M28 itself is tested in SendSmsModal.test.tsx; it is stubbed here. Under
// test: what M21 hands it (the links, the client's numbers and language), and
// that only a live text records "Payment link sent".
// =============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { PendingContract, SendSmsResult } from "../api";

const mocks = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }));

vi.mock("./SendSmsModal", () => ({
  SendSmsModal: (p: Record<string, unknown>) => {
    mocks.props = p;
    return null;
  },
}));

const { PaymentLinksModal } = await import("./PaymentLinksModal");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const contract = {
  localId: "c1", clientName: "Ana LOPEZ", clientLocalId: "p1", contractFor: ["Court"],
  attorneyFee: 5000, filingFee: null, processingFee: null,
  clientPhone: null,
  clientContact: { phone2: "913-555-0000", preferredLanguage: "Espanol", firstName: "Ana" },
} as unknown as PendingContract;

const button = (label: string) => Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === label);
const flush = async () => { for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); }); };

async function open(onMarkSent?: () => Promise<void>) {
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => { root.render(<PaymentLinksModal contract={contract} onMarkSent={onMarkSent} onClose={() => {}} />); });
  await act(async () => { button("Text links to client")!.click(); });
}

const sent = async (r: Partial<SendSmsResult>) => {
  await act(async () => { (mocks.props!.onSent as (r: SendSmsResult) => void)({ mode: "on", status: "Queued", activity: "logged", segments: 3, ...r }); });
  await flush();
};

beforeEach(() => {
  document.body.innerHTML = "";
  mocks.props = null;
});

describe("PaymentLinksModal → Text links to client", () => {
  it("hands M28 the links and the client's Phone 2, language and first name", async () => {
    await open();
    expect(mocks.props).toMatchObject({
      context: "payment_links",
      templateKey: "payment_links",
      phone: "913-555-0000",
      firstName: "Ana",
      language: "Espanol",
      profileLocalId: "p1",
    });
    const links = (mocks.props!.vars as { links: string }).links;
    expect(links).toMatch(/^Attorney fee: https:\/\/secure\.lawpay\.com\/pages\/scal\/operating\?amount=5000&/);
  });

  it("a live text records Payment link sent", async () => {
    const markSent = vi.fn().mockResolvedValue(undefined);
    await open(markSent);
    await sent({ mode: "on" });
    expect(markSent).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain("Links texted to the client and marked sent.");
  });

  it("a test-mode text marks nothing", async () => {
    const markSent = vi.fn();
    await open(markSent);
    await sent({ mode: "dry-run" });
    expect(markSent).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("nothing marked");
  });

  it("a failed mark after a live text says the text went and to press Mark sent", async () => {
    await open(vi.fn().mockRejectedValue(new Error("Monday said no")));
    await sent({ mode: "on" });
    expect(document.body.textContent).toContain("Text sent, but the stage wasn't recorded: Monday said no");
  });
});
