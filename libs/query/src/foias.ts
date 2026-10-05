// =============================================================================
// FOIAs Query (P19)
// =============================================================================
// Open items on the FOIAs board, as a queue. A FOIA request sits in one phase:
//   decide ("Do we need it?") → ours (prepare and file) → agency (filed,
//   waiting for the records) ; "Send to North Pole" aside.
// Done = moved to the board's "Done FOIAS" group (the team's own signal: most
// items there never had their status changed), COMPLETED / NOT PROCEEDING, or a
// Results Received date on the item.
// Our turn is aged from "On FOIAs since…" (else Hire Date); waiting on the
// agency is aged from "Filed On:". Most agencies answer within 2–4 weeks on
// this board's history, so 30 / 60 days; 180+ days without results is almost
// always a Monday item nobody closed. See docs/features/foias.md.

import type BetterSqlite3 from "better-sqlite3";
type Database = BetterSqlite3.Database;
import type { WaitLevel } from "./prescheduling";

// =============================================================================
// Types
// =============================================================================

export type FoiaPhase = "decide" | "ours" | "agency" | "parked";

export type FoiaFlag = "inquiry_due" | "stale" | "no_filed_date" | "no_paralegal" | "no_profile";

export interface Foia {
  localId: string;
  itemName: string;
  clientName: string;
  clientLocalId: string | null;
  status: string | null;
  phase: FoiaPhase;
  paralegals: string[];
  attorney: string | null;
  /** Agencies on "FOIAs Quoted" (EOIR, USCIS, FBI, OBIM, CBP…). */
  quoted: string[];
  /** Agencies on "FOIAs Filed". */
  filed: string[];
  /** Quoted but not filed yet. */
  toFile: string[];
  onFoiasSince: string | null;
  filedOn: string | null;
  inquiryEligible: string | null;
  /** EOIR / NRC request numbers, when set. */
  requestNumbers: string[];
  /** Days since filed while waiting on the agency (since on the board when Filed On is empty), else since on the board. */
  ageDays: number | null;
  ageLevel: WaitLevel;
  whereToFile: string | null;
  flags: FoiaFlag[];
}

export interface FoiasResult {
  /** Open FOIAs, most pressing first. */
  items: Foia[];
  /** FOIAs with results in (or not proceeding) — not listed, counted. */
  doneCount: number;
  /** Results received in the last 30 days. */
  doneLast30: number;
  thresholds: typeof THRESHOLDS;
}

export interface FoiasOptions {
  /** ISO date to measure from (tests). Default today. */
  today?: string;
}

// =============================================================================
// Constants
// =============================================================================

/** The board group finished FOIAs are moved to. */
export const DONE_GROUP = "Done FOIAS";

/** Statuses that close a FOIA (it leaves the queue). */
export const FOIA_DONE = ["COMPLETED - RESULTS RECEIVED", "NOT PROCEEDING"];

const PHASE_OF_STATUS: Record<string, FoiaPhase> = {
  "do we need it?": "decide",
  "sent out": "agency",
  filed: "agency",
  inquired: "agency",
  "send to north pole": "parked",
};

/** Days before an item turns amber / red, per phase. */
export const THRESHOLDS: Record<FoiaPhase, { waitingDays: number; lateDays: number }> = {
  decide: { waitingDays: 14, lateDays: 30 },
  ours: { waitingDays: 14, lateDays: 30 },
  agency: { waitingDays: 30, lateDays: 60 },
  parked: { waitingDays: 60, lateDays: 120 },
};

/** Waiting on the agency this long → a cleanup item, not a live one. */
export const STALE_DAYS = 180;

const PHASE_ORDER: Record<FoiaPhase, number> = { decide: 0, ours: 1, agency: 2, parked: 3 };
const AGE_ORDER: Record<WaitLevel, number> = { late: 0, waiting: 1, fresh: 2, unknown: 3 };

// =============================================================================
// Helpers
// =============================================================================

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 86_400_000);
}

function label(raw: unknown): string | null {
  if (raw && typeof raw === "object" && "label" in raw) {
    const l = (raw as { label?: unknown }).label;
    return typeof l === "string" && l.trim() !== "" ? l.trim() : null;
  }
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;
}

function labels(raw: unknown): string[] {
  const l = raw && typeof raw === "object" ? (raw as { labels?: unknown }).labels : null;
  return Array.isArray(l) ? l.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()) : [];
}

function text(raw: unknown): string | null {
  if (typeof raw === "string") return raw.trim() || null;
  if (raw && typeof raw === "object" && "url" in raw) return text((raw as { url?: unknown }).url);
  return null;
}

function dateOf(raw: unknown): string | null {
  const d = raw && typeof raw === "object" ? (raw as { date?: unknown }).date : raw;
  return typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null;
}

// "A, B" people label. Drops entries that are clearly not a name.
function splitNames(raw: string | null): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(",").map((s) => s.trim()).filter((s) => s && !s.includes("@")))];
}

const AGENCY_ALIASES: Record<string, string> = { DARR: "DAR" };

