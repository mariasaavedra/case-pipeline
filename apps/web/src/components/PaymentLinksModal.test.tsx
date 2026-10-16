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

const mocks = vi.hoisted(() => ({
  props: null as null | Record<string, unknown>,
  mail: [] as { to: string; subject: string; html: string; interactive: boolean }[],
  needConsent: false,
  recorded: [] as { localId: string; info: { channel: string; method: string | null; links: { fee: string; amount: number; reference: string }[] } }[],
}));

vi.mock("../api", async (orig) => ({
  ...(await orig<typeof import("../api")>()),
  recordPaymentLinks: async (localId: string, info: (typeof mocks.recorded)[number]["info"]) => { mocks.recorded.push({ localId, info }); },
}));

vi.mock("../auth/useAuth", () => ({ useAuth: () => ({ user: { name: "Mayra Ruiz" } }) }));
vi.mock("../sharepoint/graph", () => {
  class GraphConsentRequiredError extends Error {}
  return {
    GraphConsentRequiredError,
    sendMailAsMe: async (msg: { to: string; subject: string; html: string }, interactive = false) => {
      if (mocks.needConsent && !interactive) throw new GraphConsentRequiredError("consent");
      mocks.mail.push({ ...msg, interactive });
    },
  };
});

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
  mocks.mail = [];
  mocks.needConsent = false;
  mocks.recorded = [];
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

describe("PaymentLinksModal → Email links to client (contracts signed in the app)", () => {
  const signed = {
    ...contract, attorneyFee: 4000, filingFee: 1175, contractFor: ["I-212"],
    paymentMethod: "CREDIT Card - Surcharge Applies", signedInApp: { clientEmail: "ana@mail.com" },
  } as unknown as PendingContract;
  const render = async (c: PendingContract, onMarkSent?: () => Promise<void>) => {
    const root = createRoot(document.body.appendChild(document.createElement("div")));
    await act(async () => { root.render(<PaymentLinksModal contract={c} onMarkSent={onMarkSent} onClose={() => {}} />); });
  };

  it("credit: links carry 3%; one bilingual e-mail to the signer, then marked sent", async () => {
    const onMarkSent = vi.fn(async () => {});
    await render(signed, onMarkSent);
    expect(document.body.textContent).toContain("ana@mail.com");
    await act(async () => { button("Email links to client")!.click(); });
    await flush();
    expect(mocks.mail).toHaveLength(1);
    expect(mocks.mail[0]).toMatchObject({ to: "ana@mail.com", subject: "Payment links / Enlaces de pago — Ana LOPEZ — I-212", interactive: false });
    expect(mocks.mail[0]!.html).toContain("amount=4120&amp;");
    expect(mocks.mail[0]!.html).toContain("amount=1210.25&amp;");
    expect(mocks.mail[0]!.html).toContain("Honorarios de abogado");
    expect(onMarkSent).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain("E-mailed to the client and marked sent");
    // Recorded, so LawPay's payment finds this Fee K (the references in the e-mail, exactly).
    expect(mocks.recorded).toEqual([{ localId: "c1", info: { channel: "email", method: "credit", links: [
      { fee: "AF", amount: 4120, reference: "ANA LOPEZ I-212 - AF 4120" },
      { fee: "FF", amount: 1210.25, reference: "ANA LOPEZ I-212 - FF 1210.25" },
    ] } }]);
    expect(mocks.mail[0]!.html).toContain(encodeURIComponent("ANA LOPEZ I-212 - AF 4120"));
  });

  it("first time: asks to allow Outlook sending, then sends from that click", async () => {
    mocks.needConsent = true;
    await render(signed, async () => {});
    await act(async () => { button("Email links to client")!.click(); });
    await flush();
    expect(mocks.mail).toEqual([]);
    await act(async () => { button("Allow sending from your Outlook, then send")!.click(); });
    await flush();
    expect(mocks.mail.map((m) => m.interactive)).toEqual([true]);
  });

  it("cash: no links and no e-mail; a contract not signed in the app has no e-mail button", async () => {
    await render({ ...signed, paymentMethod: "Cash" } as unknown as PendingContract);
    expect(document.body.textContent).toContain("no payment links");
    expect(button("Email links to client")).toBeUndefined();
    document.body.innerHTML = "";
    await render({ ...signed, signedInApp: null } as unknown as PendingContract);
    expect(button("Email links to client")).toBeUndefined();
  });

  it("split / unknown method: staff pick it before the e-mail shows", async () => {
    await render({ ...signed, paymentMethod: "SPLIT PAYMENTS" } as unknown as PendingContract);
    expect(button("Email links to client")).toBeUndefined();
    expect(document.body.textContent).toContain("Pick how the client pays");
    const debit = Array.from(document.querySelectorAll("label")).find((l) => l.textContent?.includes("Debit card"))!.querySelector("input")!;
    await act(async () => { debit.click(); });
    await act(async () => { button("Email links to client")!.click(); });
    await flush();
    expect(mocks.mail[0]!.html).toContain("amount=4000&amp;");
    expect(mocks.mail[0]!.html).not.toContain("surcharge");
  });
});
