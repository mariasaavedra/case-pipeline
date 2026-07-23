// =============================================================================
// Dashboard KPI Queries
// =============================================================================
// Each card is declared once as a CardSpec (projection + WHERE + ORDER). The
// dashboard read (count + 5-row preview) and the "show me everything" detail
// read share that spec, so the number on the card can never disagree with the
// list behind it.
// =============================================================================

import type BetterSqlite3 from "better-sqlite3";
type Database = BetterSqlite3.Database;
import type {
  KpiCard,
  KpiCardDetail,
  KpiColumnOption,
  KpiDetailItem,
  KpiItem,
} from "./types";
import { getAlerts } from "./alerts";

interface DashboardOptions {
  range?: "7d" | "month";
  /**
   * Which board column each card surfaces on its rows, keyed by card key.
   * Resolved upstream from the user's preference falling back to the firm-wide
   * default; anything missing leaves the card's column value empty.
   */
  columnSelections?: Record<string, string>;
}

/** How many rows each card previews on the dashboard itself. */
const PREVIEW_LIMIT = 5;

/**
 * The status the team uses to park a case. Open Forms cases marked this way are
 * out of the picture until someone pulls them back, so they are excluded from
 * the Open Forms card entirely — count and list alike.
 *
 * NOTE: the Active Cases board (libs/query/src/active-cases.ts) hides a parked
 * case only while its north_pole_until return date is still in the future. This
 * card is deliberately stricter: it is a "what needs attention" counter, not a
 * work board.
 */
const NORTH_POLE_STATUS = "Send to North Pole";

// =============================================================================
// Card specs
// =============================================================================

/** Board-item projection. `columnValuesJson` carries the raw Monday column blob. */
const BOARD_ITEM_SOURCE = `
  SELECT
    bi.local_id AS localId,
    bi.name,
    bi.next_date AS date,
    p.name AS clientName,
    p.local_id AS clientLocalId,
    bi.board_key AS boardKey,
    bi.status,
    bi.column_values AS columnValuesJson
  FROM board_items bi
  LEFT JOIN profiles p ON p.local_id = bi.profile_local_id`;

const BOARD_ITEM_COUNT_SOURCE = `SELECT COUNT(*) AS cnt FROM board_items bi`;

/** Contract projection — contracts have no next_date, so `date` is always NULL. */
const CONTRACT_SOURCE = `
  SELECT
    c.local_id AS localId,
    c.case_type AS name,
    NULL AS date,
    p.name AS clientName,
    p.local_id AS clientLocalId,
    NULL AS boardKey,
    c.status,
    c.raw_column_values AS columnValuesJson
  FROM contracts c
  LEFT JOIN profiles p ON p.local_id = c.profile_local_id`;

const CONTRACT_COUNT_SOURCE = `SELECT COUNT(*) AS cnt FROM contracts c`;

interface CardSpec {
  key: string;
  label: string;
  source: string;
  countSource: string;
  where: string;
  order: string;
  params: unknown[];
}

