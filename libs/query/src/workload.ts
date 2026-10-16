// =============================================================================
// Workload — open work per person, across the pages that assign people
// =============================================================================
// Reuses each page's own query, so "open" means exactly what that page shows:
//
//   Open Forms (P5)     getActiveCases      paralegal (assignees), attorney
//   Prescheduling (P13) getPrescheduling    paralegal, attorney, assistant
//   Contracts (P14)     getPendingContracts attorney, assistant
//   Court cases (P15)   getCourtCases       paralegal, attorney
//   FOIAs (P19)         getFoias            paralegal, attorney
//
// Address changes carry no person column, so they're not here. Parked (North
// Pole) work is left out, as each page leaves it out of its counts.
//
// Names are matched by `resolve` — the staff roster's matcher, passed in so
// this library stays free of users.db. A name it can't resolve is still a
// person here (keyed by the name), so nothing silently drops out.
// =============================================================================

import type BetterSqlite3 from "better-sqlite3";
import { getActiveCases, type ActiveCasesOptions, type Urgency } from "./active-cases";
import { getPrescheduling, type WaitLevel } from "./prescheduling";
import { getPendingContracts } from "./pending-contracts";
import { getCourtCases, type Readiness } from "./court-cases";
import { getFoias } from "./foias";
import { FEE_KS_BOARD_KEY } from "./my-cases";
import type { AlertGroup, AlertItem } from "./types";

type Database = BetterSqlite3.Database;

export type WorkloadSource = "open_forms" | "prescheduling" | "contracts" | "court_cases" | "foias";
export type WorkloadColumn = "paralegal" | "attorney" | "assistant";
/** critical = overdue / late / behind; warning = soon / waiting / at risk. */
export type WorkloadLevel = "critical" | "warning" | "ok";

export const WORKLOAD_SOURCES: WorkloadSource[] = ["open_forms", "prescheduling", "contracts", "court_cases", "foias"];

/** The column each source is "owned" by: empty = unassigned. */
export const PRIMARY_COLUMN: Record<WorkloadSource, WorkloadColumn> = {
  open_forms: "paralegal",
  prescheduling: "paralegal",
  contracts: "attorney",
  court_cases: "paralegal",
  foias: "paralegal",
};

export interface WorkloadItem {
  source: WorkloadSource;
  localId: string;
  /** board_items for board rows, contracts for Fee Ks — where a reassignment writes. */
  table: "board_items" | "contracts";
  boardKey: string | null;
  mondayItemId: string | null;
  title: string;
  clientName: string | null;
  clientLocalId: string | null;
  level: WorkloadLevel;
  /** The page's own words for the level ("Overdue", "Late", "Behind"). */
  levelLabel: string;
  /** Who's on it, per column, as the board spells them. */
  people: Partial<Record<WorkloadColumn, string[]>>;
}

export interface WorkloadAssignment {
  item: WorkloadItem;
  /** Which column(s) name this person on the item. */
  columns: WorkloadColumn[];
}

export interface WorkloadPerson {
  /** The roster id, or null when no staff record matches the name. */
  staffId: number | null;
  name: string;
  active: boolean;
  /** The spellings on the boards that landed here. */
  boardNames: string[];
  total: number;
  critical: number;
  warning: number;
  bySource: Record<WorkloadSource, number>;
  items: WorkloadAssignment[];
}

export interface WorkloadResult {
  people: WorkloadPerson[];
  /** Nobody in the item's primary column (PRIMARY_COLUMN). */
  unassigned: WorkloadItem[];
  /** Everyone in the primary column is an inactive staff member. */
  inactiveAssignee: WorkloadItem[];
}

export type StaffResolver = (name: string) => { id: number; name: string; active: boolean } | null;

export interface WorkloadOptions {
  activeCases?: ActiveCasesOptions;
  today?: string;
}

// -----------------------------------------------------------------------------

const URGENCY_LEVEL: Record<Urgency, [WorkloadLevel, string]> = {
  overdue: ["critical", "Overdue"],
  critical: ["critical", "Due soon"],
  soon: ["warning", "Coming up"],
  later: ["ok", "Later"],
  none: ["ok", "No date"],
};
const WAIT_LEVEL: Record<WaitLevel, [WorkloadLevel, string]> = {
  late: ["critical", "Late"],
  waiting: ["warning", "Waiting"],
  fresh: ["ok", "Fresh"],
  unknown: ["ok", "No date"],
};
const READINESS_LEVEL: Record<Readiness, [WorkloadLevel, string]> = {
  behind: ["critical", "Behind"],
  at_risk: ["warning", "At risk"],
  on_track: ["ok", "On track"],
  n_a: ["ok", "No hearing"],
};

