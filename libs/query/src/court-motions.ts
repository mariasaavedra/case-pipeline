// =============================================================================
// Court Motions Query (P15 → Motions tab)
// =============================================================================
// The Motions board (bond, MTC, MTT, MTWD…), each motion tied to its court case,
// for the Motions tab of P15 and the "motion pending" tags on the Docket and
// Prep Pipeline rows.
//   - phase: where the motion stands, from its Monday group (and status, which
//     wins when it says Granted / Denied / Withdrawn).
//   - waiting motions are aged from Mtn Filed On (60 / 90 days).
//   - flags: things to fix on Monday (no court case, case already closed, no
//     filed date, decided but no judge order).
// See docs/features/court-cases.md.

import type BetterSqlite3 from "better-sqlite3";
type Database = BetterSqlite3.Database;

// =============================================================================
// Types
// =============================================================================

/**
 * - to_send: drafting / to be filed (groups "Motions to be sent", "ATTY BRIEF").
 * - waiting: filed, waiting for the judge.
 * - granted / denied: decided.
 * - closed: not proceeding, withdrawn, parked in North Pole.
 */
export type MotionPhase = "to_send" | "waiting" | "granted" | "denied" | "closed";

/** How long a filed motion has waited for the judge. */
export type MotionAge = "late" | "waiting" | "fresh" | "unknown";

export type MotionFlag = "no_court_case" | "case_closed" | "no_filed_date" | "no_judge_order" | "connect";

export interface CourtMotion {
  localId: string;
  itemName: string;
  /** Motion types as tagged on Monday ("MTC", "BONDMTN"…). */
  types: string[];
  phase: MotionPhase;
  /** The Monday group and status, as they read on the board. */
  group: string | null;
  status: string | null;
  clientName: string;
  clientLocalId: string | null;
  /** The linked court case (any group), null when the motion has none. */
  courtCaseLocalId: string | null;
  /** The linked case is in the active "Court Case" group. */
  courtCaseActive: boolean;
  judge: string | null;
  attorney: string | null;
  paralegals: string[];
  /** YYYY-MM-DD dates from the board. */
  filedOn: string | null;
  decidedOn: string | null;
  /** Days since filed (waiting motions only). */
  daysWaiting: number | null;
  age: MotionAge;
  /** Next hearing of the linked active case, and days to it. */
  hearingDate: string | null;
  daysToHearing: number | null;
  /** Waiting or to send, and the case's hearing is within HEARING_SOON_DAYS. */
  hearingSoon: boolean;
  /** Relief sought (UVisa, VAWA…). */
  relief: string | null;
  flags: MotionFlag[];
}

export interface CourtMotionsOptions {
  /** ISO date to measure from (tests). Default today. */
  today?: string;
  /** Hearing dates of active court cases by local id (from getCourtCases). */
  hearings?: Map<string, string | null>;
}

// =============================================================================
// Constants
// =============================================================================

export const MOTION_LATE_DAYS = 90;
export const MOTION_WAITING_DAYS = 60;
export const HEARING_SOON_DAYS = 14;

const GROUP_PHASE: Record<string, MotionPhase> = {
  "motions to be sent": "to_send",
  "atty brief": "to_send",
  "filed/waiting for ij": "waiting",
  granted: "granted",
  denied: "denied",
  "not proceeding": "closed",
  "north pole": "closed",
};

const OPEN_PHASES = new Set<MotionPhase>(["to_send", "waiting"]);

/** Monday column ids on the Motions board (config/boards.yaml resolves these by id). */
export const MOTION_COLUMN_IDS = {
  status: "project_status",
  filedOn: "date_mkqg8972",
  decidedOn: "date_mkqyjq82",
} as const;

/** The date a status change stamps: Filed → MTN Filed on; Granted / Denied → Dec. Date. */
export function motionDateFieldFor(status: string): "filed_on" | "decided_on" | null {
  if (/^filed$/i.test(status.trim())) return "filed_on";
  if (/^(granted|denied)\b/i.test(status.trim())) return "decided_on";
  return null;
}

export interface MotionWriteSchema {
  /** Every Status label on the Motions board, in board order. Empty = not synced (writes hidden). */
  statusOptions: string[];
}

export function getMotionWriteSchema(db: Database): MotionWriteSchema {
  const row = db
    .prepare("SELECT options FROM board_columns WHERE board_key = 'motions' AND column_id = ?")
    .get(MOTION_COLUMN_IDS.status) as { options: string | null } | undefined;
  try {
    const opts = row?.options ? (JSON.parse(row.options) as { label?: unknown }[]) : [];
    return { statusOptions: opts.map((o) => (typeof o.label === "string" ? o.label.trim() : "")).filter(Boolean) };
  } catch {
    return { statusOptions: [] };
  }
}

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
  if (raw && typeof raw === "object" && "labels" in raw) {
    const ls = (raw as { labels?: unknown }).labels;
    return Array.isArray(ls) ? ls.filter((l): l is string => typeof l === "string" && l.trim() !== "").map((l) => l.trim()) : [];
  }
  const one = label(raw);
  return one ? [one] : [];
}

function text(raw: unknown): string | null {
  if (typeof raw === "number") return String(raw);
  if (typeof raw === "string") return raw.trim() || null;
  if (raw && typeof raw === "object" && "display_value" in raw) return text((raw as { display_value?: unknown }).display_value);
  return null;
}

function dateOf(raw: unknown): string | null {
  const d = raw && typeof raw === "object" ? (raw as { date?: unknown }).date : raw;
  return typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null;
}

