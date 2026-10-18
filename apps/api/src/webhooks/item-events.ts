// =============================================================================
// Item activity log — webhook_events → item_events (schema v35)
// =============================================================================
// webhook_events is an inbox: the processor drains it and prunes it after 30
// days. Each event is also history — which column of which item changed, from
// what to what, by whom, when — so before anything is pruned, every event the
// log hasn't seen yet is copied into item_events, which keeps it for good.
//
// Called at the start of every drain (processor.ts), so the first drain after
// the v35 deploy backfills whatever the inbox still holds, and from then on
// each event is copied within a minute of arriving — long before pruning.
// Idempotent: a one-row cursor (item_events_cursor) says how far the inbox has
// been read, and webhook_event_id is unique; a delivery Monday retried (same
// triggerUuid, new inbox row) is recorded once.
// =============================================================================

import type BetterSqlite3 from "better-sqlite3";
type Database = BetterSqlite3.Database;
import { utcToFirm } from "@case-pipeline/core";

/** Inbox rows copied per call; a backlog drains over a few ticks. */
const BATCH = 5000;

interface InboxRow {
  id: number;
  event_type: string;
  monday_board_id: string | null;
  monday_item_id: string | null;
  payload: string;
  received_at: string;
}

interface MondayEvent {
  type?: string;
  triggerTime?: string;
  triggerUuid?: string;
  userId?: number | string;
  boardId?: number | string;
  pulseId?: number | string;
  itemId?: number | string;
  pulseName?: string;
  columnId?: string;
  columnTitle?: string;
  columnType?: string;
  value?: unknown;
  previousValue?: unknown;
}

export interface ItemEvent {
  webhookEventId: number;
  triggerUuid: string | null;
  eventType: string;
  mondayBoardId: string | null;
  boardKey: string | null;
  mondayItemId: string | null;
  itemName: string | null;
  columnId: string | null;
  columnTitle: string | null;
  columnType: string | null;
  valueText: string | null;
  previousText: string | null;
  valueJson: string | null;
  previousJson: string | null;
  mondayUserId: string | null;
  changedAt: string;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);
const join = (xs: (string | null)[]): string | null => xs.filter((x): x is string => !!x).join(", ") || null;

/**
 * A webhook value as a person would read it: the status label, the date (in
 * the firm's time when Monday sent a UTC time, as the sync does), the text,
 * the chosen labels. Shapes per column type are what Monday actually sends
 * (sampled from the production inbox). Unknown shapes → null; the raw JSON is
 * kept alongside either way.
 */
export function readableValue(value: unknown, columnType: string | null): string | null {
  if (value == null || typeof value !== "object") return str(value);
  const v = value as Record<string, unknown>;
  if (Object.keys(v).filter((k) => k !== "changed_at").length === 0) return null; // Monday's "{}" = empty
  switch (columnType) {
    case "color":
    case "status":
      return str((v.label as { text?: unknown } | undefined)?.text);
    case "date": {
      const date = str(v.date);
      const time = str(v.time);
      if (!date) return null;
      if (!time) return date;
      const firm = utcToFirm(date, time);
      return firm ? `${firm.date} ${firm.time}` : `${date} ${time} UTC`;
    }
    case "dropdown":
      return join(((v.chosenValues as { name?: unknown }[] | undefined) ?? []).map((c) => str(c.name)));
    case "tag":
    case "tags":
      return join(((v.tags as { name?: unknown }[] | undefined) ?? []).map((t) => str(t.name)));
    case "board-relation":
    case "subtasks":
      return join(((v.linkedPulseIds as { linkedPulseId?: unknown }[] | undefined) ?? []).map((l) => str(l.linkedPulseId)));
    case "multiple-person":
    case "people":
      return join(((v.personsAndTeams as { id?: unknown }[] | undefined) ?? []).map((p) => str(p.id)));
    case "file":
    case "doc":
      return join(((v.files as { name?: unknown }[] | undefined) ?? []).map((f) => str(f.name)));
    case "boolean":
    case "checkbox":
      return typeof v.checked === "boolean" ? (v.checked ? "checked" : "unchecked") : null;
    case "numeric":
    case "numbers":
      return str(v.value);
    case "button":
      return str(v.clicks) ? `clicked (${str(v.clicks)})` : null;
    default:
      // text {value}, long-text {text}, email {email,text}, link {url,text}, phone {phone}, item names {name}
      return str(v.value) ?? str(v.text) ?? str(v.email) ?? str(v.url) ?? str(v.phone) ?? str(v.name);
  }
}

