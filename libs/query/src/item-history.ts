// =============================================================================
// Item history — what changed on a Monday item, from item_events (v35/v36)
// =============================================================================
// item_events holds every change Monday reported (webhooks since 2026-08-10,
// the activity log before). This reads it per item for two readers:
//
//   - the event panel's History section (M29): every meaningful change;
//   - the case timeline (P3.9): status / group changes and moved dates, with
//     the data-entry noise taken out (see statusChanges / dateMoves).
//
// Left out everywhere: link, subitem, mirror, button, file and people columns —
// automation churn, or values that are only ids.
// =============================================================================

import type BetterSqlite3 from "better-sqlite3";
type Database = BetterSqlite3.Database;

/** Column types whose changes are noise or unreadable (ids only). */
const NOISE_TYPES = new Set([
  "board-relation", "board_relation", "subtasks", "button", "mirror", "lookup", "file", "doc",
  "multiple-person", "people", "person", "dependency", "formula", "creation_log", "pulse_log",
]);

/**
 * Changes made by Monday itself (automations, integrations) carry a negative
 * user id: -4 on most, -12 on others (2,469 on production).
 */
export function isAutomationUser(userId: string | null): boolean {
  return !!userId && userId.startsWith("-");
}

export interface ItemChange {
  changedAt: string; // ISO
  source: "webhook" | "activity_log";
  eventType: string;
  columnId: string | null;
  columnTitle: string | null;
  columnType: string | null;
  from: string | null;
  to: string | null;
  userId: string | null;
}

interface Row {
  monday_item_id: string;
  changed_at: string;
  source: string;
  event_type: string;
  column_id: string | null;
  column_title: string | null;
  column_type: string | null;
  previous_text: string | null;
  value_text: string | null;
  monday_user_id: string | null;
}

/**
 * Every meaningful change on these items, oldest first: column changes (noise
 * types out), renames, group moves, created / archived / deleted / restored.
 * One query for all items (batch pattern).
 */
export function batchGetItemHistory(db: Database, mondayItemIds: string[]): Map<string, ItemChange[]> {
  const out = new Map<string, ItemChange[]>();
  const ids = [...new Set(mondayItemIds.filter(Boolean))];
  if (ids.length === 0) return out;
  const hasTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'item_events'").get();
  if (!hasTable) return out;
  const hasSource = !!db.prepare("SELECT 1 FROM pragma_table_info('item_events') WHERE name = 'source'").get();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const rows = db
      .prepare(
        `SELECT monday_item_id, changed_at, ${hasSource ? "source" : "'webhook' AS source"}, event_type, column_id, column_title,
                column_type, previous_text, value_text, monday_user_id
           FROM item_events
          WHERE monday_item_id IN (${chunk.map(() => "?").join(",")})
          ORDER BY changed_at, id`,
      )
      .all(...chunk) as Row[];
    for (const r of rows) {
      if (r.column_type && NOISE_TYPES.has(r.column_type)) continue;
      if (r.event_type === "update_column_value" && r.previous_text === r.value_text) continue;
      const list = out.get(r.monday_item_id) ?? [];
      list.push({
        changedAt: r.changed_at,
        source: r.source === "activity_log" ? "activity_log" : "webhook",
        eventType: r.event_type,
        columnId: r.column_id,
        columnTitle: r.column_title,
        columnType: r.column_type,
        from: r.previous_text,
        to: r.value_text,
        userId: r.monday_user_id,
      });
      out.set(r.monday_item_id, list);
    }
  }
  return out;
}

/** When the item was created, if the log saw it. */
function createdAt(changes: ItemChange[]): string | null {
  return changes.find((c) => c.eventType === "create_pulse")?.changedAt ?? null;
}

const minutesBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 60_000;

/** A firm-day key for "same day" collapsing. */
function dayOf(iso: string, timeZone?: string): string {
  if (!timeZone) return iso.slice(0, 10);
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : d.toLocaleDateString("en-CA", { timeZone });
}

export interface CollapsedChange {
  /** The firm day it happened. */
  day: string;
  changedAt: string; // the last change that day
  columnTitle: string | null;
  columnType: string | null;
  from: string | null;
  to: string | null;
  userId: string | null;
}

/**
 * Collapse a run of changes to one column into one per day (first `from` →
 * last `to`), dropping days that end where they started.
 */
function collapseByDay(changes: ItemChange[], timeZone?: string): CollapsedChange[] {
  const out: CollapsedChange[] = [];
  for (const c of changes) {
    const day = dayOf(c.changedAt, timeZone);
    const last = out[out.length - 1];
    if (last && last.day === day) {
      last.to = c.to;
      last.changedAt = c.changedAt;
      last.userId = c.userId ?? last.userId;
    } else {
      out.push({ day, changedAt: c.changedAt, columnTitle: c.columnTitle, columnType: c.columnType, from: c.from, to: c.to, userId: c.userId });
    }
  }
  return out.filter((c) => c.from !== c.to);
}

/**
 * The item's status changes worth a place on the timeline: the status column
 * (`statusColumnId`) and group moves made by a person, one per day per column,
 * leaving out the first value ever set (from nothing) and anything in the
 * first hour after the item was created (data entry, not news). Automations
 * are left out: on production they made ~25× more changes than people (e.g.
 * moving every consult to "Past Consults"); the event panel's History still
 * lists them.
 */
export function statusChanges(changes: ItemChange[], statusColumnId: string | null, timeZone?: string): CollapsedChange[] {
  const created = createdAt(changes);
  const settled = (c: ItemChange) => !isAutomationUser(c.userId) && (!created || minutesBetween(created, c.changedAt) > 60);
  const status = changes.filter((c) => statusColumnId && c.columnId === statusColumnId && settled(c));
  const groups = changes.filter((c) => c.eventType === "move_pulse_from_group" && settled(c));
  return [...collapseByDay(status, timeZone), ...collapseByDay(groups, timeZone)]
    .filter((c) => c.from && c.to)
    .sort((a, b) => (a.changedAt < b.changedAt ? -1 : 1));
}

/**
 * The times a date column was moved: from one date to another (both set, a
 * different day — a new time on the same day isn't a move), one per day,
 * leaving out the first 24 hours after the item was created (dates being
 * typed in, not rescheduled).
 */
export function dateMoves(changes: ItemChange[], columnId: string, timeZone?: string): CollapsedChange[] {
  const created = createdAt(changes);
  const moves = changes.filter((c) => c.columnId === columnId && (!created || minutesBetween(created, c.changedAt) > 24 * 60));
  const isDate = (v: string | null) => /^\d{4}-\d{2}-\d{2}/.test(v ?? "");
  return collapseByDay(moves, timeZone).filter((c) => isDate(c.from) && isDate(c.to) && c.from!.slice(0, 10) !== c.to!.slice(0, 10));
}