/** "EOIR FOIA" → EOIR, "OBIM/FBI FOIA" → OBIM + FBI, "FBI Filed" → FBI. A bare "FOIA" names no agency. */
export function agenciesOf(values: string[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    for (const part of v.split("/")) {
      const name = part.replace(/\b(foia|filed)\b/gi, "").trim().toUpperCase();
      if (!name) continue;
      const agency = AGENCY_ALIASES[name] ?? name;
      if (!out.includes(agency)) out.push(agency);
    }
  }
  return out;
}

export function phaseOf(status: string | null): FoiaPhase {
  return PHASE_OF_STATUS[(status ?? "").trim().toLowerCase()] ?? "ours";
}

function ageLevelOf(phase: FoiaPhase, ageDays: number | null): WaitLevel {
  if (ageDays === null) return "unknown";
  const t = THRESHOLDS[phase];
  return ageDays >= t.lateDays ? "late" : ageDays >= t.waitingDays ? "waiting" : "fresh";
}

// =============================================================================
// Query
// =============================================================================

interface RawRow {
  localId: string;
  name: string;
  groupTitle: string | null;
  status: string | null;
  paralegals: string | null;
  clientLocalId: string | null;
  clientName: string | null;
  cv: string;
}

export function getFoias(db: Database, options: FoiasOptions = {}): FoiasResult {
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const done = new Set(FOIA_DONE.map((s) => s.toLowerCase()));

  const rows = db.prepare(`
    SELECT b.local_id AS localId, b.name, b.group_title AS groupTitle, b.status, b.paralegals,
           p.local_id AS clientLocalId, p.name AS clientName,
           b.column_values AS cv
    FROM board_items b
    LEFT JOIN profiles p ON p.local_id = b.profile_local_id
    WHERE b.board_key = 'foias' AND b.deleted_at IS NULL
  `).all() as RawRow[];

  const items: Foia[] = [];
  let doneCount = 0;
  let doneLast30 = 0;

  for (const r of rows) {
    let cv: Record<string, unknown> = {};
    try {
      cv = JSON.parse(r.cv) as Record<string, unknown>;
    } catch {
      /* unreadable row: show it with what the columns table has */
    }
    const status = r.status?.trim() || label(cv.status);
    const resultsOn = dateOf(cv.results_received);
    const inDoneGroup = r.groupTitle?.trim().toLowerCase() === DONE_GROUP.toLowerCase();
    if (inDoneGroup || done.has((status ?? "").toLowerCase()) || resultsOn) {
      doneCount++;
      if (resultsOn && daysBetween(resultsOn, today) <= 30) doneLast30++;
      continue;
    }

    const phase = phaseOf(status);
    const onFoiasSince = dateOf(cv.on_foias_since) ?? dateOf(cv.hire_date);
    const filedOn = dateOf(cv.filed_on);
    const inquiryEligible = dateOf(cv.inquiry_eligible);
    const from = phase === "agency" ? filedOn ?? onFoiasSince : onFoiasSince;
    const ageDays = from ? Math.max(0, daysBetween(from, today)) : null;
    const quoted = agenciesOf(labels(cv.foias_quoted));
    const filed = agenciesOf(labels(cv.foias_filed));
    const paralegals = splitNames(r.paralegals ?? label(cv.paralegal));

    const flags: FoiaFlag[] = [];
    if (phase === "agency" && status?.toLowerCase() !== "inquired" && inquiryEligible && inquiryEligible <= today) flags.push("inquiry_due");
    if (phase === "agency" && ageDays !== null && ageDays >= STALE_DAYS) flags.push("stale");
    if (phase === "agency" && !filedOn) flags.push("no_filed_date");
    if (paralegals.length === 0) flags.push("no_paralegal");
    if (!r.clientLocalId) flags.push("no_profile");

    items.push({
      localId: r.localId,
      itemName: r.name,
      clientName: r.clientName ?? r.name,
      clientLocalId: r.clientLocalId,
      status,
      phase,
      paralegals,
      attorney: splitNames(label(cv.attorney))[0] ?? null,
      quoted,
      filed,
      toFile: quoted.filter((a) => !filed.includes(a)),
      onFoiasSince,
      filedOn,
      inquiryEligible,
      requestNumbers: [text(cv.request_number), text(cv.nrc_request_number)].filter((n): n is string => !!n),
      ageDays,
      ageLevel: ageLevelOf(phase, ageDays),
      whereToFile: text(cv.where_to_file),
      flags,
    });
  }

  items.sort(
    (a, b) =>
      PHASE_ORDER[a.phase] - PHASE_ORDER[b.phase] ||
      Number(b.flags.includes("inquiry_due")) - Number(a.flags.includes("inquiry_due")) ||
      AGE_ORDER[a.ageLevel] - AGE_ORDER[b.ageLevel] ||
      (b.ageDays ?? -1) - (a.ageDays ?? -1) ||
      a.clientName.localeCompare(b.clientName),
  );

  return { items, doneCount, doneLast30, thresholds: THRESHOLDS };
}