function buildCardSpecs(todayStr: string, range: "7d" | "month"): CardSpec[] {
  const weekEnd = addDays(todayStr, 6);

  return [
    {
      key: "open_forms",
      label: "Open Forms",
      source: BOARD_ITEM_SOURCE,
      countSource: BOARD_ITEM_COUNT_SOURCE,
      where: `bi.board_key = '_cd_open_forms'
              AND bi.group_title = 'Open Forms'
              AND COALESCE(bi.status, '') <> ?`,
      order: "bi.created_at DESC",
      params: [NORTH_POLE_STATUS],
    },
    {
      key: "pending_contracts",
      label: "Pending Contracts",
      source: CONTRACT_SOURCE,
      countSource: CONTRACT_COUNT_SOURCE,
      where: `c.group_title = 'Pending Fee Ks'`,
      order: "c.created_at DESC",
      params: [],
    },
    {
      key: "paid_fee_ks",
      label: "Prescheduling",
      source: CONTRACT_SOURCE,
      countSource: CONTRACT_COUNT_SOURCE,
      where: `c.group_title = 'Paid Fee Ks'`,
      order: "c.created_at DESC",
      params: [],
    },
    {
      key: "upcoming_deadlines",
      label: "Upcoming Deadlines",
      source: BOARD_ITEM_SOURCE,
      countSource: BOARD_ITEM_COUNT_SOURCE,
      where: `bi.next_date >= ? AND bi.next_date <= ?`,
      order: "bi.next_date ASC",
      params: [todayStr, weekEnd],
    },
    {
      key: "upcoming_hearings",
      label: "Upcoming Hearings",
      source: BOARD_ITEM_SOURCE,
      countSource: BOARD_ITEM_COUNT_SOURCE,
      where: `bi.board_key = 'court_cases' AND bi.next_date >= ? AND bi.next_date <= ?`,
      order: "bi.next_date ASC",
      params: [todayStr, range === "month" ? endOfMonth(todayStr) : weekEnd],
    },
  ];
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Get all 6 KPI cards for the landing page dashboard.
 */
export function getDashboardKpis(
  db: Database,
  opts: DashboardOptions = {},
): KpiCard[] {
  const todayStr = formatDate(new Date());
  const selections = opts.columnSelections ?? {};

  const cards = buildCardSpecs(todayStr, opts.range ?? "7d").map((spec) => {
    const columnId = selections[spec.key] ?? null;
    const rows = runCardQuery(db, spec, PREVIEW_LIMIT);
    return {
      key: spec.key,
      label: spec.label,
      count: countCard(db, spec),
      columnId,
      columnLabel: columnId ? humanizeColumnKey(columnId) : null,
      items: rows.map((row) => toKpiItem(row, columnId)),
    };
  });

  cards.push(getAlertsCard(db));
  return cards;
}

/**
 * Every row behind a KPI card, plus the board columns available to display on
 * them. Powers the click-through modal on the dashboard.
 */
export function getKpiCardDetail(
  db: Database,
  key: string,
  opts: DashboardOptions = {},
): KpiCardDetail | null {
  const todayStr = formatDate(new Date());
  const columnId = opts.columnSelections?.[key] ?? null;

  if (key === "alerts") {
    const items = getAlertsCard(db, Number.MAX_SAFE_INTEGER).items;
    return {
      key: "alerts",
      label: "Alerts",
      count: items.length,
      columnId: null,
      columnLabel: null,
      // Alerts are stitched together from several boards and contracts, so
      // there is no single column set that applies to every row.
      columns: [],
      items: items.map((item) => ({ ...item, columnValues: {} })),
    };
  }

  const spec = buildCardSpecs(todayStr, opts.range ?? "7d").find((s) => s.key === key);
  if (!spec) return null;

  const rows = runCardQuery(db, spec, null);
  const items: KpiDetailItem[] = rows.map((row) => {
    const columnValues = parseColumnValues(row.columnValuesJson);
    return { ...toKpiItem(row, columnId, columnValues), columnValues };
  });

  return {
    key: spec.key,
    label: spec.label,
    count: items.length,
    columnId,
    columnLabel: columnId ? humanizeColumnKey(columnId) : null,
    columns: collectColumnOptions(items),
    items,
  };
}

// =============================================================================
// Query execution
// =============================================================================

interface CardRow {
  localId: string;
  name: string;
  date: string | null;
  clientName: string | null;
  clientLocalId: string | null;
  boardKey: string | null;
  status: string | null;
  columnValuesJson: string | null;
}

function runCardQuery(db: Database, spec: CardSpec, limit: number | null): CardRow[] {
  const sql = `${spec.source} WHERE ${spec.where} ORDER BY ${spec.order}${limit === null ? "" : " LIMIT ?"}`;
  const params = limit === null ? spec.params : [...spec.params, limit];
  return db.prepare(sql).all(...params) as CardRow[];
}

function countCard(db: Database, spec: CardSpec): number {
  const row = db
    .prepare(`${spec.countSource} WHERE ${spec.where}`)
    .get(...spec.params) as { cnt: number };
  return row.cnt;
}

function toKpiItem(
  row: CardRow,
  columnId: string | null,
  parsed?: Record<string, unknown>,
): KpiItem {
  const columnValues = parsed ?? (columnId ? parseColumnValues(row.columnValuesJson) : null);
  return {
    localId: row.localId,
    name: row.name,
    date: row.date,
    clientName: row.clientName,
    clientLocalId: row.clientLocalId,
    boardKey: row.boardKey,
    status: row.status,
    columnValue: columnId && columnValues ? (columnValues[columnId] ?? null) : null,
  };
}

function getAlertsCard(db: Database, limit = PREVIEW_LIMIT): KpiCard {
  const { groups, totalCount } = getAlerts(db);

  // Flatten alert items across groups, which getAlerts already orders
  // critical > warning > info.
  const items: KpiItem[] = [];
  for (const group of groups) {
    for (const item of group.items) {
      if (items.length >= limit) break;
      items.push({
        localId: item.localId,
        name: item.name,
        date: item.date ?? null,
        clientName: item.clientName ?? null,
        clientLocalId: item.clientLocalId ?? null,
        boardKey: item.boardKey ?? null,
        status: item.status ?? null,
        columnValue: null,
      });
    }
    if (items.length >= limit) break;
  }

  return {
    key: "alerts",
    label: "Alerts",
    count: totalCount,
    columnId: null,
    columnLabel: null,
    items,
  };
}

// =============================================================================
// Column options
// =============================================================================

/**
 * Monday column keys we never offer as a display column: relation blobs and
 * subitem lists have no useful single-line rendering.
 */
const HIDDEN_COLUMN_KEYS = new Set(["subitems", "subtasks", "creation_log"]);

/**
 * The display-column choices for a card: every logical column key that at least
 * one row actually carries a value for. Keys come from config/boards.yaml (the
 * sync maps Monday column ids onto them), so this list follows the config
 * without a second place to maintain.
 */
function collectColumnOptions(items: KpiDetailItem[]): KpiColumnOption[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const [key, value] of Object.entries(item.columnValues)) {
      if (HIDDEN_COLUMN_KEYS.has(key)) continue;
      if (value === null || value === undefined || value === "") continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  const options = Array.from(counts.entries()).map(([id, populatedCount]) => ({
    id,
    label: humanizeColumnKey(id),
    populatedCount,
  }));

  // "status" first (the overwhelmingly common pick), then by how many rows
  // actually have a value. Cards that span several boards (Upcoming Deadlines
  // pulls from every board with a date) otherwise bury the useful columns under
  // a hundred that only one row carries.
  options.sort((a, b) => {
    if (a.id === "status") return -1;
    if (b.id === "status") return 1;
    if (a.populatedCount !== b.populatedCount) return b.populatedCount - a.populatedCount;
    return a.label.localeCompare(b.label);
  });
  return options;
}

/** `annual_fee_status` → `Annual Fee Status`. */
export function humanizeColumnKey(key: string): string {
  return key
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function parseColumnValues(json: string | null): Record<string, unknown> {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Malformed blob — treat as "no columns" rather than failing the dashboard.
  }
  return {};
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

function endOfMonth(dateStr: string): string {
  const d = new Date(dateStr);
  return formatDate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}
