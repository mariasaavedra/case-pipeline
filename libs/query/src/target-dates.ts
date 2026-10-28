// =============================================================================
// Target Dates (P24) Query
// =============================================================================
// Every open Open Form by how close its Target date is: overdue, due within 7
// days, within 14, later, and none set. The target date is an internal goal
// the admin sets (a paralegal asks for an extension, an attorney grants it,
// the admin moves the date), so each case also says how often its date has
// moved and who changed it last — from item_events, so a change made straight
// in Monday shows up too.
//
// The case list is P5's (getActiveCases: Open Forms + Court Forms groups);
// North Pole cases with a future return date are counted, not listed. Read by
// GET /api/target-dates and the weekday Slack digest.

import type BetterSqlite3 from "better-sqlite3";
type Database = BetterSqlite3.Database;
import { getActiveCases } from "./active-cases";
import { batchGetItemHistory, dateMoves } from "./item-history";
import { getOpenFormStatuses, withOpenFormDetails, type MyOpenForm } from "./my-cases";
import type { StatusColumnOption } from "./types";

// =============================================================================
// Types
// =============================================================================

export type TargetBucket = "overdue" | "week" | "twoWeeks" | "later" | "none";

/** In the order the page and the digest show them. */
export const TARGET_BUCKETS: readonly TargetBucket[] = ["overdue", "week", "twoWeeks", "later", "none"];

/** Monday column id of the Open Forms "Target Date" (config/boards.yaml). */
export const TARGET_DATE_COLUMN_ID = "date_mkkws221";

export interface TargetDateChange {
  /** ISO timestamp. */
  at: string;
  /** Monday user id; negative = a Monday automation; null = unknown. */
  userId: string | null;
  from: string | null;
  to: string | null;
}

/** P5's case + what the M27 case card needs (E-File, forms dates), so a row opens it. */
export interface TargetDateCase extends MyOpenForm {
  bucket: TargetBucket;
  /** Days from `today` to the target date (negative = overdue), null when none. */
  daysLeft: number | null;
  /** Times the date moved from one day to another (not counting the first 24 h). */
  moves: number;
  /** The last change to the Target date column, if the history saw one. */
  lastChange: TargetDateChange | null;
}

export interface TargetDatesResult {
  today: string;
  cases: TargetDateCase[];
  counts: Record<TargetBucket, number>;
  /** Every paralegal with a case here, for the filter. */
  paralegals: string[];
  /** Parked at the North Pole with a future return date — not listed. */
  snoozedCount: number;
  /** Open Forms Status labels with colors, for the case card's status picker. */
  openFormStatuses: StatusColumnOption[];
}

export interface TargetDatesOptions {
  /** The firm's today (YYYY-MM-DD). Default: today in UTC. */
  today?: string;
  /** For "same day" in the move count. */
  timeZone?: string;
}

// =============================================================================
// Helpers
// =============================================================================

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`) - Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`)) / 86_400_000);
}

export function bucketFor(daysLeft: number | null): TargetBucket {
  if (daysLeft === null) return "none";
  if (daysLeft < 0) return "overdue";
  if (daysLeft <= 7) return "week";
  if (daysLeft <= 14) return "twoWeeks";
  return "later";
}

// =============================================================================
// Query
// =============================================================================

export function getTargetDates(db: Database, options: TargetDatesOptions = {}): TargetDatesResult {
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const active = getActiveCases(db);

  const detailed = withOpenFormDetails(db, active.cases);
  const history = batchGetItemHistory(db, detailed.map((c) => c.mondayItemId).filter((id): id is string => !!id));

  const cases: TargetDateCase[] = detailed.map((c) => {
    const changes = (c.mondayItemId && history.get(c.mondayItemId)) || [];
    const own = changes.filter((h) => h.columnId === TARGET_DATE_COLUMN_ID);
    const last = own[own.length - 1];
    const daysLeft = c.targetDate ? daysBetween(today, c.targetDate) : null;
    return {
      ...c,
      daysLeft,
      bucket: bucketFor(daysLeft),
      moves: dateMoves(changes, TARGET_DATE_COLUMN_ID, options.timeZone).length,
      lastChange: last ? { at: last.changedAt, userId: last.userId, from: last.from, to: last.to } : null,
    };
  });

  // Soonest first (most overdue at the top); no date last, by client.
  cases.sort((a, b) => {
    if (a.daysLeft === null || b.daysLeft === null) {
      if (a.daysLeft !== null) return -1;
      if (b.daysLeft !== null) return 1;
      return a.clientName.localeCompare(b.clientName);
    }
    return a.daysLeft - b.daysLeft;
  });

  const counts = Object.fromEntries(TARGET_BUCKETS.map((b) => [b, 0])) as Record<TargetBucket, number>;
  for (const c of cases) counts[c.bucket]++;

  const byLower = new Map<string, string>();
  for (const n of cases.flatMap((c) => c.assignees)) if (!byLower.has(n.toLowerCase())) byLower.set(n.toLowerCase(), n);
  const paralegals = [...byLower.values()].sort((a, b) => a.localeCompare(b));

  return { today, cases, counts, paralegals, snoozedCount: active.snoozedCount, openFormStatuses: getOpenFormStatuses(db) };
}
