// =============================================================================
// Fee K Types — the firm's case lookup table (P11.3.6)
// =============================================================================
// One row per Fee K Type (the curated Fee Ks dropdown Monday requires on every
// Fee K, 2026-10): what the client reads it as in Spanish, the board the case
// moves to once paid (a label of the Fee K's "It will go to…" status column),
// whether it goes through Prescheduling first, and the job on the firm's fee sheet that prices it (AF + FF). Prices stay in
// the fee sheet — this only names the row.
//
// Scope of services (2026-10-23, approved by Michael + Rekha): what a contract
// for this type includes and leaves out, in English and Spanish. The FORMS
// contract prints it as {{services}} / {{services_excluded}} (+ _es), after its
// common opening; staff can change it for one contract in M22.
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
  /**
   * Goes through Prescheduling (documents to collect) before its board. The
   * firm's rule (2026-10-29): yes whenever documents are needed, and when in
   * doubt; no only for types that need nothing from the client. Rows saved
   * before then have none → yes.
   */
  prescheduling: boolean;
  /** Scope of services: what the contract includes / leaves out, EN + ES. "" = nothing beyond the template's own text. */
  services: string;
  servicesEs: string;
  excluded: string;
  excludedEs: string;
  /**
   * What the client is asked to send for this case type (the Buzón checklist,
   * docs/features/buzon.md). [] = no evidence needed. Optional in the file:
   * rows saved before 2026-10-23 have none.
   */
  documents?: CaseDocument[];
}

/** One document on a case type's checklist. The client sees `en` or `es`. */
export interface CaseDocument {
  en: string;
  es: string;
  required: boolean;
}

export const MAX_DOCUMENTS = 40;

export const SCOPE_FIELDS = ["services", "servicesEs", "excluded", "excludedEs"] as const;

const MAX_LABEL = 120;
const MAX_SCOPE = 1000;

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

const str = (v: unknown, max = MAX_LABEL): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
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
    const row: FeeKTypeRow = {
      feeKType, spanish: str(o.spanish), board: str(o.board), feeSheetJob: str(o.feeSheetJob),
      prescheduling: o.prescheduling !== false,
      services: str(o.services, MAX_SCOPE), servicesEs: str(o.servicesEs, MAX_SCOPE),
      excluded: str(o.excluded, MAX_SCOPE), excludedEs: str(o.excludedEs, MAX_SCOPE),
      documents: sanitizeDocuments(o.documents),
    };
    if (row.prescheduling && !row.spanish && !row.board && !row.feeSheetJob && SCOPE_FIELDS.every((k) => !row[k]) && !row.documents!.length) return [];
    seen.add(key(feeKType));
    return [row];
  });
}

/**
 * A checklist: each document needs its English name (Spanish falls back to
 * it); the same name twice is kept once; at most MAX_DOCUMENTS.
 */
export function sanitizeDocuments(input: unknown): CaseDocument[] {
  const seen = new Set<string>();
  return (Array.isArray(input) ? input : []).flatMap((raw) => {
    const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
    const en = str(o.en);
    if (!en || seen.has(key(en))) return [];
    seen.add(key(en));
    return [{ en, es: str(o.es) || en, required: o.required !== false }];
  }).slice(0, MAX_DOCUMENTS);
}

/**
 * Fee K Type → the "It will go to…" label to write, or null. A board that
 * isn't one of Monday's labels yet (e.g. Address Changes before it's added on
 * Monday) is skipped rather than sent, since Monday refuses an unknown label.
 */
export function boardRouting(rows: FeeKTypeRow[], mondayBoards: string[]): (feeKType: string) => string | null {
  const row = feeKTypeLookup(rows);
  const labels = new Map(mondayBoards.map((b) => [key(b), b]));
  return (t) => {
    const board = row(t)?.board;
    return board ? (labels.get(key(board)) ?? null) : null;
  };
}

/**
 * Whether a Fee K with these types goes through Prescheduling: yes if any of
 * them does, and yes when in doubt (no types, a type not in the table).
 */
export function needsPrescheduling(rows: FeeKTypeRow[], feeKTypes: string[]): boolean {
  const row = feeKTypeLookup(rows);
  return feeKTypes.length === 0 || feeKTypes.some((t) => row(t)?.prescheduling !== false);
}

/** Fee K Type → its row (any case, any inner spacing). */
export function feeKTypeLookup(rows: FeeKTypeRow[]): (feeKType: string) => FeeKTypeRow | undefined {
  const byKey = new Map(rows.map((r) => [key(r.feeKType), r]));
  return (t) => byKey.get(key(t));
}

/**
 * The scope text for a Fee K's type(s), joined when it has several. From the
 * saved table, else the draft (whose scope text was approved 2026-10-23) — so
 * contracts get it before an admin first saves the table.
 */
export function scopeFor(
  feeKTypes: string[],
  rows: FeeKTypeRow[],
): Pick<FeeKTypeRow, (typeof SCOPE_FIELDS)[number]> {
  const find = feeKTypeLookup(rows);
  const hits = feeKTypes.map(find).filter((r): r is FeeKTypeRow => !!r);
  return Object.fromEntries(SCOPE_FIELDS.map((k) => [k, hits.map((r) => r[k]).filter(Boolean).join(" ")])) as Pick<FeeKTypeRow, (typeof SCOPE_FIELDS)[number]>;
}

/** A Fee K Type as a contract names it: Monday's "(c)" court marker and doubled spaces dropped. */
export const contractTitle = (feeKType: string) => feeKType.replace(/\(c\)/gi, "").replace(/\s+/g, " ").trim();

/**
 * The matter a contract is for, from its Fee K Type(s), in English and Spanish
 * ("I-130 - Petition for Alien Relative" / "Petición de familiar extranjero
 * (I-130)"), several joined with " + ". A type with no Spanish name keeps its English one.
 */
export function contractTitles(feeKTypes: string[], rows: FeeKTypeRow[]): { en: string; es: string } {
  const find = feeKTypeLookup(rows);
  const en = feeKTypes.map(contractTitle).filter(Boolean);
  const es = feeKTypes.map((t) => find(t)?.spanish || contractTitle(t)).filter(Boolean);
  return { en: en.join(" + "), es: es.join(" + ") };
}