/** One inbox row as a log entry; null when the payload isn't an event. */
export function toItemEvent(row: InboxRow, boardKeyForId: (mondayBoardId: string) => string | null): ItemEvent | null {
  let event: MondayEvent;
  try {
    event = (JSON.parse(row.payload) as { event?: MondayEvent }).event ?? {};
  } catch {
    return null;
  }
  const boardId = row.monday_board_id ?? str(event.boardId);
  const itemId = row.monday_item_id ?? str(event.pulseId) ?? str(event.itemId);
  // A rename reports the item's name in value/previousValue, not a column.
  const columnType = event.columnType ?? (row.event_type === "update_name" ? "name" : null);
  const json = (v: unknown) => (v === undefined || v === null ? null : JSON.stringify(v));
  const changed = str(event.triggerTime);
  return {
    webhookEventId: row.id,
    triggerUuid: str(event.triggerUuid),
    eventType: row.event_type,
    mondayBoardId: boardId,
    boardKey: boardId ? boardKeyForId(boardId) : null,
    mondayItemId: itemId,
    itemName: str(event.pulseName) ?? (row.event_type === "update_name" ? readableValue(event.value, "name") : null),
    columnId: str(event.columnId),
    columnTitle: str(event.columnTitle),
    columnType,
    valueText: readableValue(event.value, columnType),
    previousText: readableValue(event.previousValue, columnType),
    valueJson: json(event.value),
    previousJson: json(event.previousValue),
    mondayUserId: str(event.userId),
    // Monday's own trigger time; else when the inbox got it (stored as UTC "YYYY-MM-DD HH:MM:SS").
    changedAt: changed ?? `${row.received_at.replace(" ", "T")}Z`,
  };
}

/**
 * Copy every inbox event not yet in item_events. Returns how many rows were
 * added. Runs before the processor prunes, so nothing leaves the inbox
 * unrecorded.
 */
export function recordItemEvents(db: Database, boardKeyForId: (mondayBoardId: string) => string | null): number {
  const after = (db.prepare("SELECT last_webhook_event_id AS id FROM item_events_cursor WHERE id = 1").get() as { id: number } | undefined)?.id ?? 0;
  const rows = db
    .prepare(
      `SELECT id, event_type, monday_board_id, monday_item_id, payload, received_at
         FROM webhook_events WHERE id > ? ORDER BY id LIMIT ?`,
    )
    .all(after, BATCH) as InboxRow[];
  if (rows.length === 0) return 0;

  const insert = db.prepare(`
    INSERT OR IGNORE INTO item_events (
      webhook_event_id, trigger_uuid, event_type, monday_board_id, board_key, monday_item_id, item_name,
      column_id, column_title, column_type, value_text, previous_text, value_json, previous_json,
      monday_user_id, changed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  let added = 0;
  db.transaction(() => {
    for (const row of rows) {
      const e = toItemEvent(row, boardKeyForId);
      if (!e) continue;
      added += insert.run(
        e.webhookEventId, e.triggerUuid, e.eventType, e.mondayBoardId, e.boardKey, e.mondayItemId, e.itemName,
        e.columnId, e.columnTitle, e.columnType, e.valueText, e.previousText, e.valueJson, e.previousJson,
        e.mondayUserId, e.changedAt,
      ).changes;
    }
    db.prepare(
      `INSERT INTO item_events_cursor (id, last_webhook_event_id) VALUES (1, ?)
       ON CONFLICT(id) DO UPDATE SET last_webhook_event_id = excluded.last_webhook_event_id`,
    ).run(rows[rows.length - 1]!.id);
  })();
  return added;
}
