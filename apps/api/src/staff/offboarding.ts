// =============================================================================
// Staff offboarding — hand someone's open work to others, then close them out
// =============================================================================
// 1. Open work = the person's items from getWorkload (the same "open" as each
//    page), per column they're named in (paralegal / attorney / assistant).
// 2. Reassign: per item and column, the departing person is replaced by the
//    chosen one (or just removed). Co-assignees stay. Each item's people column
//    is read LIVE from Monday first, because the mirror only has display names
//    and a write needs ids — and if the person is no longer in it on Monday,
//    the item is skipped as already handled. Writes go out under the admin's
//    own token (shared-token fallback), queue on outage, and update the local
//    mirror right away so Workload shows the result immediately.
// 3. Close out: app access off (users.active), staff record inactive with an
//    end date, and the manual steps ticked (Monday seat, Microsoft 365,
//    RingCentral, Slack). Done = no open items + every step ticked.
// A person with no Monday id (a name found only on the boards) is recognized
// in a cell by looking up the cell's unknown ids by name (fetchUsersByIds).
// =============================================================================

import type BetterSqlite3 from "better-sqlite3";
import type { BoardConfig } from "@case-pipeline/config";
import type { WorkloadAssignment, WorkloadColumn, WorkloadSource } from "@case-pipeline/query";
import type { PeopleCell } from "@case-pipeline/monday";
import { normName, splitPeople } from "./roster.js";
import { OFFBOARDING_MANUAL_STEPS, type OffboardingManualStep } from "./schema.js";

type Database = BetterSqlite3.Database;

export interface Reassignment {
  source: WorkloadSource;
  localId: string;
  column: WorkloadColumn;
  /** null = remove the person, add no one. */
  toStaffId: number | null;
}

export interface PlannedWrite {
  source: WorkloadSource;
  localId: string;
  table: "board_items" | "contracts";
  boardKey: string;
  column: WorkloadColumn;
  mondayItemId: string;
  mondayBoardId: string;
  columnId: string;
  to: { staffId: number; name: string; mondayUserId: string } | null;
}

export type ItemOutcome = "written" | "queued" | "local_only" | "skipped";

export interface ItemResult {
  source: WorkloadSource;
  localId: string;
  column: WorkloadColumn;
  outcome: ItemOutcome;
  /** Why it was skipped, in words for the admin. */
  reason?: string;
}

// -----------------------------------------------------------------------------
// Pure parts
// -----------------------------------------------------------------------------

/**
 * The people value to write: everyone already there except the departing
 * person, plus the replacement (once). `removed` = how many entries went.
 */
export function swapPersons(
  persons: Array<{ id: string; kind: string }>,
  isDeparting: (id: string) => boolean,
  toId: string | null,
): { personsAndTeams: Array<{ id: number; kind: string }>; removed: number } {
  const kept = persons.filter((p) => p.kind !== "person" || !isDeparting(p.id));
  const removed = persons.length - kept.length;
  if (toId && !kept.some((p) => p.kind === "person" && p.id === toId)) kept.push({ id: toId, kind: "person" });
  return { personsAndTeams: kept.map((p) => ({ id: Number(p.id), kind: p.kind })), removed };
}

/** The mirror's comma-joined names with the departing person swapped out. */
export function swapNames(text: string | null, isDeparting: (name: string) => boolean, toName: string | null): string | null {
  const kept = splitPeople(text).filter((n) => !isDeparting(n));
  if (toName && !kept.some((n) => normName(n) === normName(toName))) kept.push(toName);
  return kept.length ? kept.join(", ") : null;
}

/** The Monday column id for a people column key, when boards.yaml pins it by id. */
export function peopleColumnId(boards: Record<string, BoardConfig>, boardKey: string, column: WorkloadColumn): string | null {
  const res = boards[boardKey]?.columns?.[column];
  return res?.resolve === "by_id" && res.id ? res.id : null;
}

