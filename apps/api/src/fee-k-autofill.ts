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
//
// Everything else in that section already fills itself: Full Name / E-mail /
// E-mail 2 / Address are mirrors of the linked Profile, the AF/FF deadline date
// and Attorney are set by Monday automations. Contract for / AF / FF / PF are
// decided by a person; P14 flags a Fee K missing them.
//
// Safety: candidates come from live.db, but each one is re-read from Monday and
// re-planned on the fresh values right before the write, so a column someone
// filled since the last sync is never overwritten. Only Fee Ks added on/after
// FEE_K_AUTOFILL_SINCE are touched. Off unless FEE_K_AUTOFILL=on; a dry run
// (`npm run feek:autofill`) prints the plan and writes nothing.
// =============================================================================

import type BetterSqlite3 from "better-sqlite3";
type DatabaseInstance = BetterSqlite3.Database;

/** Fee Ks column ids (config/boards.yaml, by_id). */
export const FEE_K_COLUMNS = {
  af: "deal_value",
  ff: "numbers__1",
  afSurcharge: "numeric_mm0gfccq",
  ffSurcharge: "numeric_mm0gc5x9",
  paymentMethod: "dropdown_mm7v5eeb",
  pocFullName: "text_mm7xyv8e",
} as const;

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
  af: number | null;
  ff: number | null;
  afSurcharge: number | null;
  ffSurcharge: number | null;
  paymentMethod: string[];
  pocFullName: string;
}

export interface FeeKFill {
  /** Monday column id → value for change_multiple_column_values. */
  values: Record<string, string>;
  /** raw_column_values key → value, for the local copy. */
  local: Record<string, string>;
  /** Human-readable, for logs and the dry run. */
  changes: string[];
}

const money = (n: number) => `$${n.toFixed(2)}`;

/** The empty columns this Fee K can have filled. Null when there is nothing to do. */
export function planFeeKFill(state: FeeKState, jailIntakePoc: string | null): FeeKFill | null {
  const values: Record<string, string> = {};
  const local: Record<string, string> = {};
  const changes: string[] = [];

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
      [state.af, state.afSurcharge, "af_surcharge_fee", "AF"],
      [state.ff, state.ffSurcharge, "ff_surcharge_fee", "FF"],
    ] as const) {
      if (fee == null || fee <= 0 || sur != null) continue;
      const v = round2(fee * SURCHARGE_RATE);
      const col = key === "af_surcharge_fee" ? FEE_K_COLUMNS.afSurcharge : FEE_K_COLUMNS.ffSurcharge;
      values[col] = String(v);
      local[key] = String(v);
      changes.push(`${label} Surcharge = ${money(v)} (3% of ${money(fee)})`);
    }
  }
  return changes.length ? { values, local, changes } : null;
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
  return Array.isArray(v) ? v.filter((l): l is string => typeof l === "string") : [];
}

export interface FeeKCandidate {
  localId: string;
  mondayItemId: string;
  name: string;
  state: FeeKState;
  jailIntakePoc: string | null;
  fill: FeeKFill;
}

/**
 * Fee Ks added on/after `since` with something to fill, per live.db. The Jail
 * Intake POC is the newest one linked from any of the client's appointments.
 */
