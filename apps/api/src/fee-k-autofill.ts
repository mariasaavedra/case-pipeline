// =============================================================================
// Fee K auto-fill — the "INFO NEEDED TO FILL FEE K" fields nobody has to type
// =============================================================================
// Most Fee Ks are made by Monday's Create Fee K button, not the app, so this
// runs on the server against every new Fee K, wherever it came from. It fills
// only EMPTY columns, and only with values that follow from data already in
// Monday:
//
//   POC Full Name for Fee Ks  ← the client's Jail Intake "POC Name and
//       relationship with detained:", minus the relationship and any phone
//       number (parsePocName). Path: Fee K → Profile → appointment (any
//       attorney board) → its linked Jail Intake. Unparseable → left blank.
//   AF / FF Surcharge Fee     ← 3% of AF / FF, only when Payment Method is
//       "CREDIT Card - Surcharge Applies" (debit, cash, split: no surcharge).
//   Fee K Type / AF / FF / PF ← the quote the attorney saved with the P4
//       consult note (consult_fee_quotes, matchQuotes): the client's Fee K
//       added from 3 days before to 30 days after the note, whose case type is
//       empty or the quoted one. Used once, then stamped with the Fee K.
//   It will go to…            ← the board for its Fee K Type in the Fee K
//       Types table (Settings → Firm, fee-k-types.ts). One Fee K Type only.
//
// Everything else in that section already fills itself: Full Name / E-mail /
// E-mail 2 / Address are mirrors of the linked Profile, the AF/FF deadline date
// and Attorney are set by Monday automations. P14 flags a Fee K still missing
// Fee K Type / AF / Attorney / E-mail / Address.
//
// Safety: candidates come from live.db, but each one is re-read from Monday and
// re-planned on the fresh values right before the write, so a column someone
// filled since the last sync is never overwritten. Only Fee Ks added on/after
// FEE_K_AUTOFILL_SINCE are touched. Off unless FEE_K_AUTOFILL=on; a dry run
// (`npm run feek:autofill`) prints the plan and writes nothing.
// =============================================================================

import { caseTypeColumn, getBoardColumnsFor } from "@case-pipeline/query";
import type BetterSqlite3 from "better-sqlite3";
type DatabaseInstance = BetterSqlite3.Database;

/** Fee Ks column ids (config/boards.yaml, by_id). */
export const FEE_K_COLUMNS = {
  feeKType: "dropdown_mm89vqtc",
  af: "deal_value",
  ff: "numbers__1",
  pf: "numbers5__1",
  afSurcharge: "numeric_mm0gfccq",
  ffSurcharge: "numeric_mm0gc5x9",
  paymentMethod: "dropdown_mm7v5eeb",
  pocFullName: "text_mm7xyv8e",
  itWillGoTo: "status__1",
} as const;

/** Fee K Type → the "It will go to…" board (the Fee K Types table); null = none set. */
export type BoardFor = (feeKType: string) => string | null;

/** The card surcharge, same rate as the contract templates (contract-fill.ts). */
export const SURCHARGE_RATE = 0.03;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** A Payment Method label that means the card surcharge applies. */
export const isCreditCard = (label: string) => /^\s*credit\b/i.test(label);

// ---------------------------------------------------------------------------
// POC name
// ---------------------------------------------------------------------------

/** Words that describe the relationship, not the person. Multi-word ones first. */
const RELATIONSHIP_PHRASES = [
  "family friend", "director of community services", "sister in law", "brother in law",
  "mother in law", "father in law", "son in law", "daughter in law", "step daughter",
  "step son", "step mother", "step father", "ex romantic partner",
];
const RELATIONSHIP_WORDS = new Set([
  "mom", "mother", "mama", "madre", "dad", "father", "papa", "padre", "wife", "esposa", "husband",
  "esposo", "spouse", "partner", "gf", "bf", "girlfriend", "boyfriend", "fiance", "fiancee",
  "fiancé", "fiancée", "sister", "hermana", "brother", "hermano", "son", "hijo", "daughter", "hija",
  "aunt", "tia", "tía", "uncle", "tio", "tío", "niece", "nephew", "cousin", "prima", "primo",
  "friend", "amiga", "amigo", "grandmother", "grandfather", "grandma", "grandpa", "abuela",
  "abuelo", "stepdaughter", "stepson", "ex", "volunteer", "family", "sobrina", "sobrino",
  "suegra", "suegro", "cuñada", "cuñado", "novia", "novio", "relative", "self", "sil", "bil",
  "mil", "stepbrother", "stepsister", "stepmom", "stepdad", "familiar", "boss", "employer",
  "interpreter", "member", "manager",
]);

