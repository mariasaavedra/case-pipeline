// =============================================================================
// Dashboard KPI Queries
// =============================================================================

import type { Database } from "bun:sqlite";
import type { KpiCard, KpiItem } from "./types";
import { CLOSED_CONTRACT_STATUSES, PAID_CONTRACT_STATUSES } from "./types";
import { getAlerts } from "./alerts";

interface HearingOptions {
  range?: "7d" | "month";
}

/**
 * Get all 5 KPI cards for the landing page dashboard.
 */
export function getDashboardKpis(
  db: Database,
  opts: HearingOptions = {},
): KpiCard[] {
  const today = new Date();
  const todayStr = formatDate(today);

  return [
    getOpenForms(db),
    getPendingContracts(db),
    getPaidFeeKs(db),
    getUpcomingDeadlines(db, todayStr),
    getUpcomingHearings(db, todayStr, opts.range ?? "7d"),
    getAlertsCard(db),
  ];
}

// =============================================================================
// Individual KPI Queries
// =============================================================================

function getOpenForms(db: Database): KpiCard {
  const countRow = db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM board_items
       WHERE board_key = '_cd_open_forms' AND group_title = 'Open Forms'`,
    )
    .get() as { cnt: number };

  const items = db
    .prepare(
      `SELECT
         bi.local_id AS localId,
         bi.name,
         bi.next_date AS date,
         p.name AS clientName,
         p.local_id AS clientLocalId,
         bi.board_key AS boardKey,
         bi.status
       FROM board_items bi
       LEFT JOIN profiles p ON p.local_id = bi.profile_local_id
       WHERE bi.board_key = '_cd_open_forms' AND bi.group_title = 'Open Forms'
       ORDER BY bi.created_at DESC
       LIMIT 5`,
    )
    .all() as KpiItem[];

  return { key: "open_forms", label: "Open Forms", count: countRow.cnt, items };
}

function getPendingContracts(db: Database): KpiCard {
  const closedStatuses = [...CLOSED_CONTRACT_STATUSES];
  const paidStatuses = [...PAID_CONTRACT_STATUSES];
  const excludeStatuses = [...closedStatuses, ...paidStatuses];
  const placeholders = excludeStatuses.map(() => "?").join(",");

  const countRow = db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM contracts
       WHERE status NOT IN (${placeholders})`,
    )
    .get(...excludeStatuses) as { cnt: number };

  const items = db
    .prepare(
      `SELECT
         c.local_id AS localId,
         c.case_type AS name,
         NULL AS date,
         p.name AS clientName,
         p.local_id AS clientLocalId,
         NULL AS boardKey,
         c.status
       FROM contracts c
       LEFT JOIN profiles p ON p.local_id = c.profile_local_id
       WHERE c.status NOT IN (${placeholders})
       ORDER BY c.created_at DESC
       LIMIT 5`,
    )
    .all(...excludeStatuses) as KpiItem[];

  return {
    key: "pending_contracts",
    label: "Pending Contracts",
    count: countRow.cnt,
    items,
  };
}

function getPaidFeeKs(db: Database): KpiCard {
  const statuses = [...PAID_CONTRACT_STATUSES];
  const placeholders = statuses.map(() => "?").join(",");

  const countRow = db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM contracts
       WHERE status IN (${placeholders})`,
    )
    .get(...statuses) as { cnt: number };

  const items = db
    .prepare(
      `SELECT
         c.local_id AS localId,
         c.case_type AS name,
         NULL AS date,
         p.name AS clientName,
         p.local_id AS clientLocalId,
         NULL AS boardKey,
         c.status
       FROM contracts c
       LEFT JOIN profiles p ON p.local_id = c.profile_local_id
       WHERE c.status IN (${placeholders})
       ORDER BY c.created_at DESC
       LIMIT 5`,
    )
    .all(...statuses) as KpiItem[];

  return {
    key: "paid_fee_ks",
    label: "Paid Fee Ks",
    count: countRow.cnt,
    items,
  };
}

function getUpcomingDeadlines(db: Database, todayStr: string): KpiCard {
  const endDate = addDays(todayStr, 7);

  const countRow = db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM board_items
       WHERE next_date >= ? AND next_date <= ?`,
    )
    .get(todayStr, endDate) as { cnt: number };

  const items = db
    .prepare(
      `SELECT
         bi.local_id AS localId,
         bi.name,
         bi.next_date AS date,
         p.name AS clientName,
         p.local_id AS clientLocalId,
         bi.board_key AS boardKey,
         bi.status
       FROM board_items bi
       LEFT JOIN profiles p ON p.local_id = bi.profile_local_id
       WHERE bi.next_date >= ? AND bi.next_date <= ?
       ORDER BY bi.next_date ASC
       LIMIT 5`,
    )
    .all(todayStr, endDate) as KpiItem[];

  return {
    key: "upcoming_deadlines",
    label: "Upcoming Deadlines",
    count: countRow.cnt,
    items,
  };
}

function getUpcomingHearings(
  db: Database,
  todayStr: string,
  range: "7d" | "month",
): KpiCard {
  let endDate: string;
  if (range === "month") {
    // End of current month
    const d = new Date(todayStr);
    endDate = formatDate(
      new Date(d.getFullYear(), d.getMonth() + 1, 0),
    );
  } else {
    endDate = addDays(todayStr, 7);
  }

  const countRow = db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM board_items
       WHERE board_key = 'court_cases' AND next_date >= ? AND next_date <= ?`,
    )
    .get(todayStr, endDate) as { cnt: number };

  const items = db
    .prepare(
      `SELECT
         bi.local_id AS localId,
         bi.name,
         bi.next_date AS date,
         p.name AS clientName,
         p.local_id AS clientLocalId,
         bi.board_key AS boardKey,
         bi.status
       FROM board_items bi
       LEFT JOIN profiles p ON p.local_id = bi.profile_local_id
       WHERE bi.board_key = 'court_cases' AND bi.next_date >= ? AND bi.next_date <= ?
       ORDER BY bi.next_date ASC
       LIMIT 5`,
    )
    .all(todayStr, endDate) as KpiItem[];

  return {
    key: "upcoming_hearings",
    label: "Upcoming Hearings",
    count: countRow.cnt,
    items,
  };
}

function getAlertsCard(db: Database): KpiCard {
  const { groups, totalCount } = getAlerts(db);

  // Flatten top alert items across groups, prioritizing critical > warning > info
  const items: KpiItem[] = [];
  for (const group of groups) {
    for (const item of group.items) {
      if (items.length >= 5) break;
      items.push({
        localId: item.localId,
        name: item.name,
        date: item.date ?? null,
        clientName: item.clientName ?? null,
        clientLocalId: item.clientLocalId ?? null,
        boardKey: item.boardKey ?? null,
        status: item.status ?? null,
      });
    }
    if (items.length >= 5) break;
  }

  return { key: "alerts", label: "Alerts", count: totalCount, items };
}

// =============================================================================
// Helpers
// =============================================================================

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return formatDate(d);
}
