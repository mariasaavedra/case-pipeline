// =============================================================================
// Appeal & Federal Deadlines (Alerts group)
// =============================================================================
// Deadlines that can't be missed and that no board's `next_date` carries:
//   1. Removal orders: a court case marked "REMOVED - Appealing?" (or "Ordered
//      Removed" in the last 30 days) with no appeal filed. A BIA appeal is due
//      30 days after the judge's decision. The decision date is read from the
//      item name ("[ORDERED REMOVED 9/17/26]"), else the last hearing date.
//   2. Appeals board: Appeal Due with no Appeal Filed On; Brief Sched. Due with
//      no Brief Filed On.
//   3. Litigation: a federal due date within the next 14 days (overdue ones are
//      already in Overdue Deadlines).

import type BetterSqlite3 from "better-sqlite3";
type Database = BetterSqlite3.Database;
import type { AlertGroup, AlertItem } from "./types";

export const BIA_APPEAL_DAYS = 30;
/** Appeals board deadlines show from this many days ahead… */
export const APPEAL_LOOKAHEAD_DAYS = 30;
/** …and stay listed this many days after they pass. */
export const APPEAL_LOOKBACK_DAYS = 30;
export const LITIGATION_LOOKAHEAD_DAYS = 14;

const APPEALING_STATUS = "removed - appealing?";
const ORDERED_REMOVED_STATUS = "ordered removed";
const LITIGATION_CLOSED = new Set(["dismissed", "granted", "denied"]);
const APPEAL_NOT_HIRED = /did not hire|no hire/i;

interface Options {
  attorney?: string;
  /** ISO date to measure from (tests). Default today. */
  today?: string;
}

interface Row {
  localId: string;
  name: string;
  boardKey: string;
  status: string | null;
  clientName: string | null;
  clientLocalId: string | null;
  attorney: string | null;
  cv: string;
}

// =============================================================================
// Helpers
// =============================================================================

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((new Date(`${toIso}T00:00:00Z`).getTime() - new Date(`${fromIso}T00:00:00Z`).getTime()) / 86_400_000);
}

function label(raw: unknown): string | null {
  if (raw && typeof raw === "object" && "label" in raw) {
    const l = (raw as { label?: unknown }).label;
    return typeof l === "string" && l.trim() !== "" ? l.trim() : null;
  }
  return null;
}

function dateOf(raw: unknown): string | null {
  const d = raw && typeof raw === "object" ? (raw as { date?: unknown }).date : raw;
  return typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null;
}

