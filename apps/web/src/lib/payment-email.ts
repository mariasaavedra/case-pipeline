// =============================================================================
// The payment-links e-mail (M21 "Email links to client")
// =============================================================================
// For contracts signed in Adobe Sign after being sent from the app (decided
// 2026-10-16): staff check the amounts in M21 and send this from their own
// Outlook (sharepoint/graph.ts sendMailAsMe). English and Spanish in one
// message, like the contracts. One line per fee with its LawPay link.
//
// How the client pays decides the amounts: by CREDIT card each link carries its
// own 3% (the contract's per-fee "Surcharge Fee" lines; the user chose this over
// a separate surcharge link), DEBIT card the fee as is, CASH no links at all.
// =============================================================================

import { SURCHARGE_RATE } from "./contract-fill";
import { lawPayLink, type FeeType } from "./lawpay";

export type PayMethod = "credit" | "debit" | "cash";

/** Monday's Payment Method label → the pick; SPLIT PAYMENTS / empty → null (staff choose). */
export function payMethodOf(label: string | null | undefined): PayMethod | null {
  const s = (label ?? "").toLowerCase();
  return s.includes("credit") ? "credit" : s.includes("debit") ? "debit" : s.trim() === "cash" ? "cash" : null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** What one link charges: the fee, plus its 3% when paying by credit card. */
export function chargeFor(fee: number, method: PayMethod): number {
  return method === "credit" ? round2(fee * (1 + SURCHARGE_RATE)) : fee;
}

const FEE_WORDS: Record<FeeType, { en: string; es: string }> = {
  AF: { en: "Attorney's fee", es: "Honorarios de abogado" },
  FF: { en: "Filing fee", es: "Tarifas del gobierno" },
  PF: { en: "Postage fee", es: "Tarifa de envío" },
};
const ORDER: FeeType[] = ["AF", "FF", "PF"];

export interface PaymentLine {
  fee: FeeType;
  amount: number;
  link: string;
}

/** The links for these fees (in dollars, before surcharge). Cash = none. */
export function paymentLines(description: string, fees: Partial<Record<FeeType, number | null>>, method: PayMethod): PaymentLine[] {
  if (method === "cash") return [];
  return ORDER.flatMap((fee) => {
    const base = fees[fee];
    if (base === null || base === undefined || !(base > 0)) return [];
    const amount = chargeFor(base, method);
    const link = lawPayLink(description, fee, amount);
    return link ? [{ fee, amount, link }] : [];
  });
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface PaymentEmail {
  subject: string;
  html: string;
  /** The same message as plain text, for the preview in M21. */
  text: string;
}

export const FIRM_PHONE = "(816) 994-2300";

export function paymentEmail(opts: {
  clientName: string;
  matter: string;
  lines: PaymentLine[];
  method: PayMethod;
  senderName: string;
}): PaymentEmail {
  const { clientName, matter, lines, method, senderName } = opts;
  const credit = method === "credit";
  const subject = `Payment links / Enlaces de pago — ${clientName}${matter ? ` — ${matter}` : ""}`;

  const en = {
    hello: `Dear ${clientName},`,
    intro: "Thank you for signing your contract with Sharma-Crawford Attorneys at Law. You can pay with the secure links below:",
    pay: "Pay",
    surcharge: "includes the 3% credit card surcharge",
    outro: `If you have any questions, reply to this e-mail or call us at ${FIRM_PHONE}.`,
  };
  const es = {
    hello: `Estimado/a ${clientName}:`,
    intro: "Gracias por firmar su contrato con Sharma-Crawford Attorneys at Law. Puede pagar con los enlaces seguros a continuación:",
    pay: "Pagar",
    surcharge: "incluye el recargo del 3% por tarjeta de crédito",
    outro: `Si tiene alguna pregunta, responda a este correo o llámenos al ${FIRM_PHONE}.`,
  };

  const htmlBlock = (t: typeof en, lang: "en" | "es") => `
    <p>${esc(t.hello)}</p>
    <p>${esc(t.intro)}</p>
    <ul>${lines.map((l) => `
      <li><strong>${esc(FEE_WORDS[l.fee][lang])}: ${usd.format(l.amount)}</strong>${credit ? ` <span style="color:#555">(${esc(t.surcharge)})</span>` : ""}
        — <a href="${esc(l.link)}">${esc(t.pay)}</a></li>`).join("")}
    </ul>
    <p>${esc(t.outro)}</p>`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111">
    ${htmlBlock(en, "en")}
    <hr style="border:none;border-top:1px solid #ccc;margin:20px 0">
    <div style="font-style:italic">${htmlBlock(es, "es")}</div>
    <p>${esc(senderName)}<br>Sharma-Crawford Attorneys at Law<br>${FIRM_PHONE}</p>
  </div>`;

  const textBlock = (t: typeof en, lang: "en" | "es") =>
    [t.hello, "", t.intro, ...lines.map((l) => `• ${FEE_WORDS[l.fee][lang]}: ${usd.format(l.amount)}${credit ? ` (${t.surcharge})` : ""} — ${l.link}`), "", t.outro].join("\n");
  const text = [textBlock(en, "en"), "", "———", "", textBlock(es, "es"), "", senderName, "Sharma-Crawford Attorneys at Law", FIRM_PHONE].join("\n");

  return { subject, html, text };
}
