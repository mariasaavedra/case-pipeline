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
  PF: "Processing fee",
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