/** A reassignment of the local mirror alone (seed data, or no Monday token). */
export type LocalWrite = Pick<PlannedWrite, "source" | "localId" | "table" | "column"> & {
  to: { staffId: number; name: string } | null;
};

/**
 * Turn the admin's choices into writes, against the person's actual open
 * items (never trusting the client about what they hold). Returns the writes
 * plus the choices that can't be carried out, with the reason.
 *
 * `liveWrites: false` (seed data): every held item becomes a `localOnly`
 * write — no Monday ids or accounts are needed, since nothing goes to Monday.
 */
export function planReassignments(
  mine: WorkloadAssignment[],
  choices: Reassignment[],
  boards: Record<string, BoardConfig>,
  staffById: (id: number) => { name: string; mondayUserId: string | null; active: boolean } | null,
  opts: { liveWrites: boolean } = { liveWrites: true },
): { writes: PlannedWrite[]; localOnly: LocalWrite[]; skipped: ItemResult[] } {
  const writes: PlannedWrite[] = [];
  const localOnly: LocalWrite[] = [];
  const skipped: ItemResult[] = [];
  const skip = (c: Reassignment, reason: string) =>
    skipped.push({ source: c.source, localId: c.localId, column: c.column, outcome: "skipped", reason });

  for (const c of choices) {
    const held = mine.find((a) => a.item.source === c.source && a.item.localId === c.localId);
    if (!held || !held.columns.includes(c.column)) {
      skip(c, "No longer assigned to this person");
      continue;
    }
    const { item } = held;
    if (!opts.liveWrites) {
      const person = c.toStaffId !== null ? staffById(c.toStaffId) : null;
      if (c.toStaffId !== null && (!person || !person.active)) {
        skip(c, "The new person isn't an active staff member");
        continue;
      }
      localOnly.push({
        source: c.source, localId: c.localId, table: item.table, column: c.column,
        to: person && c.toStaffId !== null ? { staffId: c.toStaffId, name: person.name } : null,
      });
      continue;
    }
    if (!item.mondayItemId || !item.boardKey) {
      skip(c, "Not synced to Monday yet");
      continue;
    }
    const columnId = peopleColumnId(boards, item.boardKey, c.column);
    const mondayBoardId = boards[item.boardKey]?.id;
    if (!columnId || !mondayBoardId) {
      skip(c, `No ${c.column} column configured for this board`);
      continue;
    }
    let to: PlannedWrite["to"] = null;
    if (c.toStaffId !== null) {
      const person = staffById(c.toStaffId);
      if (!person || !person.active) {
        skip(c, "The new person isn't an active staff member");
        continue;
      }
      if (!person.mondayUserId) {
        skip(c, `${person.name} has no Monday account to assign`);
        continue;
      }
      to = { staffId: c.toStaffId, name: person.name, mondayUserId: person.mondayUserId };
    }
    writes.push({
      source: c.source, localId: c.localId, table: item.table, boardKey: item.boardKey, column: c.column,
      mondayItemId: item.mondayItemId, mondayBoardId, columnId, to,
    });
  }
  return { writes, localOnly, skipped };
}

// -----------------------------------------------------------------------------
// Local mirror
// -----------------------------------------------------------------------------

