// =============================================================================
// LawPay payments → which Fee K, which fee (pure rules, unit-tested)
// =============================================================================
// Payments come from LawPay's receipt e-mails (email.ts, scripts/lawpay-mail.ts).
// The key is the payment's REFERENCE, which the app wrote itself and the client
// can't change (lib/lawpay.ts, `readOnlyFields=reference,amount`):
//   "<DESCRIPTION> - <AF|PF|FF> <AMOUNT>"   e.g. "ANA LOPEZ I-212 - AF 4120"
// A fee split into parts (the client's bank limit) adds "n/N" before the
// amount: "ANA LOPEZ I-212 - AF 1/2 2000".
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
  /** Set when the fee was split: part `n` of `of`. */
  part?: { n: number; of: number };
}

/** "ANA LOPEZ I-212 - AF 4120.00" (or "- AF 1/2 2000") → its parts; null when it isn't one of ours. */
export function parseReference(ref: string): ParsedReference | null {
  const m = /^(.*\S)\s+-\s+(AF|PF|FF)\s+(?:([1-9])\/([2-9])\s+)?(\d+(?:\.\d{1,2})?)\s*$/i.exec(ref.replace(/\s+/g, " ").trim());
  if (!m) return null;
  const out: ParsedReference = { description: m[1]!.toUpperCase(), fee: m[2]!.toUpperCase() as FeeType, amount: Number(m[5]) };
  if (m[3]) {
    const n = Number(m[3]), of = Number(m[4]);
    if (n > of) return null;
    out.part = { n, of };
  }
  return out;
}

export const normalizeReference = (ref: string) => ref.replace(/\s+/g, " ").trim().toUpperCase();

/**
 * A profile / Fee K name reduced to the person, for finding it in a reference:
 * "Isaac GONZALEZ MOLINA A214-099-391 [DETAINED IN CHASE]" → "ISAAC GONZALEZ
 * MOLINA"; "[10/19/26 - BOND] - Isaac GONZALEZ MOLINA" → the same. Leading
 * [tags] go, then everything from the first [, (, A-number or " - " on.
 */
export function personName(raw: string): string {
  let s = raw.replace(/\s+/g, " ").trim();
  while (/^\[[^\]]*\]\s*(-\s*)?/.test(s)) s = s.replace(/^\[[^\]]*\]\s*(-\s*)?/, "");
  const cut = s.search(/\[|\(|\bA[#\s-]*\d{3}-?\d{3}-?\d{3}\b|\b\d{3}-\d{3}-\d{3}\b|\s-\s/i);
  return (cut >= 0 ? s.slice(0, cut) : s).replace(/[^\p{L}\p{N}' .-]/gu, " ").replace(/\s+/g, " ").trim().toUpperCase();
}

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
  /** users.db `created_at` ("YYYY-MM-DD HH:MM:SS", UTC). */
  createdAt?: string;
}

/** Links recorded within this many seconds of the newest are one M21 hand-out. */
const SET_WINDOW_S = 10;

/**
 * The latest set of links handed out: the ones M21 recorded last. Earlier
 * sets were replaced (seen 2026-10-29: AF + FF links, then one AF with the
 * litigation filing fee folded in, split in two — the old FF link must not
 * count as still owed).
 */
export function latestLinkSet(issued: IssuedLink[]): IssuedLink[] {
  const time = (l: IssuedLink) => (l.createdAt ? Date.parse(`${l.createdAt.replace(" ", "T")}Z`) : NaN);
  const newest = Math.max(...issued.map(time).filter((t) => Number.isFinite(t)));
  if (!Number.isFinite(newest)) return issued;
  return issued.filter((l) => !(time(l) < newest - SET_WINDOW_S * 1000));
}

/**
 * Fully paid = every fee on the Fee K has a completed payment. The fees are
 * the latest set of links the app issued for it when there are any, else the
 * Fee K's own AF / FF / PF on Monday.
 */
export function isFullyPaid(
  issued: IssuedLink[],
  feeK: Partial<Record<FeeType, number | null>>,
  paidFees: Set<FeeType>,
): boolean {
  const owed = issued.length
    ? [...new Set(latestLinkSet(issued).map((l) => l.fee))]
    : (["AF", "FF", "PF"] as FeeType[]).filter((f) => (feeK[f] ?? 0) > 0);
  return owed.length > 0 && owed.every((f) => paidFees.has(f));
}

/**
 * The fees paid in full, from the references of the payments received: a fee
 * is paid by one whole-fee payment, or by every part of a split ("1/2" and
 * "2/2"). Parts of different splits of the same fee don't add up.
 */
export function paidFees(paidReferences: string[]): Set<FeeType> {
  const whole = new Set<FeeType>();
  const parts = new Map<string, Set<number>>();
  for (const r of paidReferences) {
    const ref = parseReference(r);
    if (!ref) continue;
    if (!ref.part) { whole.add(ref.fee); continue; }
    const key = `${ref.fee} ${ref.part.of}`;
    parts.set(key, (parts.get(key) ?? new Set()).add(ref.part.n));
  }
  for (const [key, got] of parts) {
    const [fee, of] = key.split(" ") as [FeeType, string];
    if (got.size >= Number(of)) whole.add(fee);
  }
  return whole;
}

/** How many parts of this payment's split are still unpaid; null when it isn't a part. */
export function partsLeft(ref: ParsedReference, paidReferences: string[]): number | null {
  if (!ref.part) return null;
  const got = new Set(paidReferences.flatMap((r) => {
    const p = parseReference(r);
    return p?.part && p.fee === ref.fee && p.part.of === ref.part!.of ? [p.part.n] : [];
  }));
  return Math.max(0, ref.part.of - got.size);
}

export const FEE_WORDS: Record<FeeType, string> = { AF: "Attorney fee", FF: "Filing fee", PF: "Postage fee" };
