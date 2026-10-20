// =============================================================================
// Fee K Types — the firm's case lookup table (P11.3.6)
// =============================================================================
// One row per Fee K Type (the curated Fee Ks dropdown Monday requires on every
// Fee K, 2026-10): what the client reads it as in Spanish, the board the case
// moves to once paid (a label of the Fee K's "It will go to…" status column),
// and the job on the firm's fee sheet that prices it (AF + FF). Prices stay in
// the fee sheet — this only names the row.
//
// Used by: the Fee K auto-fill (an empty "It will go to…" ← the board) and the
// contract forms M11 / M2 / M25 (picking a Fee K Type fills an empty AF / FF
// from its fee sheet job — read in the browser, like FeeSheetPicker).
//
// Stored in data/fee-k-types.json (same pattern as sms-templates.json); empty
// until an admin saves; until then Settings shows the starting draft
// (fee-k-types-draft.ts). Settings → Firm, admin-only, audited.
// =============================================================================

import fs from "node:fs";
import path from "node:path";

export interface FeeKTypeRow {
  /** The Fee K Type label, as on Monday. The key. */
  feeKType: string;
  /** How the client reads it (contracts, payment links, texts in Spanish). */
  spanish: string;
  /** "It will go to…" label: Open Forms, Court Cases, Motions… "" = not set. */
  board: string;
  /** The fee sheet's Job that prices it. "" = not set. */
  feeSheetJob: string;
}

const MAX_LABEL = 120;

let configPath: string | null = null;

export function initFeeKTypes(dataDir: string): void {
  configPath = path.join(dataDir, "fee-k-types.json");
}

/** Whether an admin has saved the table yet. Until then Settings shows the draft (fee-k-types-draft.ts). */
export function feeKTypesSaved(): boolean {
  return !!configPath && fs.existsSync(configPath);
}

/** The SAVED table — [] until an admin saves it (the draft is never used for writes). */
export function loadFeeKTypes(): FeeKTypeRow[] {
  if (!configPath) return [];
  try {
    return sanitizeFeeKTypes(JSON.parse(fs.readFileSync(configPath, "utf-8")));
  } catch {
    return [];
  }
}

export function saveFeeKTypes(input: unknown): FeeKTypeRow[] {
  if (!configPath) throw new Error("fee-k-types path not initialized");
  const clean = sanitizeFeeKTypes(input);
  fs.writeFileSync(configPath, JSON.stringify(clean, null, 2));
  return clean;
}

const str = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, MAX_LABEL) : "");
const key = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Coerce untrusted input. A row needs its Fee K Type; one row per type (the
 * first wins, any case); a row with nothing filled in is dropped. The Fee K
 * Type keeps its exact spelling — Monday's labels have double spaces
 * ("Bond MTN  (c)"), so only the ends are trimmed.
 */
export function sanitizeFeeKTypes(input: unknown): FeeKTypeRow[] {
  const list = Array.isArray(input) ? input : [];
  const seen = new Set<string>();
  return list.flatMap((raw) => {
    const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
    const feeKType = typeof o.feeKType === "string" ? o.feeKType.trim().slice(0, MAX_LABEL) : "";
    if (!feeKType || seen.has(key(feeKType))) return [];
    const row = { feeKType, spanish: str(o.spanish), board: str(o.board), feeSheetJob: str(o.feeSheetJob) };
    if (!row.spanish && !row.board && !row.feeSheetJob) return [];
    seen.add(key(feeKType));
    return [row];
  });
}

/** Fee K Type → its row (any case, any inner spacing). */
export function feeKTypeLookup(rows: FeeKTypeRow[]): (feeKType: string) => FeeKTypeRow | undefined {
  const byKey = new Map(rows.map((r) => [key(r.feeKType), r]));
  return (t) => byKey.get(key(t));
}
