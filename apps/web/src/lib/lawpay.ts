// =============================================================================
// LawPay payment links
// =============================================================================
// A LawPay link is just a page URL with the amount and a reference the client
// can't change — no LawPay API involved. Same rules as the firm's own link
// script: AF and PF are paid into Operating, FF into Trust; the reference is
// "<DESCRIPTION> - <FEE TYPE> <AMOUNT>" in capitals.
// =============================================================================

export type FeeType = "AF" | "PF" | "FF";

export const FEE_TYPE_LABELS: Record<FeeType, string> = {
  AF: "Attorney fee",
  PF: "Postage fee",
  FF: "Filing fee",
};

const PAGES: Record<FeeType, string> = {
  AF: "https://secure.lawpay.com/pages/scal/operating",
  PF: "https://secure.lawpay.com/pages/scal/operating",
  FF: "https://secure.lawpay.com/pages/scal/trust",
};

/** "800", "800.5" → "800.50"; null when not a positive amount. */
export function formatLawPayAmount(raw: string | number): string | null {
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/**
 * The Fee K's code in a reference: "K" + its Monday id in base 36 ("K3F9ZQ1"),
 * added to every link's description (2026-10-16) so a LawPay receipt names its
 * Fee K by itself — no guessing from the client's name or the amount. Read back
 * by apps/api/src/lawpay/events.ts feeKIdFromReference.
 */
export function feeKCode(mondayItemId: string | null | undefined): string | null {
  const n = Number(mondayItemId);
  return mondayItemId && Number.isSafeInteger(n) && n > 0 ? `K${n.toString(36).toUpperCase()}` : null;
}

/** The description with the Fee K's code at the end (once). */
export function withFeeKCode(description: string, mondayItemId: string | null | undefined): string {
  const code = feeKCode(mondayItemId);
  const d = description.trim();
  return !code || !d || new RegExp(`\\b${code}\\b`, "i").test(d) ? d : `${d} ${code}`;
}

export function lawPayReference(description: string, feeType: FeeType, amount: string): string {
  return `${description.trim().toUpperCase()} - ${feeType} ${amount}`;
}

/** The payment link, or null when the description is empty or the amount isn't positive. */
export function lawPayLink(description: string, feeType: FeeType, rawAmount: string | number): string | null {
  const amount = formatLawPayAmount(rawAmount);
  if (!amount || !description.trim()) return null;
  const reference = encodeURIComponent(lawPayReference(description, feeType, amount));
  return `${PAGES[feeType]}?amount=${amount}&readOnlyFields=reference,amount&reference=${reference}`;
}
