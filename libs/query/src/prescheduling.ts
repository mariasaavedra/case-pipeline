// =============================================================================
// Prescheduling Query
// =============================================================================
// Paid Fee Ks: the client has paid and we are waiting for their documents. Not
// yet an active case (those are Open Forms, see active-cases.ts). Each case is
// scored by how long it has waited since the hire date and flagged when the
// client isn't cooperating (reminder sent, nothing received since).
// See docs/features/prescheduling-and-contracts.md.

import type BetterSqlite3 from "better-sqlite3";
type Database = BetterSqlite3.Database;

// =============================================================================
// Types
// =============================================================================

/** Days since hire: under `waitingDays` = fresh, then waiting, then late. */
export type WaitLevel = "fresh" | "waiting" | "late" | "unknown";

export interface PreschedulingCase {
  localId: string;
  mondayItemId: string | null;
  clientName: string;
  clientLocalId: string | null;
  /** "Contract for…" labels (I-130, Full Packet…). */
  contractFor: string[];
  /** PS Stage (status6__1). Null when not set. */
  psStage: string | null;
  /** Contract Stage (deal_stage), e.g. "E-File opened". */
  contractStage: string | null;
  /** "It will go to…" (status__1): the board the case moves to next. */
  itWillGoTo: string | null;
  hireDate: string | null;
  daysWaiting: number | null;
  waitLevel: WaitLevel;
  reminderSentOn: string | null;
  daysSinceReminder: number | null;
  evidenceReceivedOn: string | null;
  /** Reminder sent `reminderDays`+ days ago and no evidence received since. */
  notCooperating: boolean;
  paralegals: string[];
  attorney: string | null;
  assistant: string | null;
  /** PS Stage is North Pole, whatever the return date. Kept out of the counts. */
  parked: boolean;
  /** Parked with a future return date. */
  snoozed: boolean;
  northPoleUntil: string | null;
}

export interface PreschedulingResult {
  /** Every Paid Fee K, longest wait first. */
  cases: PreschedulingCase[];
  /** PS Stages that have at least one case, in workflow order. */
  stages: string[];
  thresholds: { waitingDays: number; lateDays: number; reminderDays: number };
}

export interface PreschedulingOptions {
  /** Days since hire before a case turns yellow. Default 30. */
  waitingDays?: number;
  /** Days since hire before a case turns red. Default 60. */
  lateDays?: number;
  /** Days after a reminder with no evidence before "not cooperating". Default 14. */
  reminderDays?: number;
  /** ISO date to measure from (tests). Default today. */
  today?: string;
}

// =============================================================================
// Constants
// =============================================================================

export const PAID_FEE_KS_GROUP = "Paid Fee Ks";
const NORTH_POLE_STAGE = "Send to North Pole";
export const NO_STAGE = "No stage";

// Workflow order for the table columns. Labels not listed here (new ones added
// on Monday) follow in alphabetical order, then "No stage".
const STAGE_ORDER = [
  "Need to contact client",
  "Need Evidence",
  "P1 Working on letter",
  "P1 Need Payment for P2",
  "P2 Missing Evid.",
  "P2 Need Payment for P3",
  "Phase 2 Paid",
  "Phase 3 Paid",
  "Evidence Received",
  "Init. Evid. Check DONE",
  "Back from North Pole",
  "Paralegal to be assigned",
  "Ready for Para Confirmation",
  "Para Assigned",
  "Need Attorney Intervention",
  "Completed",
];

const WAIT_ORDER: Record<WaitLevel, number> = { late: 0, waiting: 1, fresh: 2, unknown: 3 };

// =============================================================================
// Helpers
// =============================================================================

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 86_400_000);
}

function splitNames(raw: string | null): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
}

function parseLabels(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const labels: unknown = JSON.parse(raw);
    return Array.isArray(labels) ? labels.filter((l): l is string => typeof l === "string" && l.trim() !== "") : [];
  } catch {
    return [];
  }
}

function stageRank(stage: string): number {
  if (stage === NO_STAGE) return Number.MAX_SAFE_INTEGER;
  const i = STAGE_ORDER.indexOf(stage);
  return i === -1 ? STAGE_ORDER.length : i;
}

// =============================================================================
// Query
// =============================================================================

