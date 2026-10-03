// =============================================================================
// Smart Alerts Queries
// =============================================================================

import type BetterSqlite3 from "better-sqlite3";
type Database = BetterSqlite3.Database;
import type { AlertsResult, AlertGroup, AlertItem } from "./types";
import { getMailReviewAlertGroup, countMailToReview } from "./mail-review";
import { getAppealDeadlineAlertGroup, getAppealDeadlineItems } from "./appeal-deadlines";
import { getI918bAlertGroups, countI918bAlerts } from "./u-visa-certifications";
import { CLOSED_BOARD_ITEM_STATUSES } from "./types";

interface AlertOptions {
  attorney?: string;
}

/**
 * Boards whose `next_date` is a real deadline, each with the statuses (on top of
 * the generic closed set) that mean the work behind that deadline is finished.
 *
 * Only these boards raise deadline alerts. The rest carry history in that slot,
 * not a deadline: Notices (date received), Address Changes (date sent), Jail
 * Intakes and appointments (consult date) — all in the past by design, so every
 * row read as "overdue" forever. Statuses match case-insensitively: the boards
 * spell "Sent Out" three ways. A row with no status never alerts.
 *
 * The I-918B board isn't here: its date is the hire due date, which kept
 * alerting after the I-918 was filed. u-visa-certifications.ts alerts on the
 * certification's expiry instead, and skips filed ones.
 */
export const DEADLINE_BOARDS: Readonly<Record<string, readonly string[]>> = {
  _cd_open_forms: ["Sent Out", "Interview done", "Denied", "Not going forward", "Send to North Pole", "To close"],
  rfes_all: ["Sent out"],
  appeals: ["Submitted"],
  court_cases: [],
  motions: [],
  litigation: [],
};

/**
 * Get all alerts grouped by severity, with optional attorney filter.
 */
export function getAlerts(
  db: Database,
  opts: AlertOptions = {},
): AlertsResult {
  const todayStr = formatDate(new Date());
  const groups = [
    getAppealDeadlineAlertGroup(db, opts),
    ...getI918bAlertGroups(db, opts),
    getOverdueDeadlines(db, todayStr, opts),
    getStaleCases(db, todayStr, opts),
    getMailReviewAlertGroup(db, opts),
  ];
  const totalCount = groups.reduce((sum, g) => sum + g.count, 0);
  const attorneys = getAlertAttorneys(db);
  return { groups, totalCount, attorneys };
}

/**
 * Lightweight count-only for KPI card on landing page.
 */
export function getAlertsTotalCount(db: Database): number {
  const todayStr = formatDate(new Date());
  return (
    countOverdue(db, todayStr, {}) +
    countStale(db, todayStr, {}) +
    countMailToReview(db) +
    getAppealDeadlineItems(db).length +
    countI918bAlerts(db)
  );
}

// =============================================================================
// Individual Alert Queries
// =============================================================================

/** SQL (alias `bi`) for "an open item on a deadline board", with its params. */
function openDeadlineScope(): { sql: string; params: string[] } {
  const parts: string[] = [];
  const params: string[] = [];
  for (const [boardKey, doneStatuses] of Object.entries(DEADLINE_BOARDS)) {
    const done = [...CLOSED_BOARD_ITEM_STATUSES, ...doneStatuses].map((s) => s.toLowerCase());
    parts.push(`(bi.board_key = ? AND lower(bi.status) NOT IN (${done.map(() => "?").join(",")}))`);
    params.push(boardKey, ...done);
  }
  return { sql: `(${parts.join(" OR ")}) AND bi.deleted_at IS NULL`, params };
}

function attorneyFilter(opts: AlertOptions): { sql: string; params: string[] } {
  return opts.attorney
    ? { sql: "AND bi.attorney = ?", params: [opts.attorney] }
    : { sql: "", params: [] };
}

function overdueWhere(todayStr: string, opts: AlertOptions): { sql: string; params: string[] } {
  const scope = openDeadlineScope();
  const atty = attorneyFilter(opts);
  return {
    sql: `${scope.sql} AND bi.next_date IS NOT NULL AND bi.next_date < ? ${atty.sql}`,
    params: [...scope.params, todayStr, ...atty.params],
  };
}