function formatShort(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** "[ORDERED REMOVED 9/17/26]" → 2026-09-17. The first dated one wins. */
export function removalDateFromName(name: string): string | null {
  const m = name.match(/ORDERED\s+REMOVED\s+(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i);
  if (!m) return null;
  const year = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const iso = `${year}-${m[1]!.padStart(2, "0")}-${m[2]!.padStart(2, "0")}`;
  return Number.isNaN(new Date(iso).getTime()) ? null : iso;
}

/** The latest hearing on or before today, from Calendaring's mirrored "YYYY-MM-DD HH:MM, …". */
export function lastHearingOnOrBefore(raw: unknown, today: string): string | null {
  if (typeof raw !== "string") return dateOf(raw);
  const dates = raw
    .split(",")
    .map((p) => p.trim().slice(0, 10))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= today)
    .sort();
  return dates.at(-1) ?? null;
}

function toItem(r: Row, due: string | null, today: string, detail: string): AlertItem {
  const item: AlertItem = {
    localId: r.localId,
    name: r.name,
    boardKey: r.boardKey,
    status: r.status,
    clientName: r.clientName,
    clientLocalId: r.clientLocalId,
    attorney: r.attorney,
    date: due,
    detail,
  };
  if (due) {
    const left = daysBetween(today, due);
    if (left < 0) item.daysOverdue = -left;
    else item.daysLeft = left;
  }
  return item;
}

function rowsFor(db: Database, boardKey: string, opts: Options): Row[] {
  return db
    .prepare(
      `SELECT bi.local_id AS localId, bi.name, bi.board_key AS boardKey, bi.status,
              p.name AS clientName, p.local_id AS clientLocalId, bi.attorney, bi.column_values AS cv
       FROM board_items bi
       LEFT JOIN profiles p ON p.local_id = bi.profile_local_id
       WHERE bi.board_key = ? AND bi.deleted_at IS NULL ${opts.attorney ? "AND bi.attorney = ?" : ""}`,
    )
    .all(boardKey, ...(opts.attorney ? [opts.attorney] : [])) as Row[];
}

function parse(cv: string): Record<string, unknown> {
  try {
    return JSON.parse(cv) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// =============================================================================
// Rules
// =============================================================================

function removalOrders(db: Database, today: string, opts: Options): AlertItem[] {
  const items: AlertItem[] = [];
  for (const r of rowsFor(db, "court_cases", opts)) {
    const cv = parse(r.cv);
    const hearingStatus = (label(cv.hearing_status) ?? "").toLowerCase();
    if (hearingStatus !== APPEALING_STATUS && hearingStatus !== ORDERED_REMOVED_STATUS) continue;
    if (/appeal\s+filed/i.test(r.name)) continue;

    const fromName = removalDateFromName(r.name);
    const decided = fromName ?? lastHearingOnOrBefore(cv.hearing_date_calendaring, today);
    const due = decided ? addDays(decided, BIA_APPEAL_DAYS) : null;
    // "Ordered Removed" is the settled state: only alert while the clock is still running.
    if (hearingStatus === ORDERED_REMOVED_STATUS && (!due || due < today)) continue;

    const parts = [
      decided
        ? `BIA appeal due ${formatShort(due!)}: removed ${formatShort(decided)}${fromName ? "" : " (last hearing date)"}`
        : "BIA appeal: no removal date on the case. Add it to the item name or the hearing date",
    ];
    if (/recon/i.test(r.name)) parts.push("motion to reconsider filed");
    if (/no\s+jo\b/i.test(r.name)) parts.push("no judge order yet");
    items.push(toItem({ ...r, status: label(cv.hearing_status) }, due, today, parts.join(" · ")));
  }
  return items;
}

function appealsBoard(db: Database, today: string, opts: Options): AlertItem[] {
  const from = addDays(today, -APPEAL_LOOKBACK_DAYS);
  const to = addDays(today, APPEAL_LOOKAHEAD_DAYS);
  const items: AlertItem[] = [];
  for (const r of rowsFor(db, "appeals", opts)) {
    const cv = parse(r.cv);
    if (APPEAL_NOT_HIRED.test(r.status ?? "") || APPEAL_NOT_HIRED.test(label(cv.case_status) ?? "")) continue;
    const appealDue = dateOf(cv.appeal_due);
    const briefDue = dateOf(cv.brief_sched_due);
    if (appealDue && !dateOf(cv.appeal_filed_on) && appealDue >= from && appealDue <= to) {
      items.push(toItem(r, appealDue, today, `Appeal due ${formatShort(appealDue)}, not filed yet`));
    } else if (briefDue && !dateOf(cv.brief_filed_on) && !dateOf(cv.bia_decision_date) && briefDue >= from && briefDue <= to) {
      items.push(toItem(r, briefDue, today, `BIA brief due ${formatShort(briefDue)}, not filed yet`));
    }
  }
  return items;
}

function litigation(db: Database, today: string, opts: Options): AlertItem[] {
  const to = addDays(today, LITIGATION_LOOKAHEAD_DAYS);
  const items: AlertItem[] = [];
  for (const r of rowsFor(db, "litigation", opts)) {
    const cv = parse(r.cv);
    if (LITIGATION_CLOSED.has((label(cv.status_of_complaint) ?? "").toLowerCase())) continue;
    const due = dateOf(cv.due_date);
    if (!due || due < today || due > to) continue;
    const work = typeof cv.work_due === "string" && cv.work_due.trim() ? cv.work_due.trim() : "Federal filing";
    items.push(toItem({ ...r, status: label(cv.status_of_complaint) }, due, today, `${work} due ${formatShort(due)}`));
  }
  return items;
}

// =============================================================================
// Group
// =============================================================================

export function getAppealDeadlineItems(db: Database, opts: Options = {}): AlertItem[] {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const items = [...removalOrders(db, today, opts), ...appealsBoard(db, today, opts), ...litigation(db, today, opts)];
  // Soonest deadline first (passed ones lead); undated last.
  return items.sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999") || a.name.localeCompare(b.name));
}

export function getAppealDeadlineAlertGroup(db: Database, opts: Options = {}): AlertGroup {
  const items = getAppealDeadlineItems(db, opts);
  return {
    severity: "critical",
    label: "Appeal & Federal Deadlines",
    description: `BIA appeals (${BIA_APPEAL_DAYS} days from a removal order), Appeals board due dates, federal litigation due within ${LITIGATION_LOOKAHEAD_DAYS} days`,
    count: items.length,
    items,
  };
}
