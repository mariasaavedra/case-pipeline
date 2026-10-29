// =============================================================================
// LawPay payment links
// =============================================================================
// A LawPay link is just a page URL with the amount and a reference the client
// can't change — no LawPay API involved. Same rules as the firm's own link
// script: AF and PF are paid into Operating, FF into Trust; the reference is
// "<DESCRIPTION> - <FEE TYPE> <AMOUNT>" in capitals. A fee split into parts
// (the client's bank won't take it all at once) gets one link per part, with
// "n/N" before the amount: "ANA LOPEZ - AF 1/2 2000" — read back by
// apps/api/src/lawpay/events.ts, which calls the fee paid once every part is.
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

/** Part `n` of `of` of a split fee. */
export interface FeePart { n: number; of: number }

export function lawPayReference(description: string, feeType: FeeType, amount: string, part?: FeePart): string {
  return `${description.trim().toUpperCase()} - ${feeType} ${part ? `${part.n}/${part.of} ` : ""}${amount}`;
}

/** The payment link, or null when the description is empty or the amount isn't positive. */
export function lawPayLink(description: string, feeType: FeeType, rawAmount: string | number, part?: FeePart): string | null {
  const amount = formatLawPayAmount(rawAmount);
  if (!amount || !description.trim()) return null;
  const reference = encodeURIComponent(lawPayReference(description, feeType, amount, part));
  return `${PAGES[feeType]}?amount=${amount}&readOnlyFields=reference,amount&reference=${reference}`;
}

// --- Split payments ----------------------------------------------------------

/** The most parts a fee can be split into (the reference allows 1–9). */
export const MAX_PARTS = 4;

const toCents = (n: number) => Math.round(n * 100);

/** `total` in `n` equal parts, in dollars; the leftover cents go on the last part. */
export function splitEvenly(total: number, n: number): number[] {
  const cents = toCents(total);
  if (!(cents > 0) || n < 1) return [];
  const each = Math.floor(cents / n);
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? cents - each * (n - 1) : each) / 100);
}

/**
 * After part `edited` was typed in: what the other parts become so they still
 * add up to `total`. The parts after it share what is left equally (part 1 =
 * $1,500 of $4,000 → part 2 = $2,500); typing in the last part spreads the
 * rest over the ones before it. Nothing changes when there is nothing left to
 * share (the sum check in M21 then says how far off it is).
 */
export function rebalanceParts(total: number, parts: number[], edited: number): number[] {
  const out = [...parts];
  const others = edited === parts.length - 1
    ? parts.map((_, i) => i).filter((i) => i !== edited)
    : parts.map((_, i) => i).filter((i) => i > edited);
  const fixed = parts.reduce((sum, p, i) => (others.includes(i) ? sum : sum + toCents(p || 0)), 0);
  const rest = toCents(total) - fixed;
  if (others.length === 0 || rest < others.length) return out;
  splitEvenly(rest / 100, others.length).forEach((p, k) => { out[others[k]!] = p; });
  return out;
}

/** Whether the parts are all positive and add up to the fee, to the cent. */
export function partsAddUp(total: number, parts: number[]): boolean {
  return parts.length > 1 && parts.every((p) => p > 0) && parts.reduce((s, p) => s + toCents(p), 0) === toCents(total);
}