export function findFeeKCandidates(db: DatabaseInstance, since: string): FeeKCandidate[] {
  const rows = db.prepare(`
    SELECT c.local_id, c.monday_item_id, c.name, c.profile_local_id, c.raw_column_values AS raw
      FROM contracts c
     WHERE c.deleted_at IS NULL AND c.monday_item_id IS NOT NULL
       AND COALESCE(json_extract(c.raw_column_values, '$.contract_added_on.date'), substr(c.created_at, 1, 10)) >= ?
  `).all(since) as { local_id: string; monday_item_id: string; name: string; profile_local_id: string | null; raw: string | null }[];

  const pocFor = db.prepare(`
    SELECT json_extract(ji.column_values, '$.poc_name_and_relationship_with_detained') AS poc
      FROM board_items a, json_each(a.column_values) rel, json_each(json_extract(rel.value, '$.linked_item_ids')) link
      JOIN board_items ji ON ji.board_key = '_fa_jail_intakes' AND ji.deleted_at IS NULL AND ji.monday_item_id = CAST(link.value AS TEXT)
     WHERE a.board_key LIKE 'appointments_%' AND a.deleted_at IS NULL AND a.profile_local_id = ?
       AND rel.key LIKE '%jail_intakes%' AND rel.type = 'object'
       AND COALESCE(json_extract(ji.column_values, '$.poc_name_and_relationship_with_detained'), '') <> ''
     ORDER BY COALESCE(ji.updated_at_source, '') DESC
  `);

  const out: FeeKCandidate[] = [];
  for (const r of rows) {
    let raw: Record<string, unknown> = {};
    try { raw = JSON.parse(r.raw ?? "{}") as Record<string, unknown>; } catch { /* empty */ }
    const state: FeeKState = {
      af: num(raw.af), ff: num(raw.ff),
      afSurcharge: num(raw.af_surcharge_fee), ffSurcharge: num(raw.ff_surcharge_fee),
      paymentMethod: labels(raw.payment_method),
      pocFullName: typeof raw.poc_full_name_for_fee_ks === "string" ? raw.poc_full_name_for_fee_ks : "",
    };
    // Parse each linked POC, newest first; the first that yields a name wins.
    let jailIntakePoc: string | null = null;
    if (!state.pocFullName.trim() && r.profile_local_id) {
      for (const p of pocFor.all(r.profile_local_id) as { poc: string }[]) {
        if (parsePocName(p.poc)) { jailIntakePoc = p.poc; break; }
      }
    }
    const fill = planFeeKFill(state, jailIntakePoc);
    if (fill) out.push({ localId: r.local_id, mondayItemId: r.monday_item_id, name: r.name, state, jailIntakePoc, fill });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

/** A Fee K's current values, read from Monday (column id → text). */
export type ReadFeeK = (mondayItemId: string) => Promise<{ boardId: string; text: Record<string, string> } | null>;
export type WriteFeeK = (boardId: string, mondayItemId: string, values: Record<string, string>) => Promise<void>;

/** Monday column texts → FeeKState. Dropdown text is "A, B". */
export function stateFromMonday(text: Record<string, string>): FeeKState {
  const t = (id: string) => (text[id] ?? "").trim();
  return {
    af: num(t(FEE_K_COLUMNS.af)), ff: num(t(FEE_K_COLUMNS.ff)),
    afSurcharge: num(t(FEE_K_COLUMNS.afSurcharge)), ffSurcharge: num(t(FEE_K_COLUMNS.ffSurcharge)),
    paymentMethod: t(FEE_K_COLUMNS.paymentMethod) ? t(FEE_K_COLUMNS.paymentMethod).split(/\s*,\s*/) : [],
    pocFullName: t(FEE_K_COLUMNS.pocFullName),
  };
}

export interface FeeKRunResult {
  candidates: number;
  written: { mondayItemId: string; name: string; changes: string[] }[];
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
  log?: (line: string) => void;
}): Promise<FeeKRunResult> {
  const { db, since, apply, read, write } = opts;
  const log = opts.log ?? (() => {});
  const candidates = findFeeKCandidates(db, since);
  const result: FeeKRunResult = { candidates: candidates.length, written: [], skipped: [], failed: [] };
  // Prepared on first use: a dry run may hold a read-only connection.
  const setLocal = { run: (key: string, value: string, localId: string) => db.prepare(
    `UPDATE contracts SET raw_column_values = json_set(COALESCE(raw_column_values, '{}'), '$.' || ?, ?) WHERE local_id = ?`,
  ).run(key, value, localId) };

  for (const c of candidates) {
    if (!apply) {
      log(`[feek] would fill ${c.name} (${c.mondayItemId}): ${c.fill.changes.join("; ")}`);
      result.written.push({ mondayItemId: c.mondayItemId, name: c.name, changes: c.fill.changes });
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
      const fill = planFeeKFill(state, c.jailIntakePoc);
      if (!fill) {
        // Filled on Monday since the last sync: take Monday's values locally so it stops being a candidate.
        if (state.pocFullName) setLocal.run("poc_full_name_for_fee_ks", state.pocFullName, c.localId);
        if (state.afSurcharge != null) setLocal.run("af_surcharge_fee", String(state.afSurcharge), c.localId);
        if (state.ffSurcharge != null) setLocal.run("ff_surcharge_fee", String(state.ffSurcharge), c.localId);
        result.skipped.push({ mondayItemId: c.mondayItemId, name: c.name, reason: "already filled on Monday" });
        continue;
      }
      await write(fresh.boardId, c.mondayItemId, fill.values);
      for (const [k, v] of Object.entries(fill.local)) setLocal.run(k, v, c.localId);
      log(`[feek] filled ${c.name} (${c.mondayItemId}): ${fill.changes.join("; ")}`);
      result.written.push({ mondayItemId: c.mondayItemId, name: c.name, changes: fill.changes });
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
    write: async (boardId, id, values) => {
      await changeMultipleColumnValues(boardId, id, values);
    },
  };
}