const norm = (s: string) => s.toLowerCase().replace(/[-/]+/g, " ").replace(/[^\p{L}\s]/gu, "").replace(/\s+/g, " ").trim();

/** True when the text is only relationship words ("Wife", "Sister in Law", "friend/ex-romantic partner"). */
function isRelationship(text: string): boolean {
  let t = ` ${norm(text)} `;
  for (const p of RELATIONSHIP_PHRASES) t = t.split(` ${p} `).join(" ");
  const words = t.trim().split(" ").filter(Boolean);
  return words.length === 0 || words.every((w) => RELATIONSHIP_WORDS.has(w) || w === "of" || w === "in" || w === "law");
}

/**
 * The person's name out of a Jail Intake POC entry, or null when there is no
 * name in it. "Jennifer Anaya - Wife" → "Jennifer Anaya"; "Jeff ORYI (Father)"
 * → "Jeff ORYI"; "Nancy Vargas for Carlos ORTIZ 316-847-5430" → "Nancy Vargas";
 * "Wife Veronica" → "Veronica"; "4173372836", "N/A", "Wife" → null.
 */
export function parsePocName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const name = nameIn(raw.replace(/\([^)]*\)+|\[[^\]]*\]/g, " ")); // "(Mom)", "[WIFE]", "(Dani)", "(Partner (?))"
  if (name) return name;
  // "Brother (Edras Juarez)", "(Eva Samayoa, Cousin)": the name is the bracketed part.
  const inside = [...raw.matchAll(/\(([^()]*)\)|\[([^\]]*)\]/g)].map((m) => m[1] ?? m[2] ?? "").join(" | ");
  return inside ? nameIn(inside) : null;
}