interface RawRow {
  localId: string;
  mondayItemId: string | null;
  name: string;
  clientLocalId: string | null;
  clientName: string | null;
  psStage: string | null;
  contractStage: string | null;
  itWillGoTo: string | null;
  contractFor: string | null;
  hireDate: string | null;
  reminderSentOn: string | null;
  evidenceReceivedOn: string | null;
  paralegal: string | null;
  attorney: string | null;
  assistant: string | null;
  northPoleUntil: string | null;
}

export function getPrescheduling(db: Database, options: PreschedulingOptions = {}): PreschedulingResult {
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const waitingDays = options.waitingDays ?? 30;
  const lateDays = Math.max(waitingDays, options.lateDays ?? 60);
  const reminderDays = options.reminderDays ?? 14;

  const rows = db.prepare(`
    SELECT
      c.local_id       AS localId,
      c.monday_item_id AS mondayItemId,
      c.name,
      p.local_id       AS clientLocalId,
      p.name           AS clientName,
      json_extract(c.raw_column_values, '$.ps_stage.label')                 AS psStage,
      json_extract(c.raw_column_values, '$.contract_stage.label')           AS contractStage,
      json_extract(c.raw_column_values, '$.it_will_go_to.label')            AS itWillGoTo,
      json_extract(c.raw_column_values, '$.contract_for.labels')            AS contractFor,
      json_extract(c.raw_column_values, '$.hire_date.date')                 AS hireDate,
      json_extract(c.raw_column_values, '$.reminder_sent_checked_on.date')  AS reminderSentOn,
      json_extract(c.raw_column_values, '$.evidence_received_date.date')    AS evidenceReceivedOn,
      json_extract(c.raw_column_values, '$.paralegal.label')                AS paralegal,
      json_extract(c.raw_column_values, '$.attorney.label')                 AS attorney,
      json_extract(c.raw_column_values, '$.assistant.label')                AS assistant,
      json_extract(c.raw_column_values, '$.north_pole_until.date')          AS northPoleUntil
    FROM contracts c
    LEFT JOIN profiles p ON p.local_id = c.profile_local_id
    WHERE c.group_title = ? AND c.deleted_at IS NULL
  `).all(PAID_FEE_KS_GROUP) as RawRow[];

  const cases: PreschedulingCase[] = rows.map((r) => {
    const daysWaiting = r.hireDate ? daysBetween(r.hireDate, today) : null;
    const waitLevel: WaitLevel =
      daysWaiting === null ? "unknown" : daysWaiting >= lateDays ? "late" : daysWaiting >= waitingDays ? "waiting" : "fresh";
    const daysSinceReminder = r.reminderSentOn ? daysBetween(r.reminderSentOn, today) : null;
    // Evidence that arrived before the reminder doesn't answer it.
    const answered = r.evidenceReceivedOn !== null && r.reminderSentOn !== null && r.evidenceReceivedOn >= r.reminderSentOn;
    const parked = r.psStage === NORTH_POLE_STAGE;
    return {
      localId: r.localId,
      mondayItemId: r.mondayItemId,
      clientName: r.clientName ?? r.name,
      clientLocalId: r.clientLocalId,
      contractFor: parseLabels(r.contractFor),
      psStage: r.psStage?.trim() || null,
      contractStage: r.contractStage,
      itWillGoTo: r.itWillGoTo,
      hireDate: r.hireDate,
      daysWaiting,
      waitLevel,
      reminderSentOn: r.reminderSentOn,
      daysSinceReminder,
      evidenceReceivedOn: r.evidenceReceivedOn,
      notCooperating: daysSinceReminder !== null && daysSinceReminder >= reminderDays && !answered,
      paralegals: splitNames(r.paralegal),
      attorney: r.attorney?.trim() || null,
      assistant: r.assistant?.trim() || null,
      parked,
      snoozed: parked && r.northPoleUntil !== null && r.northPoleUntil > today,
      northPoleUntil: parked ? r.northPoleUntil : null,
    };
  });

  cases.sort(
    (a, b) =>
      WAIT_ORDER[a.waitLevel] - WAIT_ORDER[b.waitLevel] ||
      (b.daysWaiting ?? -1) - (a.daysWaiting ?? -1) ||
      a.clientName.localeCompare(b.clientName),
  );

  const stages = [...new Set(cases.filter((c) => !c.parked).map((c) => c.psStage ?? NO_STAGE))].sort(
    (a, b) => stageRank(a) - stageRank(b) || a.localeCompare(b),
  );

  return { cases, stages, thresholds: { waitingDays, lateDays, reminderDays } };
}
