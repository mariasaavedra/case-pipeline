// =============================================================================
// Court Cases Query (P15)
// =============================================================================
// Active immigration court cases (the Court Cases board's "Court Case" group),
// one row each, for two views over the same data:
//   - Docket: upcoming hearings by week, with judge / method / hearing type.
//   - Prep Pipeline: cases by Case Prep Status, coloured by whether the prep
//     stage is keeping up with the hearing date.
// Each case also carries data-hygiene flags (past hearing date, awaiting a new
// date, no date, profile not connected) so staff can clean the board up.
// See docs/features/court-cases.md.

import type BetterSqlite3 from "better-sqlite3";
type Database = BetterSqlite3.Database;

// =============================================================================
// Types
// =============================================================================

export type HearingKind = "mch" | "trial" | "other";

/**
 * Whether the prep stage is keeping up with the hearing date.
 * - behind: red — the hearing is close and prep hasn't reached the stage it should.
 * - at_risk: yellow — getting close.
 * - on_track: the stage is where it should be (or the hearing is far off).
 * - n_a: no upcoming hearing, or a stage the rule doesn't judge (withdrawals, appeals…).
 */
export type Readiness = "behind" | "at_risk" | "on_track" | "n_a";

export type CourtCaseFlag = "past_hearing" | "awaiting_new_date" | "no_hearing_date" | "connect_profile";

export interface CourtCase {
  localId: string;
  /** The Monday item's own name ("LB - Oscar E. MUNOZ-VILLALOBOS (A213-…)"). */
  itemName: string;
  clientName: string;
  clientLocalId: string | null;
  aNumber: string | null;
  caseNo: string | null;
  /** YYYY-MM-DD, from Calendaring's hearing date (mirrored), else Next Hearing Date. */
  hearingDate: string | null;
  /** HH:MM when Calendaring has one. */
  hearingTime: string | null;
  /** Days from today to the hearing; negative when it has passed. */
  daysToHearing: number | null;
  hearingType: string | null;
  hearingKind: HearingKind;
  hearingStatus: string | null;
  judge: string | null;
  method: string | null;
  /** Method says the hearing still needs a Webex request ("In-Person NEEDS WEBEX"…). */
  needsWebex: boolean;
  detained: boolean;
  attorney: string | null;
  paralegals: string[];
  /** Case Prep Status. Null when not set. */
  prepStage: string | null;
  /** "ECAS" / "eService" — how EOIR serves the case. */
  service: string | null;
  deadlineType: string | null;
  readiness: Readiness;
  flags: CourtCaseFlag[];
}

export interface CourtCasesResult {
  /** Every active court case: dated hearings soonest first, then undated. */
  cases: CourtCase[];
  /** Case Prep Statuses with at least one case, in workflow order. */
  stages: string[];
  /** Every Case Prep Status label the board offers, in workflow order (for the stage picker). */
  stageOptions: string[];
  /** Monday column id of Case Prep Status, when the board schema has synced. */
  stageColumnId: string | null;
  thresholds: ReadinessThresholds;
}

export interface ReadinessThresholds {
  /** Trial within this many days while prep is before stage 3 → behind. */
  trialBehindDays: number;
  /** Trial within this many days while prep is before stage 3 → at risk. */
  trialAtRiskDays: number;
  /** MCH within this many days while still in initial set-up → behind. */
  mchBehindDays: number;
}

export interface CourtCasesOptions extends Partial<ReadinessThresholds> {
  /** ISO date to measure from (tests). Default today. */
  today?: string;
}

// =============================================================================
// Constants
// =============================================================================

export const ACTIVE_COURT_CASE_GROUP = "Court Case";
export const NO_PREP_STAGE = "No stage";
export const PREP_STAGE_COLUMN_TITLE = "Case Prep Status";

const DEFAULT_THRESHOLDS: ReadinessThresholds = { trialBehindDays: 60, trialAtRiskDays: 90, mchBehindDays: 14 };

/** The prep workflow, in order. Labels as they appear on the board (double space included). */
const WORKFLOW_STAGES = [
  "1 - Initial Set Up",
  "1 - DONE - Init. Set Up",
  "2 - MCH Prep",
  "2 - Bond Prep",
  "2 - MCH PREP DONE",
  "MCH Sched. - NEED PAYMENT",
  "TRIAL Sched. - Needs Review - Payment?",
  "SCHED ORDER DEADLINES",
  "3 - Trial Prep",
  "3 - DONE - Trial Prep - READY FOR TRIAL",
  "3 - PAID - AWAITING NEW DATE",
];

/** Side tracks and exceptions, shown after the workflow. */
const EXCEPTION_STAGES = [
  "Look into this",
  "Needs MTNs",
  "Atty Notes - TO DO",
  "Payment History  Log - TO DO",
  "Meeting/Consults/ Appts",
  "T -> MCH",
  "Bonding Out",
  "In Fee Ks",
  "In Court Forms",
  "MTT; MTAC; MTC Pending",
  "MTWD Pending",
  "WD Warning",
  "WD Confirmed",
  "BIA Appeal",
  "No Action Needed",
  "inactive",
];