function nameIn(text: string): string | null {
  let s = text
    .replace(/\+?\d[\d\s().-]{6,}\d/g, " ") // phone numbers
    .replace(/[?*>]/g, " ");
  // "X for <client>", "X and Y": the POC is X.
  s = s.split(/\s+(?:for|and)\s+/i)[0] ?? "";
  // "Name - Wife", "Wife – Name", "Name: Husband", "Name, Wife": keep the part that is a name.
  // A hyphen inside a word is a surname ("ABONZA-HERNANDEZ"); only a spaced one separates.
  const parts = s.split(/\s+[-–—]+\s*|\s*[-–—]+\s+|[:,|;]/).map((p) => p.trim()).filter(Boolean);
  const named = parts.filter((p) => !isRelationship(p));
  if (named.length === 0) return null;
  // A relationship word glued to the name with no separator: "Paula Sister", "Brother Jefferson".
  let words = named[0]!.split(/\s+/).filter(Boolean)
    // "Torres-Wife": a relationship glued on with a hyphen.
    .map((w) => w.replace(/[-–—]+([\p{L}]+)$/u, (m, tail: string) => (isRelationship(tail) ? "" : m)));
  while (words.length > 1 && isRelationship(words[words.length - 1]!)) words = words.slice(0, -1);
  while (words.length > 1 && isRelationship(words[0]!)) words = words.slice(1);
  const name = words.join(" ").trim();
  if (!/\p{L}{2,}/u.test(name) || /^n\/?a$/i.test(name) || isRelationship(name)) return null;
  return name;
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

/** What a Fee K has now — from live.db for candidates, from Monday right before a write. */
export interface FeeKState {
  feeKType: string[];
  af: number | null;
  ff: number | null;
  pf: number | null;
  afSurcharge: number | null;
  ffSurcharge: number | null;
  paymentMethod: string[];
  pocFullName: string;
  /** "It will go to…" label; "" = empty. */
  itWillGoTo: string;
}

/** The case type + fees an attorney quoted with the P4 consult note (consult_fee_quotes). */
export interface FeeQuote {
  id: number;
  caseType: string;
  newCaseType: boolean;
  /** Quoted from the older "Contract for…" list (before 2026-10): not a Fee K
   *  Type label, so never written and not compared — the fees still apply. */
  oldType?: boolean;
  af: number | null;
  ff: number | null;
  pf: number | null;
  author: string | null;
  /** UTC "YYYY-MM-DD HH:MM:SS". */
  createdAt: string;
}

export interface FeeKFill {
  /** Monday column id → value for change_multiple_column_values. */
  values: Record<string, unknown>;
  /** raw_column_values key → value, for the local copy. */
  local: Record<string, unknown>;
  /** Human-readable, for logs and the dry run. Empty = only a quote to mark used. */
  changes: string[];
  /** The quote this fill applies; marked used once written (or found already filled). */
  quoteId?: number;
  /** The quoted case type is not on Monday's dropdown yet. */
  createLabels?: boolean;
}

const money = (n: number) => `$${n.toFixed(2)}`;
const sameType = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The empty columns this Fee K can have filled. Null when there is nothing to do. */
export function planFeeKFill(
  state: FeeKState,
  jailIntakePoc: string | null,
  quote: FeeQuote | null = null,
  boardFor: BoardFor | null = null,
): FeeKFill | null {
  const values: Record<string, unknown> = {};
  const local: Record<string, unknown> = {};
  const changes: string[] = [];
  let createLabels = false;

  // The quote first: its AF / FF feed the surcharges below.
  const fees = { af: state.af, ff: state.ff };
  let feeKType = state.feeKType;
  if (quote) {
    if (state.feeKType.length === 0 && !quote.oldType) {
      values[FEE_K_COLUMNS.feeKType] = { labels: [quote.caseType] };
      local.fee_k_type = { labels: [quote.caseType] };
      changes.push(`Fee K Type = "${quote.caseType}"`);
      createLabels = quote.newCaseType;
      feeKType = [quote.caseType];
    }
    for (const [k, col, label] of [["af", FEE_K_COLUMNS.af, "AF"], ["ff", FEE_K_COLUMNS.ff, "FF"], ["pf", FEE_K_COLUMNS.pf, "PF"]] as const) {
      const q = quote[k];
      if (q == null || state[k] != null) continue;
      values[col] = String(q);
      local[k] = String(q);
      changes.push(`${label} = ${money(q)}`);
      if (k !== "pf") fees[k] = q;
    }
  }

  if (!state.pocFullName.trim()) {
    const name = parsePocName(jailIntakePoc);
    if (name) {
      values[FEE_K_COLUMNS.pocFullName] = name;
      local.poc_full_name_for_fee_ks = name;
      changes.push(`POC Full Name = "${name}"`);
    }
  }
  if (state.paymentMethod.some(isCreditCard)) {
    for (const [fee, sur, key, label] of [
      [fees.af, state.afSurcharge, "af_surcharge_fee", "AF"],
      [fees.ff, state.ffSurcharge, "ff_surcharge_fee", "FF"],
    ] as const) {
      if (fee == null || fee <= 0 || sur != null) continue;
      const v = round2(fee * SURCHARGE_RATE);
      const col = key === "af_surcharge_fee" ? FEE_K_COLUMNS.afSurcharge : FEE_K_COLUMNS.ffSurcharge;
      values[col] = String(v);
      local[key] = String(v);
      changes.push(`${label} Surcharge = ${money(v)} (3% of ${money(fee)})`);
    }
  }
  // Where the case goes once paid, from the Fee K Types table.
  const board = !state.itWillGoTo.trim() && feeKType.length === 1 && boardFor ? boardFor(feeKType[0]!) : null;
  if (board) {
    values[FEE_K_COLUMNS.itWillGoTo] = { label: board };
    local.it_will_go_to = { label: board };
    changes.push(`It will go to = "${board}"`);
  }
  if (!changes.length && !quote) return null;
  return { values, local, changes, ...(quote ? { quoteId: quote.id } : {}), ...(createLabels ? { createLabels } : {}) };
}

// ---------------------------------------------------------------------------
// Candidates (live.db)
// ---------------------------------------------------------------------------

const num = (raw: unknown): number | null => {
  if (raw == null) return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[$,\s]/g, ""));
  return String(raw).trim() === "" || !Number.isFinite(n) ? null : n;
};

