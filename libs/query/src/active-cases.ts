// =============================================================================
// Active Cases Query
// =============================================================================
// Returns all open form cases in active groups, grouped by paralegal assignee
// and sorted by urgency within each row.

import type BetterSqlite3 from "better-sqlite3";
type Database = BetterSqlite3.Database;

// =============================================================================
// Types
// =============================================================================

export type Urgency = "overdue" | "critical" | "soon" | "later" | "none";

export interface ActiveCase {
  localId: string;
  clientName: string;
  clientLocalId: string | null;
  formName: string;
  status: string | null;
  targetDate: string | null;
  urgency: Urgency;
  daysUntilTarget: number | null;
  isCourtCase: boolean;
  /** All paralegals assigned to this case. Empty when unassigned. */
  assignees: string[];
  priority: null;
  /** North Pole return date, when the case is parked. Null otherwise. */
  northPoleUntil: string | null;
  /** True when hidden by default: parked in North Pole with a future return date. */
  snoozed: boolean;
}

export interface ActiveCasesAssignee {
  name: string;
  cases: ActiveCase[];
}

export interface ActiveCasesResult {
  assignees: ActiveCasesAssignee[];
  /** Cases hidden because they are parked in North Pole with a future return date. */
  snoozedCount: number;
}

export interface ActiveCasesOptions {
  /** Include cases currently snoozed in North Pole (default false). */
  includeSnoozed?: boolean;
}

// The status the team uses to temporarily park a case. A parked case is hidden
// from the board ONLY while its return date (north_pole_until) is in the
// future — no return date means it stays visible, so "temporarily hidden" can
// never become "permanently forgotten". Deadline alerts are computed elsewhere
// and are never silenced by parking. See docs/features/monday-write-back.md.
const NORTH_POLE_STATUS = "Send to North Pole";

// =============================================================================
// Urgency helpers
// =============================================================================

function toDateInt(iso: string): number {
  return parseInt(iso.replace(/-/g, ""), 10);
}

function computeUrgency(targetDate: string | null, todayIso: string): {
  urgency: Urgency;
  daysUntilTarget: number | null;
} {
  if (!targetDate) return { urgency: "none", daysUntilTarget: null };

  const todayMs = new Date(todayIso).getTime();
  const targetMs = new Date(targetDate).getTime();
  const diff = Math.round((targetMs - todayMs) / 86_400_000);

  let urgency: Urgency;
  if (diff < 0)     urgency = "overdue";
  else if (diff <= 3) urgency = "critical";
  else if (diff <= 7) urgency = "soon";
  else                urgency = "later";

  return { urgency, daysUntilTarget: diff };
}

const URGENCY_ORDER: Record<Urgency, number> = {
  overdue: 0, critical: 1, soon: 2, later: 3, none: 4,
};

/**
 * Parse a Monday people-column value into a de-duplicated list of names.
 * Monday stores multiple assignees as a comma-separated string ("A, B").
 * Returns [] for unassigned cases.
 */
function parseAssignees(raw: string | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const names: string[] = [];
  for (const part of raw.split(",")) {
    const name = part.trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}

// =============================================================================
// Query
// =============================================================================

interface RawActiveCaseRow {
  localId: string;
  formName: string;
  status: string | null;
  targetDate: string | null;
  paralegals: string | null;
  groupTitle: string | null;
  northPoleUntil: string | null;
  clientLocalId: string | null;
  clientName: string | null;
}

export function getActiveCases(db: Database, options: ActiveCasesOptions = {}): ActiveCasesResult {
  const todayIso = new Date().toISOString().slice(0, 10);

  const rows = db.prepare(`
    SELECT
      bi.local_id    AS localId,
      bi.name        AS formName,
      bi.status,
      bi.next_date   AS targetDate,
      bi.paralegals,
      bi.group_title AS groupTitle,
      json_extract(bi.column_values, '$.north_pole_until.date') AS northPoleUntil,
      p.local_id     AS clientLocalId,
      p.name         AS clientName
    FROM board_items bi
    LEFT JOIN profiles p ON p.local_id = bi.profile_local_id
    WHERE bi.board_key = '_cd_open_forms'
      AND bi.group_title IN ('Open Forms', 'Court Forms')
    ORDER BY bi.next_date ASC NULLS LAST
  `).all() as RawActiveCaseRow[];

  // Group by assignee
  const assigneeMap = new Map<string, ActiveCase[]>();
  let snoozedCount = 0;

  for (const row of rows) {
    // North Pole snooze: hidden only while the return date is still ahead.
    // Past-date or missing-date parks stay visible (fail-safe by design).
    const snoozed =
      row.status === NORTH_POLE_STATUS &&
      row.northPoleUntil !== null &&
      row.northPoleUntil > todayIso;
    if (snoozed) {
      snoozedCount++;
      if (!options.includeSnoozed) continue;
    }
    const assignees = parseAssignees(row.paralegals);
    const { urgency, daysUntilTarget } = computeUrgency(row.targetDate, todayIso);

    const activeCase: ActiveCase = {
      localId: row.localId,
      clientName: row.clientName ?? row.formName,
      clientLocalId: row.clientLocalId,
      formName: row.formName,
      status: row.status,
      targetDate: row.targetDate,
      urgency,
      daysUntilTarget,
      isCourtCase: row.groupTitle === "Court Forms",
      assignees,
      priority: null,
      northPoleUntil: row.status === NORTH_POLE_STATUS ? row.northPoleUntil : null,
      snoozed,
    };

    // Fan the case out into every assigned paralegal's row so each person
    // sees it on their lane. Unassigned cases land in a single "Unassigned" row.
    const targetRows = assignees.length > 0 ? assignees : ["Unassigned"];
    for (const name of targetRows) {
      const cases = assigneeMap.get(name) ?? [];
      cases.push(activeCase);
      assigneeMap.set(name, cases);
    }
  }

  // Sort cases within each assignee by urgency
  for (const cases of assigneeMap.values()) {
    cases.sort((a, b) => URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency]);
  }

  // Sort assignees alphabetically; "Unassigned" always last
  const assignees: ActiveCasesAssignee[] = Array.from(assigneeMap.entries())
    .sort(([a], [b]) => {
      if (a === "Unassigned") return 1;
      if (b === "Unassigned") return -1;
      return a.localeCompare(b);
    })
    .map(([name, cases]) => ({ name, cases }));

  return { assignees, snoozedCount };
}