/** Not yet past initial set-up. An unset stage and "Look into this" count too. */
const SETUP_STAGES = new Set(["1 - Initial Set Up", "Look into this", NO_PREP_STAGE]);

/** Prep has reached trial work. */
const TRIAL_PREP_STAGES = new Set([
  "3 - Trial Prep",
  "3 - DONE - Trial Prep - READY FOR TRIAL",
  "3 - PAID - AWAITING NEW DATE",
]);

/** Stages the readiness rule judges: the workflow, plus "not set" and "Look into this". */
const JUDGED_STAGES = new Set([...WORKFLOW_STAGES, NO_PREP_STAGE, "Look into this"]);

const READINESS_ORDER: Record<Readiness, number> = { behind: 0, at_risk: 1, on_track: 2, n_a: 3 };

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

function text(raw: unknown): string | null {
  if (typeof raw === "number") return String(raw);
  if (typeof raw === "string") return raw.trim() || null;
  if (raw && typeof raw === "object" && "display_value" in raw) return text((raw as { display_value?: unknown }).display_value);
  return null;
}

/**
 * A hearing date as Monday hands it over: a mirror string ("2026-11-24 11:30",
 * sometimes several comma-separated), or a date column ({date, time}).
 * With several, the first one on or after today wins, else the latest.
 */
export function parseHearing(raw: unknown, today: string): { date: string; time: string | null } | null {
  const found: { date: string; time: string | null }[] = [];
  const push = (d: unknown, t: unknown) => {
    if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
      found.push({ date: d, time: typeof t === "string" && /^\d{2}:\d{2}/.test(t) ? t.slice(0, 5) : null });
    }
  };
  if (raw && typeof raw === "object") {
    const o = raw as { date?: unknown; time?: unknown };
    push(o.date, o.time);
  } else if (typeof raw === "string") {
    for (const part of raw.split(",")) {
      const m = part.trim().match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?/);
      if (m) push(m[1], m[2]);
    }
  }
  if (found.length === 0) return null;
  found.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? ""));
  return found.find((h) => h.date >= today) ?? found[found.length - 1]!;
}

function splitNames(raw: string | null): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(",").map((s) => s.trim()).filter((s) => s && !s.includes("@")))];
}

export function hearingKindOf(hearingType: string | null): HearingKind {
  if (!hearingType) return "other";
  if (/trial/i.test(hearingType)) return "trial";
  if (/\bmch\b/i.test(hearingType)) return "mch";
  return "other";
}

/**
 * The readiness rule (defaults agreed 2026-10-01, to be tuned with the attorneys):
 * - Trial within 60 days, prep not yet at stage 3 → behind; within 90 → at risk.
 * - MCH within 14 days, still in initial set-up → behind.
 */
export function readinessOf(
  kind: HearingKind,
  stage: string | null,
  daysToHearing: number | null,
  t: ReadinessThresholds,
): Readiness {
  const s = stage ?? NO_PREP_STAGE;
  if (daysToHearing === null || daysToHearing < 0 || !JUDGED_STAGES.has(s)) return "n_a";
  if (kind === "trial") {
    if (TRIAL_PREP_STAGES.has(s)) return "on_track";
    if (daysToHearing <= t.trialBehindDays) return "behind";
    if (daysToHearing <= t.trialAtRiskDays) return "at_risk";
    return "on_track";
  }
  if (kind === "mch") {
    return SETUP_STAGES.has(s) && daysToHearing <= t.mchBehindDays ? "behind" : "on_track";
  }
  return "n_a";
}

const AWAITING_RE = /awaiting new date/i;

export function stageRank(stage: string): number {
  const w = WORKFLOW_STAGES.indexOf(stage);
  if (w !== -1) return w;
  const e = EXCEPTION_STAGES.indexOf(stage);
  if (e !== -1) return WORKFLOW_STAGES.length + 1 + e;
  if (stage === NO_PREP_STAGE) return Number.MAX_SAFE_INTEGER;
  // Labels added on Monday later sit between the workflow and the exceptions.
  return WORKFLOW_STAGES.length + 0.5;
}

const byStage = (a: string, b: string) => stageRank(a) - stageRank(b) || a.localeCompare(b);

// =============================================================================
// Query
// =============================================================================

interface RawRow {
  localId: string;
  name: string;
  clientLocalId: string | null;
  clientName: string | null;
  attorney: string | null;
  paralegals: string | null;
  nextDate: string | null;
  cv: string;
}