function labels(raw: unknown): string[] {
  let v = raw;
  if (typeof v === "string") {
    try { v = JSON.parse(v); } catch { return v ? [v as string] : []; }
  }
  if (v && typeof v === "object" && !Array.isArray(v)) v = (v as { labels?: unknown }).labels;
  return Array.isArray(v) ? v.filter((l): l is string => typeof l === "string" && l.trim() !== "") : [];
}

/** A status column's label as stored ({ label }), "" when empty. */
function statusLabel(raw: unknown): string {
  const l = raw && typeof raw === "object" ? (raw as { label?: unknown }).label : undefined;
  return typeof l === "string" ? l : "";
}

export interface FeeKCandidate {
  localId: string;
  mondayItemId: string;
  name: string;
  state: FeeKState;
  jailIntakePoc: string | null;
  quote: FeeQuote | null;
  fill: FeeKFill;
}

/** A quote reaches a Fee K added from 3 days before it (Create Fee K pressed first) to 30 days after. */
export const QUOTE_WINDOW = { daysBefore: 3, daysAfter: 30 } as const;

const dayNum = (ymd: string) => Date.parse(`${ymd.slice(0, 10)}T00:00:00Z`) / 86_400_000;

/**
 * Which of a client's Fee Ks each of their unused quotes belongs to. A Fee K
 * fits when it was added in QUOTE_WINDOW and its "Fee K Type" is empty or
 * the quoted case type (any, for an `oldType` quote). One fit → that one;
 * several → the single one already showing the case type, else none (a person
 * decides). Newest quote first; a Fee K takes at most one quote.
 */
export function quoteFitsType(q: FeeQuote, feeKType: string[]): boolean {
  return !!q.oldType || feeKType.length === 0 || feeKType.some((t) => sameType(t, q.caseType));
}

export function matchQuotes(
  feeKs: { mondayItemId: string; addedOn: string; feeKType: string[] }[],
  quotes: FeeQuote[],
): Map<string, FeeQuote> {
  const out = new Map<string, FeeQuote>();
  for (const q of [...quotes].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    const qd = dayNum(q.createdAt);
    const fits = feeKs.filter((f) => {
      if (out.has(f.mondayItemId)) return false;
      const d = dayNum(f.addedOn) - qd;
      return d >= -QUOTE_WINDOW.daysBefore && d <= QUOTE_WINDOW.daysAfter
        && quoteFitsType(q, f.feeKType);
    });
    const typed = fits.filter((f) => f.feeKType.some((t) => sameType(t, q.caseType)));
    const pick = fits.length === 1 ? fits[0] : typed.length === 1 ? typed[0] : undefined;
    if (pick) out.set(pick.mondayItemId, q);
  }
  return out;
}

function unusedQuotes(db: DatabaseInstance): Map<string, FeeQuote[]> {
  const byProfile = new Map<string, FeeQuote[]>();
  let rows: { id: number; profile: string; caseType: string; newCaseType: number; af: number | null; ff: number | null; pf: number | null; author: string | null; createdAt: string }[] = [];
  try {
    rows = db.prepare(`
      SELECT id, profile_monday_id AS profile, case_type AS caseType, new_case_type AS newCaseType,
             af, ff, pf, author_name AS author, created_at AS createdAt
        FROM consult_fee_quotes WHERE fee_k_monday_id IS NULL AND applied_at IS NULL
    `).all() as typeof rows;
  } catch {
    return byProfile; // a database from before schema v32
  }
  // Fee K Type labels; a quote's case type that isn't one came from the old list.
  const feeKs = getBoardColumnsFor(db, "fee_ks");
  const typeLabels = ((feeKs && caseTypeColumn(feeKs))?.options ?? []).map((o) => o.label);
  for (const r of rows) {
    const newCaseType = r.newCaseType === 1;
    const oldType = typeLabels.length > 0 && !newCaseType && !typeLabels.some((l) => sameType(l, r.caseType));
    const q: FeeQuote = {
      id: r.id, caseType: r.caseType, newCaseType, ...(oldType ? { oldType } : {}),
      af: r.af, ff: r.ff, pf: r.pf, author: r.author, createdAt: r.createdAt,
    };
    byProfile.set(r.profile, [...(byProfile.get(r.profile) ?? []), q]);
  }
  return byProfile;
}

