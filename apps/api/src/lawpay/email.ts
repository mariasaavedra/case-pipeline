// =============================================================================
// LawPay's receipt e-mail → the payment (pure, unit-tested)
// =============================================================================
// LawPay e-mails a receipt for every payment ("Received Web Payment from <payer>
// for $50.00"). It reaches rafael@sharma-crawford.com, whose Outlook rule
// forwards it to importantdocuments@ (decided 2026-10-16, after LawPay webhooks
// turned out not to be available to us); scripts/lawpay-mail.ts reads that inbox.
//
// The receipt is label / value lines (sample, 2026-10-16):
//   Payment receipt / $50.00 / Account holder / <payer> / … / Account: /
//   SCAL Operating / Reference: / <REFERENCE> / Amount paid: / $50.00 /
//   Payment method: / VISA / Card number: / ****… / … / Payment date: /
//   Oct. 16, 2026 16:07 / Transaction ID: / 175905328 / Payment ID: / …
// Read by label, so a forwarded copy ("FW:", a header block on top) reads the
// same. Card number and auth code are never read or kept.
// =============================================================================

import { normalizeReference, parseReference, type LawPayPayment } from "./events.js";

export interface LawPayReceipt extends LawPayPayment {
  payer: string | null;
  /** "SCAL Operating" / "SCAL Trust". */
  account: string | null;
  /** As LawPay writes it, e.g. "Oct. 16, 2026 16:07". */
  paidOn: string | null;
}

/** The line after a "Label:" line (or the rest of the same line). */
function field(lines: string[], label: RegExp): string | null {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const m = label.exec(line);
    if (!m) continue;
    const rest = line.slice(m.index + m[0].length).trim();
    if (rest) return rest;
    const next = lines.slice(i + 1).find((l) => l.trim() !== "");
    return next?.trim() ?? null;
  }
  return null;
}

const dollars = (s: string | null) => {
  const n = s ? Number(s.replace(/[^0-9.]/g, "")) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
};

/** Is this a LawPay receipt at all (subject or body)? */
export function isLawPayReceipt(subject: string, text: string): boolean {
  return /\b(received|refund(ed)?)\b.*\bpayment\b|\bpayment receipt\b/i.test(subject) && /lawpay/i.test(text)
    || /payment receipt/i.test(text) && /lawpay/i.test(text) && /transaction id/i.test(text);
}

/**
 * The payment in a LawPay receipt e-mail (plain text), or null when it isn't
 * one, or its reference isn't one of ours ("<DESCRIPTION> - AF|PF|FF <AMOUNT>").
 */
export function parseLawPayEmail(subject: string, text: string): LawPayReceipt | null {
  if (!isLawPayReceipt(subject, text)) return null;
  // Drop "<https://…>" link targets and mailto/tel tails; keep the visible text.
  const lines = text.replace(/<(https?|mailto|tel):[^>]*>/gi, "").split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim());

  const reference = field(lines, /^reference:/i);
  if (!reference || !parseReference(reference)) return null;
  const amount = dollars(field(lines, /^amount (paid|refunded):/i)) ?? dollars(/\$\s?[\d,]+(\.\d{2})?/.exec(subject)?.[0] ?? null);
  if (amount === null) return null;

  const refunded = /refund/i.test(subject) || lines.some((l) => /^amount refunded:/i.test(l));
  const failed = /fail|declin/i.test(subject);
  return {
    transactionId: field(lines, /^transaction id:/i),
    reference: normalizeReference(reference),
    amount,
    outcome: refunded ? "refunded" : failed ? "failed" : "completed",
    method: field(lines, /^payment method:/i)?.toLowerCase() ?? null,
    payer: /payment from (.+?) for \$/i.exec(subject)?.[1]?.trim() ?? field(lines, /^account holder$/i),
    account: field(lines, /^account:/i),
    paidOn: field(lines, /^payment date:/i),
  };
}