function linkedId(raw: unknown): string | null {
  if (raw && typeof raw === "object" && "linked_item_ids" in raw) {
    const ids = (raw as { linked_item_ids?: unknown }).linked_item_ids;
    return Array.isArray(ids) && ids.length > 0 ? String(ids[0]) : null;
  }
  return null;
}

function splitNames(raw: string | null): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(",").map((s) => s.trim()).filter((s) => s && !s.includes("@")))];
}

/** The status wins when it records a decision; otherwise the group says where the motion is. */
export function phaseOf(group: string | null, status: string | null): MotionPhase {
  const s = status ?? "";
  if (/^granted/i.test(s) || /habeas granted/i.test(s)) return "granted";
  if (/^denied/i.test(s)) return "denied";
  if (/withdrawn|not proceeding|turned habeas|north pole/i.test(s)) return "closed";
  return GROUP_PHASE[(group ?? "").trim().toLowerCase()] ?? "to_send";
}

export function motionAgeOf(daysWaiting: number | null): MotionAge {
  if (daysWaiting === null) return "unknown";
  if (daysWaiting >= MOTION_LATE_DAYS) return "late";
  if (daysWaiting >= MOTION_WAITING_DAYS) return "waiting";
  return "fresh";
}

// =============================================================================
// Query
// =============================================================================

interface RawRow {
  localId: string;
  name: string;
  groupTitle: string | null;
  status: string | null;
  clientLocalId: string | null;
  clientName: string | null;
  attorney: string | null;
  paralegals: string | null;
  cv: string;
  caseLocalId: string | null;
  caseGroup: string | null;
  caseClientLocalId: string | null;
  caseClientName: string | null;
}

export function getCourtMotions(db: Database, options: CourtMotionsOptions = {}): CourtMotion[] {
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const hearings = options.hearings ?? new Map<string, string | null>();

  // The court case is joined by its Monday id (the motion's Court Case link).
  const rows = db.prepare(`
    SELECT
      m.local_id        AS localId,
      m.name,
      m.group_title     AS groupTitle,
      m.status,
      p.local_id        AS clientLocalId,
      p.name            AS clientName,
      m.attorney,
      m.paralegals,
      m.column_values   AS cv,
      c.local_id        AS caseLocalId,
      c.group_title     AS caseGroup,
      cp.local_id       AS caseClientLocalId,
      cp.name           AS caseClientName
    FROM board_items m
    LEFT JOIN profiles p ON p.local_id = m.profile_local_id
    LEFT JOIN board_items c
      ON c.board_key = 'court_cases'
     AND c.deleted_at IS NULL
     AND c.monday_item_id = json_extract(m.column_values, '$.court_case.linked_item_ids[0]')
    LEFT JOIN profiles cp ON cp.local_id = c.profile_local_id
    WHERE m.board_key = 'motions' AND m.deleted_at IS NULL
  `).all() as RawRow[];

  const motions = rows.map((r): CourtMotion => {
    let cv: Record<string, unknown> = {};
    try {
      cv = JSON.parse(r.cv) as Record<string, unknown>;
    } catch {
      /* unreadable row: show it with what the columns table has */
    }
    const status = r.status?.trim() || label(cv.status);
    const phase = phaseOf(r.groupTitle, status);
    const open = OPEN_PHASES.has(phase);
    const filedOn = dateOf(cv.mtn_filed_on);
    const decidedOn = dateOf(cv.dec_date);
    const daysWaiting = phase === "waiting" && filedOn ? daysBetween(filedOn, today) : null;

    const courtCaseActive = r.caseGroup === "Court Case";
    const hearingDate = r.caseLocalId && courtCaseActive ? hearings.get(r.caseLocalId) ?? null : null;
    const daysToHearing = hearingDate ? daysBetween(today, hearingDate) : null;

    const flags: MotionFlag[] = [];
    const hasCaseLink = !!linkedId(cv.court_case);
    if (open && !hasCaseLink) flags.push("no_court_case");
    if (open && r.caseLocalId && !courtCaseActive) flags.push("case_closed");
    if (phase === "waiting" && !filedOn) flags.push("no_filed_date");
    if (/no (judge order|jo)\b/i.test(status ?? "")) flags.push("no_judge_order");
    if (/connect profile/i.test(status ?? "") || (open && !r.clientLocalId && !r.caseClientLocalId)) flags.push("connect");

    return {
      localId: r.localId,
      itemName: r.name,
      types: labels(cv.motion),
      phase,
      group: r.groupTitle,
      status,
      clientName: r.clientName ?? r.caseClientName ?? r.name,
      clientLocalId: r.clientLocalId ?? r.caseClientLocalId,
      courtCaseLocalId: r.caseLocalId,
      courtCaseActive,
      judge: text(cv.judge),
      attorney: r.attorney?.trim() || null,
      paralegals: splitNames(r.paralegals),
      filedOn,
      decidedOn,
      daysWaiting,
      age: motionAgeOf(daysWaiting),
      hearingDate,
      daysToHearing,
      hearingSoon: open && daysToHearing !== null && daysToHearing >= 0 && daysToHearing <= HEARING_SOON_DAYS,
      relief: label(cv.relief) ?? text(cv.relief),
      flags,
    };
  });

  // Most pressing first: hearing soon, then longest wait, then soonest hearing.
  motions.sort(
    (a, b) =>
      Number(b.hearingSoon) - Number(a.hearingSoon) ||
      (b.daysWaiting ?? -1) - (a.daysWaiting ?? -1) ||
      (a.daysToHearing ?? Number.MAX_SAFE_INTEGER) - (b.daysToHearing ?? Number.MAX_SAFE_INTEGER) ||
      (b.decidedOn ?? "").localeCompare(a.decidedOn ?? "") ||
      a.clientName.localeCompare(b.clientName),
  );
  return motions;
}