const clean = (names: (string | null | undefined)[]): string[] =>
  [...new Set(names.flatMap((n) => (n ? n.split(",") : [])).map((n) => n.trim()).filter(Boolean))];

/** Every open item that assigns people, from the five page queries. */
export function collectWorkloadItems(db: Database, options: WorkloadOptions = {}): WorkloadItem[] {
  const items: WorkloadItem[] = [];

  for (const c of getActiveCases(db, options.activeCases).cases) {
    if (c.parked) continue;
    const [level, levelLabel] = URGENCY_LEVEL[c.urgency];
    items.push({
      source: "open_forms", localId: c.localId, table: "board_items", boardKey: null, mondayItemId: null,
      title: c.formName, clientName: c.clientName, clientLocalId: c.clientLocalId, level, levelLabel,
      people: { paralegal: clean(c.assignees), attorney: clean([c.attorney]) },
    });
  }

  for (const c of getPrescheduling(db, { today: options.today }).cases) {
    if (c.parked) continue;
    const [level, levelLabel] = WAIT_LEVEL[c.waitLevel];
    items.push({
      source: "prescheduling", localId: c.localId, table: "contracts", boardKey: FEE_KS_BOARD_KEY, mondayItemId: c.mondayItemId,
      title: c.contractFor.join(", ") || "Fee K", clientName: c.clientName, clientLocalId: c.clientLocalId, level, levelLabel,
      people: { paralegal: clean(c.paralegals), attorney: clean([c.attorney]), assistant: clean([c.assistant]) },
    });
  }

  for (const c of getPendingContracts(db, { today: options.today }).contracts) {
    const [level, levelLabel] = WAIT_LEVEL[c.ageLevel];
    items.push({
      source: "contracts", localId: c.localId, table: "contracts", boardKey: FEE_KS_BOARD_KEY, mondayItemId: null,
      title: c.contractFor.join(", ") || c.itemName, clientName: c.clientName, clientLocalId: c.clientLocalId, level, levelLabel,
      people: { attorney: clean(c.attorneys), assistant: clean([c.assistant]) },
    });
  }

  for (const c of getCourtCases(db, { today: options.today }).cases) {
    const [level, levelLabel] = READINESS_LEVEL[c.readiness];
    items.push({
      source: "court_cases", localId: c.localId, table: "board_items", boardKey: null, mondayItemId: null,
      title: c.itemName, clientName: c.clientName, clientLocalId: c.clientLocalId, level, levelLabel,
      people: { paralegal: clean(c.paralegals), attorney: clean([c.attorney]) },
    });
  }

  for (const c of getFoias(db, { today: options.today }).items) {
    if (c.phase === "parked") continue;
    const [level, levelLabel] = WAIT_LEVEL[c.ageLevel];
    items.push({
      source: "foias", localId: c.localId, table: "board_items", boardKey: null, mondayItemId: null,
      title: c.itemName, clientName: c.clientName, clientLocalId: c.clientLocalId, level, levelLabel,
      people: { paralegal: clean(c.paralegals), attorney: clean([c.attorney]) },
    });
  }

  fillItemIdentity(db, items);
  return items;
}

/** Board key + Monday id for every item, in two queries (a reassignment needs both). */
function fillItemIdentity(db: Database, items: WorkloadItem[]): void {
  for (const table of ["board_items", "contracts"] as const) {
    const ids = [...new Set(items.filter((i) => i.table === table).map((i) => i.localId))];
    if (ids.length === 0) continue;
    const boardCol = table === "board_items" ? "board_key" : "NULL";
    const rows = db
      .prepare(
        `SELECT local_id AS id, monday_item_id AS mondayItemId, ${boardCol} AS boardKey
           FROM ${table} WHERE local_id IN (${ids.map(() => "?").join(",")})`,
      )
      .all(...ids) as { id: string; mondayItemId: string | null; boardKey: string | null }[];
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const it of items) {
      if (it.table !== table) continue;
      const r = byId.get(it.localId);
      if (!r) continue;
      it.mondayItemId = it.mondayItemId ?? r.mondayItemId;
      it.boardKey = it.boardKey ?? r.boardKey;
    }
  }
}

