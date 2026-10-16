// =============================================================================
// LawPay payments → which Fee K, which fee (pure rules, unit-tested)
// =============================================================================
// Payments come from LawPay's receipt e-mails (email.ts, scripts/lawpay-mail.ts).
// The key is the payment's REFERENCE, which the app wrote itself and the client
// can't change (lib/lawpay.ts, `readOnlyFields=reference,amount`):
//   "<DESCRIPTION> - <AF|PF|FF> <AMOUNT>"   e.g. "ANA LOPEZ I-212 - AF 4120"
// =============================================================================

export type FeeType = "AF" | "PF" | "FF";

export interface LawPayPayment {
  /** LawPay's transaction id, when the receipt has one (dedupes a second copy). */
  transactionId: string | null;
  reference: string;
  /** Dollars. */
  amount: number;
  /** "completed" counts; "failed" / "refunded" / "other" are recorded only. */
  outcome: "completed" | "failed" | "refunded" | "other";
  /** "card" / "bank" / … as LawPay names it, or null. */
  method: string | null;
}

export interface ParsedReference {
  description: string;
  fee: FeeType;
  amount: number;
}

/** "ANA LOPEZ I-212 - AF 4120.00" → its parts; null when it isn't one of ours. */
export function parseReference(ref: string): ParsedReference | null {
  const m = /^(.*\S)\s+-\s+(AF|PF|FF)\s+(\d+(?:\.\d{1,2})?)\s*$/i.exec(ref.replace(/\s+/g, " ").trim());
  if (!m) return null;
  return { description: m[1]!.toUpperCase(), fee: m[2]!.toUpperCase() as FeeType, amount: Number(m[3]) };
}

export const normalizeReference = (ref: string) => ref.replace(/\s+/g, " ").trim().toUpperCase();

/**
 * The Fee K a reference names: M21 ends every description with "K" + the Fee
 * K's Monday id in base 36 (apps/web/src/lib/lawpay.ts feeKCode). Null when
 * the reference has none (links made by hand).
 */
export function feeKIdFromReference(description: string): string | null {
  const m = /(?:^|\s)K([0-9A-Z]{4,12})$/i.exec(description.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 36);
  return Number.isSafeInteger(n) && n > 0 ? String(n) : null;
}

/** A link the app handed out (users.db payment_links). */
export interface IssuedLink {
  fee: FeeType;
  amount: number;
  paidAt: string | null;
}

/**
 * Fully paid = every fee on the Fee K has a completed payment. The fees are
 * the links the app issued for it when there are any (their latest set),
 * else the Fee K's own AF / FF / PF on Monday.
 */
export function isFullyPaid(
  issued: IssuedLink[],
  feeK: Partial<Record<FeeType, number | null>>,
  paidFees: Set<FeeType>,
): boolean {
  const owed = issued.length
    ? [...new Set(issued.map((l) => l.fee))]
    : (["AF", "FF", "PF"] as FeeType[]).filter((f) => (feeK[f] ?? 0) > 0);
  return owed.length > 0 && owed.every((f) => paidFees.has(f));
}

export const FEE_WORDS: Record<FeeType, string> = { AF: "Attorney fee", FF: "Filing fee", PF: "Postage fee" };
