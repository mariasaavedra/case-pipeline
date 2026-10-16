// =============================================================================
// LawPay payments from Slack #payments (pure, unit-tested)
// =============================================================================
// The firm's "Payment Bot" posts every LawPay transaction to #payments
// (C0922BS65LM), e.g. (2026-10-16):
//
//   New Transaction:
//   Transaction Type: Received Payment
//   Payer: <payer>
//   Date: Oct. 16, 2026 16:07
//   Amount: $50.00
//   Account: SCAL Operating
//   Reference: NORABEL … ADMIN FEE - AF 50
//
// The app's own Slack bot (quarterbot) is in the channel and may read its
// history, so this needs no Microsoft admin approval — it became the source on
// 2026-10-16, ahead of the e-mail reader (email.ts), which stays as a fallback.
// "Paypal Bot" posts (consult payments, no LawPay reference) are not read.
// =============================================================================

import { normalizeReference, parseReference } from "./events.js";
import type { LawPayReceipt } from "./email.js";

/** Slack's escaping and link markup → plain text. */
export function slackPlain(text: string): string {
  return text
    .replace(/<(?:mailto:|tel:|https?:\/\/)[^|>]*\|([^>]*)>/g, "$1")
    .replace(/<(?:mailto:|tel:)([^>]*)>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function field(lines: string[], label: string): string | null {
  const re = new RegExp(`^\\*?${label}\\*?:\\s*(.*)$`, "i");
  for (const l of lines) {
    const m = re.exec(l.trim());
    if (m && m[1]!.trim()) return m[1]!.replace(/^\*|\*$/g, "").trim();
  }
  return null;
}

/**
 * A Payment Bot post → the payment, or null when it isn't a LawPay
 * transaction post or its reference isn't one of ours.
 */
export function parsePaymentBotPost(text: string): LawPayReceipt | null {
  const plain = slackPlain(text);
  if (!/new transaction/i.test(plain)) return null;
  const lines = plain.split(/\r?\n/);
  const reference = field(lines, "Reference");
  if (!reference || !parseReference(reference)) return null;
  const amountText = field(lines, "Amount");
  const amount = amountText ? Number(amountText.replace(/[^0-9.]/g, "")) : NaN;
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const type = (field(lines, "Transaction Type") ?? "").toLowerCase();
  const date = field(lines, "Date");
  const ref = normalizeReference(reference);
  return {
    // Slack posts carry no LawPay id; this key makes a repeated post a no-op.
    transactionId: `slack|${date ?? ""}|${amount.toFixed(2)}|${ref}`,
    reference: ref,
    amount: Math.round(amount * 100) / 100,
    outcome: /refund|void|reversal|chargeback/.test(type) ? "refunded" : /fail|declin/.test(type) ? "failed" : /received|payment|sale|captur/.test(type) || !type ? "completed" : "other",
    method: null,
    payer: field(lines, "Payer"),
    account: field(lines, "Account"),
    paidOn: date,
  };
}