/** Group items by person (via `resolve`), plus the unassigned / inactive lists. */
export function buildWorkload(items: WorkloadItem[], resolve: StaffResolver): WorkloadResult {
  const people = new Map<string, WorkloadPerson>();
  const unassigned: WorkloadItem[] = [];
  const inactiveAssignee: WorkloadItem[] = [];

  for (const item of items) {
    const perPerson = new Map<string, { person: WorkloadPerson; columns: Set<WorkloadColumn> }>();
    for (const [column, names] of Object.entries(item.people) as [WorkloadColumn, string[]][]) {
      for (const name of names) {
        const staff = resolve(name);
        const key = staff ? `s:${staff.id}` : `n:${name.toLowerCase()}`;
        let person = people.get(key);
        if (!person) {
          person = {
            staffId: staff?.id ?? null, name: staff?.name ?? name, active: staff?.active ?? true, boardNames: [],
            total: 0, critical: 0, warning: 0,
            bySource: Object.fromEntries(WORKLOAD_SOURCES.map((s) => [s, 0])) as Record<WorkloadSource, number>,
            items: [],
          };
          people.set(key, person);
        }
        if (!person.boardNames.includes(name)) person.boardNames.push(name);
        const entry = perPerson.get(key) ?? { person, columns: new Set<WorkloadColumn>() };
        entry.columns.add(column);
        perPerson.set(key, entry);
      }
    }
    // Each item counts once per person, however many columns name them.
    for (const { person, columns } of perPerson.values()) {
      person.items.push({ item, columns: [...columns] });
      person.total++;
      person.bySource[item.source]++;
      if (item.level === "critical") person.critical++;
      else if (item.level === "warning") person.warning++;
    }

    const primary = item.people[PRIMARY_COLUMN[item.source]] ?? [];
    if (primary.length === 0) unassigned.push(item);
    else if (primary.every((n) => resolve(n)?.active === false)) inactiveAssignee.push(item);
  }

  const levelRank: Record<WorkloadLevel, number> = { critical: 0, warning: 1, ok: 2 };
  const list = [...people.values()];
  for (const p of list) p.items.sort((a, b) => levelRank[a.item.level] - levelRank[b.item.level]);
  list.sort((a, b) => b.critical - a.critical || b.total - a.total || a.name.localeCompare(b.name));
  return { people: list, unassigned, inactiveAssignee };
}

export function getWorkload(db: Database, resolve: StaffResolver, options: WorkloadOptions = {}): WorkloadResult {
  return buildWorkload(collectWorkloadItems(db, options), resolve);
}

const SOURCE_LABEL: Record<WorkloadSource, string> = {
  open_forms: "Open Form",
  prescheduling: "Prescheduling",
  contracts: "Pending Fee K",
  court_cases: "Court case",
  foias: "FOIA",
};

/**
 * Alerts → "Assigned to inactive staff": open work whose only owner has left.
 * Same rule as WorkloadResult.inactiveAssignee; Offboarding is the fix.
 */
export function getInactiveAssigneeAlertGroup(
  db: Database,
  resolve: StaffResolver,
  opts: { attorney?: string } = {},
): AlertGroup {
  let items = getWorkload(db, resolve).inactiveAssignee;
  if (opts.attorney) {
    const wanted = opts.attorney.toLowerCase();
    items = items.filter((i) => (i.people.attorney ?? []).some((a) => a.toLowerCase() === wanted));
  }
  const alertItems: AlertItem[] = items.map((i) => ({
    localId: i.localId,
    name: i.title,
    boardKey: i.boardKey,
    status: null,
    clientName: i.clientName,
    clientLocalId: i.clientLocalId,
    attorney: i.people.attorney?.join(", ") || null,
    date: null,
    detail: `${SOURCE_LABEL[i.source]} — ${PRIMARY_COLUMN[i.source]}: ${(i.people[PRIMARY_COLUMN[i.source]] ?? []).join(", ")} (inactive)`,
  }));
  return {
    severity: "info",
    label: "Assigned to inactive staff",
    description: "Open work whose only owner is no longer active. Reassign it from Settings → Staff → Offboard.",
    count: alertItems.length,
    items: alertItems,
  };
}
