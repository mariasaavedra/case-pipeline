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
}

export interface ActiveCasesAssignee {
  name: string;
  cases: ActiveCase[];
}

export interface ActiveCasesResult {
  assignees: ActiveCasesAssignee[];
}

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
  clientLocalId: string | null;
  clientName: string | null;
}

export function getActiveCases(db: Database): ActiveCasesResult {
  const todayIso = new Date().toISOString().slice(0, 10);

  const rows = db.prepare(`
    SELECT
      bi.local_id    AS localId,
      bi.name        AS formName,
      bi.status,
      bi.next_date   AS targetDate,
      bi.paralegals,
      bi.group_title AS groupTitle,
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

  for (const row of rows) {
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

  return { assignees };
}