/**
 * Fee Ks added on/after `since` with something to fill, per live.db. The Jail
 * Intake POC is the newest one linked from any of the client's appointments;
 * the quote is the client's P4 consult-note quote (matchQuotes).
 */
export function findFeeKCandidates(db: DatabaseInstance, since: string, boardFor: BoardFor | null = null): FeeKCandidate[] {
  const rows = db.prepare(`
    SELECT c.local_id, c.monday_item_id, c.name, c.profile_local_id, c.raw_column_values AS raw,
           COALESCE(c.profile_monday_id, json_extract(c.raw_column_values, '$.profile.linked_item_ids[0]')) AS profileMondayId,
           COALESCE(json_extract(c.raw_column_values, '$.contract_added_on.date'), substr(c.created_at, 1, 10)) AS addedOn
      FROM contracts c
     WHERE c.deleted_at IS NULL AND c.monday_item_id IS NOT NULL
       AND COALESCE(json_extract(c.raw_column_values, '$.contract_added_on.date'), substr(c.created_at, 1, 10)) >= ?
  `).all(since) as { local_id: string; monday_item_id: string; name: string; profile_local_id: string | null; raw: string | null; profileMondayId: string | null; addedOn: string }[];

  const pocFor = db.prepare(`
    SELECT json_extract(ji.column_values, '$.poc_name_and_relationship_with_detained') AS poc
      FROM board_items a, json_each(a.column_values) rel, json_each(json_extract(rel.value, '$.linked_item_ids')) link
      JOIN board_items ji ON ji.board_key = '_fa_jail_intakes' AND ji.deleted_at IS NULL AND ji.monday_item_id = CAST(link.value AS TEXT)
     WHERE a.board_key LIKE 'appointments_%' AND a.deleted_at IS NULL AND a.profile_local_id = ?
       AND rel.key LIKE '%jail_intakes%' AND rel.type = 'object'
       AND COALESCE(json_extract(ji.column_values, '$.poc_name_and_relationship_with_detained'), '') <> ''
     ORDER BY COALESCE(ji.updated_at_source, '') DESC
  `);

  const parsed = rows.map((r) => {
    let raw: Record<string, unknown> = {};
    try { raw = JSON.parse(r.raw ?? "{}") as Record<string, unknown>; } catch { /* empty */ }
    const state: FeeKState = {
      feeKType: labels(raw.fee_k_type),
      af: num(raw.af), ff: num(raw.ff), pf: num(raw.pf),
      afSurcharge: num(raw.af_surcharge_fee), ffSurcharge: num(raw.ff_surcharge_fee),
      paymentMethod: labels(raw.payment_method),
      pocFullName: typeof raw.poc_full_name_for_fee_ks === "string" ? raw.poc_full_name_for_fee_ks : "",
      itWillGoTo: statusLabel(raw.it_will_go_to),
    };
    return { r, state };
  });

  // Quotes, matched per client.
  const quotes = unusedQuotes(db);
  const quoteFor = new Map<string, FeeQuote>();
  const byProfile = new Map<string, typeof parsed>();
  for (const p of parsed) {
    if (p.r.profileMondayId) byProfile.set(p.r.profileMondayId, [...(byProfile.get(p.r.profileMondayId) ?? []), p]);
  }
  for (const [profile, qs] of quotes) {
    const feeKs = (byProfile.get(profile) ?? []).map((p) => ({ mondayItemId: p.r.monday_item_id, addedOn: p.r.addedOn, feeKType: p.state.feeKType }));
    for (const [id, q] of matchQuotes(feeKs, qs)) quoteFor.set(id, q);
  }

  const out: FeeKCandidate[] = [];
  for (const { r, state } of parsed) {
    // Parse each linked POC, newest first; the first that yields a name wins.
    let jailIntakePoc: string | null = null;
    if (!state.pocFullName.trim() && r.profile_local_id) {
      for (const p of pocFor.all(r.profile_local_id) as { poc: string }[]) {
        if (parsePocName(p.poc)) { jailIntakePoc = p.poc; break; }
      }
    }
    const quote = quoteFor.get(r.monday_item_id) ?? null;
    const fill = planFeeKFill(state, jailIntakePoc, quote, boardFor);
    if (fill) out.push({ localId: r.local_id, mondayItemId: r.monday_item_id, name: r.name, state, jailIntakePoc, quote, fill });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

/** A Fee K's current values, read from Monday (column id → text). */
export type ReadFeeK = (mondayItemId: string) => Promise<{ boardId: string; text: Record<string, string> } | null>;
export type WriteFeeK = (boardId: string, mondayItemId: string, values: Record<string, unknown>, createLabelsIfMissing?: boolean) => Promise<void>;

/** Monday column texts → FeeKState. Dropdown text is "A, B". */
export function stateFromMonday(text: Record<string, string>): FeeKState {
  const t = (id: string) => (text[id] ?? "").trim();
  const list = (id: string) => (t(id) ? t(id).split(/\s*,\s*/).filter(Boolean) : []);
  return {
    feeKType: list(FEE_K_COLUMNS.feeKType),
    af: num(t(FEE_K_COLUMNS.af)), ff: num(t(FEE_K_COLUMNS.ff)), pf: num(t(FEE_K_COLUMNS.pf)),
    afSurcharge: num(t(FEE_K_COLUMNS.afSurcharge)), ffSurcharge: num(t(FEE_K_COLUMNS.ffSurcharge)),
    paymentMethod: list(FEE_K_COLUMNS.paymentMethod),
    pocFullName: t(FEE_K_COLUMNS.pocFullName),
    itWillGoTo: t(FEE_K_COLUMNS.itWillGoTo),
  };
}

export interface FeeKRunResult {
  candidates: number;
  written: { mondayItemId: string; name: string; changes: string[]; quoteId?: number }[];
  skipped: { mondayItemId: string; name: string; reason: string }[];
  failed: { mondayItemId: string; name: string; error: string }[];
}

/** Most Fee Ks one run writes — a guard against a bad plan touching the whole board. */
export const MAX_WRITES_PER_RUN = 25;

export async function runFeeKAutofill(opts: {
  db: DatabaseInstance;
  since: string;
  apply: boolean;
  read: ReadFeeK;
  write: WriteFeeK;
  /** The Fee K Types table's board per Fee K Type (fills an empty "It will go to…"). */
  boardFor?: BoardFor | null;
  log?: (line: string) => void;
}): Promise<FeeKRunResult> {
  const { db, since, apply, read, write } = opts;
  const log = opts.log ?? (() => {});
  const boardFor = opts.boardFor ?? null;
  const candidates = findFeeKCandidates(db, since, boardFor);
  const result: FeeKRunResult = { candidates: candidates.length, written: [], skipped: [], failed: [] };
  // Prepared on first use: a dry run may hold a read-only connection.
  const setLocal = (key: string, value: unknown, localId: string) => {
    const json = typeof value === "object" && value !== null;
    db.prepare(
      `UPDATE contracts SET raw_column_values = json_set(COALESCE(raw_column_values, '{}'), '$.' || ?, ${json ? "json(?)" : "?"}) WHERE local_id = ?`,
    ).run(key, json ? JSON.stringify(value) : value, localId);
  };
  const markQuote = (quoteId: number, feeK: string, note: string) =>
    db.prepare(`UPDATE consult_fee_quotes SET fee_k_monday_id = ?, applied_at = datetime('now'), applied_note = ? WHERE id = ?`)
      .run(feeK, note, quoteId);

  for (const c of candidates) {
    const quoteNote = c.quote ? ` [quote by ${c.quote.author ?? "attorney"}]` : "";
    if (!apply) {
      log(`[feek] would fill ${c.name} (${c.mondayItemId}): ${c.fill.changes.join("; ") || "nothing — quote already on it"}${quoteNote}`);
      result.written.push({ mondayItemId: c.mondayItemId, name: c.name, changes: c.fill.changes, ...(c.quote ? { quoteId: c.quote.id } : {}) });
      continue;
    }
    if (result.written.length >= MAX_WRITES_PER_RUN) {
      result.skipped.push({ mondayItemId: c.mondayItemId, name: c.name, reason: "run limit reached; next run" });
      continue;
    }
    try {
      const fresh = await read(c.mondayItemId);
      if (!fresh) {
        result.skipped.push({ mondayItemId: c.mondayItemId, name: c.name, reason: "not on Monday" });
        continue;
      }
      const state = stateFromMonday(fresh.text);
      // The quote still applies only if Monday's case type hasn't moved to another one.
      const quote = c.quote && quoteFitsType(c.quote, state.feeKType) ? c.quote : null;
      if (c.quote && !quote) {
        markQuote(c.quote.id, c.mondayItemId, `not used: Fee K is for ${state.feeKType.join(", ")}`);
      }
      const fill = planFeeKFill(state, c.jailIntakePoc, quote, boardFor);
      if (!fill || fill.changes.length === 0) {
        if (fill?.quoteId) markQuote(fill.quoteId, c.mondayItemId, "already filled on Monday");
        // Filled on Monday since the last sync: take Monday's values locally so it stops being a candidate.
        if (state.feeKType.length) setLocal("fee_k_type", { labels: state.feeKType }, c.localId);
        for (const k of ["af", "ff", "pf"] as const) if (state[k] != null) setLocal(k, String(state[k]), c.localId);
        if (state.pocFullName) setLocal("poc_full_name_for_fee_ks", state.pocFullName, c.localId);
        if (state.itWillGoTo) setLocal("it_will_go_to", { label: state.itWillGoTo }, c.localId);
        if (state.afSurcharge != null) setLocal("af_surcharge_fee", String(state.afSurcharge), c.localId);
        if (state.ffSurcharge != null) setLocal("ff_surcharge_fee", String(state.ffSurcharge), c.localId);
        result.skipped.push({ mondayItemId: c.mondayItemId, name: c.name, reason: "already filled on Monday" });
        continue;
      }
      await write(fresh.boardId, c.mondayItemId, fill.values, fill.createLabels);
      for (const [k, v] of Object.entries(fill.local)) setLocal(k, v, c.localId);
      if (fill.quoteId) markQuote(fill.quoteId, c.mondayItemId, fill.changes.join("; "));
      log(`[feek] filled ${c.name} (${c.mondayItemId}): ${fill.changes.join("; ")}${quoteNote}`);
      result.written.push({ mondayItemId: c.mondayItemId, name: c.name, changes: fill.changes, ...(fill.quoteId ? { quoteId: fill.quoteId } : {}) });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log(`[feek] failed ${c.name} (${c.mondayItemId}): ${error}`);
      result.failed.push({ mondayItemId: c.mondayItemId, name: c.name, error });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Monday I/O (shared token — this is the server acting, not a person)
// ---------------------------------------------------------------------------

/** read/write bound to the shared Monday token (setApiToken must have run). */
export async function mondayFeeKIo(): Promise<{ read: ReadFeeK; write: WriteFeeK }> {
  const { fetchItem, changeMultipleColumnValues } = await import("@case-pipeline/monday");
  return {
    read: async (id) => {
      try {
        const item = await fetchItem(id);
        if (!item.board?.id) return null;
        return { boardId: item.board.id, text: Object.fromEntries(item.column_values.map((c) => [c.id, c.text ?? ""])) };
      } catch (err) {
        if (err instanceof Error && /not found/i.test(err.message)) return null;
        throw err;
      }
    },
    write: async (boardId, id, values, createLabelsIfMissing) => {
      await changeMultipleColumnValues(boardId, id, values, undefined, createLabelsIfMissing);
    },
  };
}