/** Mirror a reassignment locally (board_items column + JSON, or the Fee K's raw values). */
export function applyLocalReassignment(
  caseDb: Database,
  w: Pick<PlannedWrite, "table" | "localId" | "column"> & { to: { name: string } | null },
  isDeparting: (name: string) => boolean,
): void {
  const toName = w.to?.name ?? null;
  if (w.table === "contracts") {
    const row = caseDb
      .prepare(`SELECT json_extract(raw_column_values, '$.' || ? || '.label') AS text FROM contracts WHERE local_id = ?`)
      .get(w.column, w.localId) as { text: string | null } | undefined;
    if (!row) return;
    const next = swapNames(row.text, isDeparting, toName);
    caseDb
      .prepare(`UPDATE contracts SET raw_column_values = json_set(raw_column_values, '$.' || ?, json(?)) WHERE local_id = ?`)
      .run(w.column, next ? JSON.stringify({ label: next }) : "null", w.localId);
    return;
  }
  // board_items: the flat column the queries read, and the JSON copy some read instead.
  const flat = w.column === "attorney" ? "attorney" : w.column === "paralegal" ? "paralegals" : null;
  const row = caseDb
    .prepare(`SELECT paralegals, attorney, column_values FROM board_items WHERE local_id = ?`)
    .get(w.localId) as { paralegals: string | null; attorney: string | null; column_values: string | null } | undefined;
  if (!row) return;
  if (flat) {
    const next = swapNames(flat === "attorney" ? row.attorney : row.paralegals, isDeparting, toName);
    caseDb.prepare(`UPDATE board_items SET ${flat} = ? WHERE local_id = ?`).run(next, w.localId);
  }
  for (const key of w.column === "paralegal" ? ["paralegal", "paralegals"] : [w.column]) {
    const cur = caseDb
      .prepare(`SELECT json_extract(column_values, '$.' || ? || '.label') AS text FROM board_items WHERE local_id = ?`)
      .get(key, w.localId) as { text: string | null };
    if (cur.text === null) continue;
    const next = swapNames(cur.text, isDeparting, toName);
    caseDb
      .prepare(`UPDATE board_items SET column_values = json_set(column_values, '$.' || ?, json(?)) WHERE local_id = ?`)
      .run(key, next ? JSON.stringify({ label: next }) : "null", w.localId);
  }
}

// -----------------------------------------------------------------------------
// Checklist state (users.db staff_offboarding)
// -----------------------------------------------------------------------------

export interface OffboardingRecord {
  startedAt: string;
  startedBy: number | null;
  completedAt: string | null;
  steps: Partial<Record<OffboardingManualStep, { at: string; by: string | null }>>;
}

export function getOffboarding(db: Database, staffId: number): OffboardingRecord | null {
  const row = db.prepare("SELECT * FROM staff_offboarding WHERE staff_id = ?").get(staffId) as
    | { started_at: string; started_by: number | null; completed_at: string | null; manual_steps: string }
    | undefined;
  if (!row) return null;
  let steps: OffboardingRecord["steps"] = {};
  try {
    steps = JSON.parse(row.manual_steps) as OffboardingRecord["steps"];
  } catch {
    steps = {};
  }
  return { startedAt: row.started_at, startedBy: row.started_by, completedAt: row.completed_at, steps };
}

/** Start (or resume) an offboarding. Returns true when it was newly started. */
export function startOffboarding(db: Database, staffId: number, byUserId: number | null): boolean {
  const res = db
    .prepare("INSERT INTO staff_offboarding (staff_id, started_by) VALUES (?, ?) ON CONFLICT(staff_id) DO NOTHING")
    .run(staffId, byUserId);
  return res.changes > 0;
}

export function setManualStep(db: Database, staffId: number, step: OffboardingManualStep, done: boolean, by: string | null): void {
  const rec = getOffboarding(db, staffId);
  if (!rec) return;
  const steps = { ...rec.steps };
  if (done) steps[step] = { at: new Date().toISOString(), by };
  else delete steps[step];
  db.prepare("UPDATE staff_offboarding SET manual_steps = ?, completed_at = NULL WHERE staff_id = ?").run(JSON.stringify(steps), staffId);
}

export function allStepsDone(rec: OffboardingRecord | null): boolean {
  return !!rec && OFFBOARDING_MANUAL_STEPS.every((s) => rec.steps[s]);
}

/** Cells whose departing person is gone already, for a skip reason. */
export function cellKey(itemId: string, columnId: string): string {
  return `${itemId}:${columnId}`;
}
export function indexCells(cells: PeopleCell[]): Map<string, PeopleCell> {
  return new Map(cells.map((c) => [cellKey(c.itemId, c.columnId), c]));
}
