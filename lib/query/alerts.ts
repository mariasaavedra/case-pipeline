// =============================================================================
// Smart Alerts Queries
// =============================================================================

import type { Database } from "bun:sqlite";
import type { AlertsResult, AlertGroup, AlertItem } from "./types";
import {
  CLOSED_BOARD_ITEM_STATUSES,
  APPOINTMENT_BOARD_KEYS,
  PAID_CONTRACT_STATUSES,
} from "./types";

interface AlertOptions {
  attorney?: string;
}

/**
 * Get all alerts grouped by severity, with optional attorney filter.
 */
export function getAlerts(
  db: Database,
  opts: AlertOptions = {},
): AlertsResult {
  const todayStr = formatDate(new Date());
  const groups = [
    getOverdueDeadlines(db, todayStr, opts),
    getStaleCases(db, todayStr, opts),
    getPendingContractsWithoutActivity(db),
  ];
  const totalCount = groups.reduce((sum, g) => sum + g.count, 0);
  const attorneys = getAlertAttorneys(db, todayStr);
  return { groups, totalCount, attorneys };
}

/**
 * Lightweight count-only for KPI card on landing page.
 */
export function getAlertsTotalCount(db: Database): number {
  const todayStr = formatDate(new Date());

  const closedStatuses = [...CLOSED_BOARD_ITEM_STATUSES];
  const closedPh = closedStatuses.map(() => "?").join(",");
  const apptKeys = [...APPOINTMENT_BOARD_KEYS];
  const apptPh = apptKeys.map(() => "?").join(",");
  const paidStatuses = [...PAID_CONTRACT_STATUSES];
  const paidPh = paidStatuses.map(() => "?").join(",");

  const overdue = db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM board_items
       WHERE next_date < ? AND next_date IS NOT NULL
         AND status NOT IN (${closedPh})
         AND board_key NOT IN (${apptPh})`,
    )
    .get(todayStr, ...closedStatuses, ...apptKeys) as { cnt: number };

  const staleDate = addDays(todayStr, -30);
  const stale = db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM board_items bi
       WHERE bi.status NOT IN (${closedPh})
         AND bi.board_key NOT IN (${apptPh})
         AND bi.next_date IS NOT NULL
         AND bi.next_date >= ?
         AND NOT EXISTS (
           SELECT 1 FROM client_updates cu
           WHERE cu.profile_local_id = bi.profile_local_id
             AND cu.created_at_source > ?
         )`,
    )
    .get(...closedStatuses, ...apptKeys, todayStr, staleDate) as {
      cnt: number;
    };

  const pending = db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM contracts c
       WHERE c.status IN (${paidPh})
         AND NOT EXISTS (
           SELECT 1 FROM board_items bi
           WHERE bi.profile_local_id = c.profile_local_id
             AND bi.status NOT IN (${closedPh})
             AND bi.board_key NOT IN (${apptPh})
         )`,
    )
    .get(...paidStatuses, ...closedStatuses, ...apptKeys) as { cnt: number };

  return overdue.cnt + stale.cnt + pending.cnt;
}

// =============================================================================
// Individual Alert Queries
// =============================================================================

function getOverdueDeadlines(
  db: Database,
  todayStr: string,
  opts: AlertOptions,
): AlertGroup {
  const closedStatuses = [...CLOSED_BOARD_ITEM_STATUSES];
  const closedPh = closedStatuses.map(() => "?").join(",");
  const apptKeys = [...APPOINTMENT_BOARD_KEYS];
  const apptPh = apptKeys.map(() => "?").join(",");

  const attorneyClause = opts.attorney ? "AND bi.attorney = ?" : "";
  const attorneyParams = opts.attorney ? [opts.attorney] : [];

  const countRow = db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM board_items bi
       WHERE bi.next_date < ? AND bi.next_date IS NOT NULL
         AND bi.status NOT IN (${closedPh})
         AND bi.board_key NOT IN (${apptPh})
         ${attorneyClause}`,
    )
    .get(todayStr, ...closedStatuses, ...apptKeys, ...attorneyParams) as {
      cnt: number;
    };

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
       WHERE bi.next_date < ? AND bi.next_date IS NOT NULL
         AND bi.status NOT IN (${closedPh})
         AND bi.board_key NOT IN (${apptPh})
         ${attorneyClause}
       ORDER BY daysOverdue DESC
       LIMIT 50`,
    )
    .all(
      todayStr,
      todayStr,
      ...closedStatuses,
      ...apptKeys,
      ...attorneyParams,
    ) as AlertItem[];

  return {
    severity: "critical",
    label: "Overdue Deadlines",
    description: "Items with deadlines that have passed",
    count: countRow.cnt,
    items,
  };
}

function getStaleCases(
  db: Database,
  todayStr: string,
  opts: AlertOptions,
): AlertGroup {
  const closedStatuses = [...CLOSED_BOARD_ITEM_STATUSES];
  const closedPh = closedStatuses.map(() => "?").join(",");
  const apptKeys = [...APPOINTMENT_BOARD_KEYS];
  const apptPh = apptKeys.map(() => "?").join(",");
  const staleDate = addDays(todayStr, -30);

  const attorneyClause = opts.attorney ? "AND bi.attorney = ?" : "";
  const attorneyParams = opts.attorney ? [opts.attorney] : [];

  // Stale = active board items (not overdue) where the profile has no updates in 30+ days
  const countRow = db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM board_items bi
       WHERE bi.status NOT IN (${closedPh})
         AND bi.board_key NOT IN (${apptPh})
         AND bi.next_date IS NOT NULL
         AND bi.next_date >= ?
         AND NOT EXISTS (
           SELECT 1 FROM client_updates cu
           WHERE cu.profile_local_id = bi.profile_local_id
             AND cu.created_at_source > ?
         )
         ${attorneyClause}`,
    )
    .get(
      ...closedStatuses,
      ...apptKeys,
      todayStr,
      staleDate,
      ...attorneyParams,
    ) as { cnt: number };

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
       WHERE bi.status NOT IN (${closedPh})
         AND bi.board_key NOT IN (${apptPh})
         AND bi.next_date IS NOT NULL
         AND bi.next_date >= ?
         AND NOT EXISTS (
           SELECT 1 FROM client_updates cu
           WHERE cu.profile_local_id = bi.profile_local_id
             AND cu.created_at_source > ?
         )
         ${attorneyClause}
       ORDER BY daysSinceUpdate DESC
       LIMIT 50`,
    )
    .all(
      todayStr,
      ...closedStatuses,
      ...apptKeys,
      todayStr,
      staleDate,
      ...attorneyParams,
    ) as AlertItem[];

  return {
    severity: "warning",
    label: "Stale Cases",
    description: "No updates in 30+ days",
    count: countRow.cnt,
    items,
  };
}

function getPendingContractsWithoutActivity(db: Database): AlertGroup {
  const paidStatuses = [...PAID_CONTRACT_STATUSES];
  const paidPh = paidStatuses.map(() => "?").join(",");
  const closedStatuses = [...CLOSED_BOARD_ITEM_STATUSES];
  const closedPh = closedStatuses.map(() => "?").join(",");
  const apptKeys = [...APPOINTMENT_BOARD_KEYS];
  const apptPh = apptKeys.map(() => "?").join(",");

  const countRow = db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM contracts c
       WHERE c.status IN (${paidPh})
         AND NOT EXISTS (
           SELECT 1 FROM board_items bi
           WHERE bi.profile_local_id = c.profile_local_id
             AND bi.status NOT IN (${closedPh})
             AND bi.board_key NOT IN (${apptPh})
         )`,
    )
    .get(...paidStatuses, ...closedStatuses, ...apptKeys) as { cnt: number };

  const items = db
    .prepare(
      `SELECT
         c.local_id AS localId,
         c.case_type AS name,
         NULL AS boardKey,
         c.status,
         p.name AS clientName,
         p.local_id AS clientLocalId,
         NULL AS attorney,
         c.created_at AS date,
         c.case_type AS caseType
       FROM contracts c
       LEFT JOIN profiles p ON p.local_id = c.profile_local_id
       WHERE c.status IN (${paidPh})
         AND NOT EXISTS (
           SELECT 1 FROM board_items bi
           WHERE bi.profile_local_id = c.profile_local_id
             AND bi.status NOT IN (${closedPh})
             AND bi.board_key NOT IN (${apptPh})
         )
       ORDER BY c.created_at ASC
       LIMIT 50`,
    )
    .all(...paidStatuses, ...closedStatuses, ...apptKeys) as AlertItem[];

  return {
    severity: "info",
    label: "Pending Contracts",
    description: "Paid contracts with no active case work",
    count: countRow.cnt,
    items,
  };
}

// =============================================================================
// Helpers
// =============================================================================

function getAlertAttorneys(db: Database, todayStr: string): string[] {
  const closedStatuses = [...CLOSED_BOARD_ITEM_STATUSES];
  const closedPh = closedStatuses.map(() => "?").join(",");
  const apptKeys = [...APPOINTMENT_BOARD_KEYS];
  const apptPh = apptKeys.map(() => "?").join(",");

  const rows = db
    .prepare(
      `SELECT DISTINCT bi.attorney FROM board_items bi
       WHERE bi.attorney IS NOT NULL
         AND bi.status NOT IN (${closedPh})
         AND bi.board_key NOT IN (${apptPh})
         AND (
           (bi.next_date < ? AND bi.next_date IS NOT NULL)
           OR bi.next_date >= ?
         )
       ORDER BY bi.attorney`,
    )
    .all(...closedStatuses, ...apptKeys, todayStr, todayStr) as {
      attorney: string;
    }[];

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