function countOverdue(db: Database, todayStr: string, opts: AlertOptions): number {
  const where = overdueWhere(todayStr, opts);
  const row = db
    .prepare(`SELECT COUNT(*) AS cnt FROM board_items bi WHERE ${where.sql}`)
    .get(...where.params) as { cnt: number };
  return row.cnt;
}

function getOverdueDeadlines(
  db: Database,
  todayStr: string,
  opts: AlertOptions,
): AlertGroup {
  const where = overdueWhere(todayStr, opts);

  // Most recently overdue first: what slipped this week is what someone can
  // still act on; a deadline missed a year ago is a cleanup task, not an alert.
  const items = db
    .prepare(
      `SELECT
         bi.local_id AS localId,
         bi.name,
         bi.board_key AS boardKey,
         bi.status,
         p.name AS clientName,
         p.local_id AS clientLocalId,
         bi.attorney,
         bi.next_date AS date,
         CAST(julianday(?) - julianday(bi.next_date) AS INTEGER) AS daysOverdue
       FROM board_items bi
       LEFT JOIN profiles p ON p.local_id = bi.profile_local_id
       WHERE ${where.sql}
       ORDER BY bi.next_date DESC
       LIMIT 50`,
    )
    .all(todayStr, ...where.params) as AlertItem[];

  return {
    severity: "critical",
    label: "Overdue Deadlines",
    description: "Items with deadlines that have passed",
    count: countOverdue(db, todayStr, opts),
    items,
  };
}

// Stale = an open deadline still ahead, on a client with no updates in 30+ days.
function staleWhere(todayStr: string, opts: AlertOptions): { sql: string; params: string[] } {
  const scope = openDeadlineScope();
  const atty = attorneyFilter(opts);
  return {
    sql: `${scope.sql}
         AND bi.next_date IS NOT NULL
         AND bi.next_date >= ?
         AND NOT EXISTS (
           SELECT 1 FROM client_updates cu
           WHERE cu.profile_local_id = bi.profile_local_id
             AND cu.created_at_source > ?
         )
         ${atty.sql}`,
    params: [...scope.params, todayStr, addDays(todayStr, -30), ...atty.params],
  };
}

function countStale(db: Database, todayStr: string, opts: AlertOptions): number {
  const where = staleWhere(todayStr, opts);
  const row = db
    .prepare(`SELECT COUNT(*) AS cnt FROM board_items bi WHERE ${where.sql}`)
    .get(...where.params) as { cnt: number };
  return row.cnt;
}

function getStaleCases(
  db: Database,
  todayStr: string,
  opts: AlertOptions,
): AlertGroup {
  const where = staleWhere(todayStr, opts);
  const items = db
    .prepare(
      `SELECT
         bi.local_id AS localId,
         bi.name,
         bi.board_key AS boardKey,
         bi.status,
         p.name AS clientName,
         p.local_id AS clientLocalId,
         bi.attorney,
         bi.next_date AS date,
         CAST(julianday(?) - julianday(COALESCE(
           (SELECT MAX(cu.created_at_source) FROM client_updates cu
            WHERE cu.profile_local_id = bi.profile_local_id),
           bi.created_at
         )) AS INTEGER) AS daysSinceUpdate
       FROM board_items bi
       LEFT JOIN profiles p ON p.local_id = bi.profile_local_id
       WHERE ${where.sql}
       ORDER BY daysSinceUpdate DESC
       LIMIT 50`,
    )
    .all(todayStr, ...where.params) as AlertItem[];

  return {
    severity: "warning",
    label: "Stale Cases",
    description: "No updates in 30+ days",
    count: countStale(db, todayStr, opts),
    items,
  };
}

// =============================================================================
// Helpers
// =============================================================================

/** Attorneys with at least one open deadline item, for the filter dropdown. */
function getAlertAttorneys(db: Database): string[] {
  const scope = openDeadlineScope();
  const rows = db
    .prepare(
      `SELECT DISTINCT bi.attorney FROM board_items bi
       WHERE bi.attorney IS NOT NULL
         AND bi.next_date IS NOT NULL
         AND ${scope.sql}
       ORDER BY bi.attorney`,
    )
    .all(...scope.params) as { attorney: string }[];

  return rows.map((r) => r.attorney);
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return formatDate(d);
}