export function getCourtCases(db: Database, options: CourtCasesOptions = {}): CourtCasesResult {
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const thresholds: ReadinessThresholds = {
    trialBehindDays: options.trialBehindDays ?? DEFAULT_THRESHOLDS.trialBehindDays,
    trialAtRiskDays: Math.max(
      options.trialBehindDays ?? DEFAULT_THRESHOLDS.trialBehindDays,
      options.trialAtRiskDays ?? DEFAULT_THRESHOLDS.trialAtRiskDays,
    ),
    mchBehindDays: options.mchBehindDays ?? DEFAULT_THRESHOLDS.mchBehindDays,
  };

  const rows = db.prepare(`
    SELECT
      b.local_id         AS localId,
      b.name,
      p.local_id         AS clientLocalId,
      p.name             AS clientName,
      b.attorney,
      b.paralegals,
      b.next_date        AS nextDate,
      b.column_values    AS cv
    FROM board_items b
    LEFT JOIN profiles p ON p.local_id = b.profile_local_id
    WHERE b.board_key = 'court_cases' AND b.group_title = ? AND b.deleted_at IS NULL
  `).all(ACTIVE_COURT_CASE_GROUP) as RawRow[];

  const cases: CourtCase[] = rows.map((r) => {
    let cv: Record<string, unknown> = {};
    try {
      cv = JSON.parse(r.cv) as Record<string, unknown>;
    } catch {
      /* unreadable row: show it with what the columns table has */
    }
    const hearing = parseHearing(cv.hearing_date_calendaring, today) ?? parseHearing(cv.x_next_hearing_date, today)
      ?? parseHearing(r.nextDate, today);
    const daysToHearing = hearing ? daysBetween(today, hearing.date) : null;
    const hearingType = label(cv.hearing_type);
    const hearingKind = hearingKindOf(hearingType);
    const hearingStatus = label(cv.hearing_status);
    const method = label(cv.method);
    const prepStage = label(cv.case_prep_status);

    const awaiting =
      AWAITING_RE.test(hearingType ?? "") || AWAITING_RE.test(hearingStatus ?? "") ||
      AWAITING_RE.test(r.name) || prepStage === "3 - PAID - AWAITING NEW DATE";
    const flags: CourtCaseFlag[] = [];
    if (awaiting) flags.push("awaiting_new_date");
    else if (!hearing) flags.push("no_hearing_date");
    else if (daysToHearing! < 0) flags.push("past_hearing");
    if (!r.clientLocalId || /connect profile/i.test(hearingStatus ?? "")) flags.push("connect_profile");

    return {
      localId: r.localId,
      itemName: r.name,
      clientName: r.clientName ?? r.name,
      clientLocalId: r.clientLocalId,
      aNumber: text(cv.a_number) ?? text(cv.a_number_profiles),
      caseNo: text(cv.case_no),
      hearingDate: hearing?.date ?? null,
      hearingTime: hearing?.time ?? null,
      daysToHearing,
      hearingType,
      hearingKind,
      hearingStatus,
      judge: text(cv.judge_connected),
      method,
      needsWebex: /needs webex|check if needs webex/i.test(method ?? ""),
      detained: /detained/i.test(hearingType ?? "") || /detained/i.test(method ?? "") || !!text(label(cv.det_facility)),
      attorney: r.attorney?.trim() || null,
      paralegals: splitNames(r.paralegals),
      prepStage,
      service: label(cv.ecas_or_eservice),
      deadlineType: label(cv.deadline_type),
      readiness: awaiting ? "n_a" : readinessOf(hearingKind, prepStage, daysToHearing, thresholds),
      flags,
    };
  });

  // Upcoming hearings soonest first, then past ones (most recent first), then undated.
  const bucket = (c: CourtCase) => (c.daysToHearing === null ? 2 : c.daysToHearing < 0 ? 1 : 0);
  cases.sort(
    (a, b) =>
      bucket(a) - bucket(b) ||
      (bucket(a) === 1
        ? (b.hearingDate ?? "").localeCompare(a.hearingDate ?? "")
        : (a.hearingDate ?? "").localeCompare(b.hearingDate ?? "")) ||
      (a.hearingTime ?? "").localeCompare(b.hearingTime ?? "") ||
      READINESS_ORDER[a.readiness] - READINESS_ORDER[b.readiness] ||
      a.clientName.localeCompare(b.clientName),
  );

  const stages = [...new Set(cases.map((c) => c.prepStage ?? NO_PREP_STAGE))].sort(byStage);

  const col = db
    .prepare("SELECT column_id, options FROM board_columns WHERE board_key = 'court_cases' AND title = ? LIMIT 1")
    .get(PREP_STAGE_COLUMN_TITLE) as { column_id: string; options: string | null } | undefined;
  let stageOptions: string[] = [];
  try {
    const opts = col?.options ? (JSON.parse(col.options) as { label?: unknown }[]) : [];
    stageOptions = opts
      .map((o) => (typeof o.label === "string" ? o.label : ""))
      .filter((l) => l.trim() !== "")
      .sort(byStage);
  } catch {
    stageOptions = [];
  }

  return { cases, stages, stageOptions, stageColumnId: col?.column_id ?? null, thresholds };
}
