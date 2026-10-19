// =============================================================================
// P3.9 Case timeline
// =============================================================================
//   GET /api/clients/:localId/timeline   the case as dated events + summary
//   GET /api/timeline/items/:localId     one event's Monday item, for the event
//                                        panel: its editable fields, the ones
//                                        the timeline reads first, and its
//                                        history (item_events)
//
// History names people from the staff roster (users.db, staff.monday_user_id).
//
// Both read-only; edits go through PATCH /api/board-items/:localId/columns.
// The milestone mapping is config/timeline.yaml, read once per process (it
// changes only with a deploy); the rules and the summary are
// libs/query/src/case-timeline.ts.
// =============================================================================

import type { Express } from "express";
import type BetterSqlite3 from "better-sqlite3";
type DatabaseInstance = BetterSqlite3.Database;
import { requireAuth } from "../auth/middleware.js";
import { loadTimelineConfig, type BoardConfig, type TimelineBoardConfig, type TimelineConfig } from "@case-pipeline/config";
import { batchGetItemHistory, boardConfigFor, isAutomationUser, getBoardColumnsFor, getCaseTimeline, type BoardColumn } from "@case-pipeline/query";
import { FIRM_TIMEZONE } from "../firm.js";
import { getBoardsConfig, keysByColumn, resolveColumnKeys } from "../board-column-keys.js";

export interface CaseTimelineDeps {
  db: DatabaseInstance;
  /** Override for tests; defaults to config/timeline.yaml. */
  loadConfig?: () => Promise<TimelineConfig>;
  /** Override for tests; defaults to config/boards.yaml. */
  loadBoards?: () => Promise<Record<string, BoardConfig>>;
  /** The firm's today; defaults to the clock in FIRM_TIMEZONE. */
  today?: () => string;
  /** users.db, for the staff roster's Monday user ids → names. Omitted = no names. */
  usersDb?: DatabaseInstance;
}

/** At most this many history rows in the event panel. */
const HISTORY_LIMIT = 200;

export interface TimelineItemChange {
  changedAt: string;
  /** "Calendaring Status", "Name", "Group", or what happened ("Created"). */
  what: string;
  from: string | null;
  to: string | null;
  /** A person's name, "a Monday automation", or null when unknown. */
  by: string | null;
}

const EVENT_WHAT: Record<string, string> = {
  create_pulse: "Created",
  archive_pulse: "Archived",
  delete_pulse: "Deleted",
  restore_pulse: "Restored",
};

/** Monday user id → name, from the staff roster. */
export function staffNames(usersDb: DatabaseInstance | undefined): (mondayUserId: string) => string | null {
  if (!usersDb) return () => null;
  try {
    const rows = usersDb.prepare("SELECT monday_user_id, name FROM staff WHERE monday_user_id IS NOT NULL").all() as { monday_user_id: string; name: string }[];
    const byId = new Map(rows.map((r) => [String(r.monday_user_id), r.name]));
    return (id) => byId.get(id) ?? null;
  } catch {
    return () => null; // no roster yet
  }
}

/** Column types the column write-back accepts (PATCH /api/board-items/:localId/columns). */
const EDITABLE_TYPES = new Set(["status", "dropdown", "color", "date", "numbers", "numeric", "text", "long-text", "long_text"]);

export interface TimelineItemField {
  /** Logical key (boards.yaml) the value is stored under locally. */
  key: string;
  columnId: string;
  title: string;
  type: string;
  options: BoardColumn["options"];
  /** Label, YYYY-MM-DD or text, as ColumnField takes it; "" = empty. */
  value: string;
  /** Read by the timeline for this board: shown first. */
  primary: boolean;
}

export interface TimelineItem {
  localId: string;
  boardKey: string;
  boardName: string;
  name: string;
  status: string | null;
  group: string | null;
  mondayBoardId: string | null;
  mondayItemId: string | null;
  fields: TimelineItemField[];
  /** What changed on the item, newest first (item_events; link / subitem / people noise left out). */
  history: TimelineItemChange[];
}

interface ItemRow {
  local_id: string;
  board_key: string;
  name: string;
  status: string | null;
  group_title: string | null;
  monday_item_id: string | null;
  column_values: string | null;
}

function fieldValue(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "object") {
    const o = v as { label?: unknown; labels?: unknown; date?: unknown; text?: unknown };
    if (typeof o.date === "string") return o.date.slice(0, 10);
    if (typeof o.label === "string") return o.label;
    if (Array.isArray(o.labels)) return o.labels.filter((x) => typeof x === "string").join(", ");
    if (typeof o.text === "string") return o.text;
  }
  return "";
}

/**
 * The panel's fields: every editable column the config names (so its value is
 * synced), the ones the timeline reads first — status, then the board's
 * milestone columns, then its `edit` list — the rest in Monday's order.
 */
export function planTimelineItem(
  row: ItemRow,
  board: BoardConfig | undefined,
  timeline: TimelineBoardConfig | undefined,
  columns: { mondayBoardId: string; columns: BoardColumn[] } | null,
  history: TimelineItemChange[] = [],
): TimelineItem {
  const cv = (() => {
    try {
      return (JSON.parse(row.column_values ?? "{}") ?? {}) as Record<string, unknown>;
    } catch {
      return {};
    }
  })();
  const primary = [...new Set(["status", ...(timeline?.milestones ?? []).map((m) => m.column), ...(timeline?.edit ?? [])])];
  const fields: TimelineItemField[] = [];
  const byColumn = board && columns ? keysByColumn(board, columns.columns) : new Map<string, string[]>();
  for (const col of columns?.columns ?? []) {
    if (!EDITABLE_TYPES.has(col.type) || !col.title.trim()) continue;
    // One field per Monday column, under the key the timeline reads if any, else the most specific.
    const keys = byColumn.get(col.columnId) ?? [];
    const key = keys.find((k) => primary.includes(k)) ?? keys[0];
    if (!key) continue; // not in boards.yaml, so not synced: no value to show
    fields.push({ key, columnId: col.columnId, title: col.title, type: col.type, options: col.options, value: fieldValue(cv[key]), primary: primary.includes(key) });
  }
  const rank = (f: TimelineItemField) => (f.primary ? primary.indexOf(f.key) : primary.length + (columns?.columns.findIndex((c) => c.columnId === f.columnId) ?? 0));
  fields.sort((a, b) => rank(a) - rank(b));
  return {
    localId: row.local_id,
    boardKey: row.board_key,
    boardName: board?.name ?? row.board_key,
    name: row.name,
    status: row.status,
    group: row.group_title,
    mondayBoardId: columns?.mondayBoardId ?? board?.id ?? null,
    mondayItemId: row.monday_item_id,
    fields,
    history,
  };
}

/** An item's changes for the panel, newest first. */
export function itemHistory(
  db: DatabaseInstance,
  mondayItemId: string | null,
  userName: (mondayUserId: string) => string | null,
): TimelineItemChange[] {
  if (!mondayItemId) return [];
  const changes = batchGetItemHistory(db, [mondayItemId]).get(mondayItemId) ?? [];
  return changes
    .slice(-HISTORY_LIMIT)
    .reverse()
    .map((c) => ({
      changedAt: c.changedAt,
      what: EVENT_WHAT[c.eventType] ?? (c.columnType === "group" ? "Group" : c.columnTitle ?? c.eventType),
      from: c.from,
      to: c.to,
      by: !c.userId ? null : isAutomationUser(c.userId) ? "a Monday automation" : userName(c.userId),
    }));
}

/**
 * Logical key → Monday column id per board (boards.yaml over the synced
 * schema), resolved on first use — for the timeline's moved-date columns.
 */
function columnIdResolver(db: DatabaseInstance, boards: Record<string, BoardConfig>): (boardKey: string, key: string) => string | null {
  const cache = new Map<string, Map<string, string>>();
  return (boardKey, key) => {
    let keys = cache.get(boardKey);
    if (!keys) {
      keys = new Map();
      const cfg = boards[boardKey];
      const cols = getBoardColumnsFor(db, boardKey);
      if (cfg && cols) for (const [k, c] of resolveColumnKeys(cfg, cols.columns)) keys.set(k, c.columnId);
      cache.set(boardKey, keys);
    }
    return keys.get(key) ?? null;
  };
}

export function registerCaseTimelineRoutes(app: Express, deps: CaseTimelineDeps): void {
  let config: Promise<TimelineConfig> | null = null;
  const loadConfig = deps.loadConfig ?? (() => loadTimelineConfig());
  const today = deps.today ?? (() => new Date().toLocaleDateString("en-CA", { timeZone: FIRM_TIMEZONE }));

  app.get("/api/clients/:localId/timeline", requireAuth, async (req, res) => {
    try {
      config ??= loadConfig();
      const boards = await (deps.loadBoards ?? getBoardsConfig)();
      const timeline = getCaseTimeline(deps.db, String(req.params.localId), await config, {
        today: today(),
        timeZone: FIRM_TIMEZONE,
        columnIdFor: columnIdResolver(deps.db, boards),
        userName: staffNames(deps.usersDb),
      });
      if (!timeline) {
        res.status(404).json({ error: "Client not found" });
        return;
      }
      res.json({ data: timeline });
    } catch (err) {
      config = null; // a bad read is retried on the next request
      console.error("[timeline]", err);
      res.status(500).json({ error: "Could not build the timeline" });
    }
  });

  app.get("/api/timeline/items/:localId", requireAuth, async (req, res) => {
    try {
      const row = deps.db
        .prepare(
          `SELECT local_id, board_key, name, status, group_title, monday_item_id, column_values
             FROM board_items WHERE local_id = ? AND deleted_at IS NULL`,
        )
        .get(String(req.params.localId)) as ItemRow | undefined;
      if (!row) {
        res.status(404).json({ error: "Item not found" });
        return;
      }
      config ??= loadConfig();
      const boards = await (deps.loadBoards ?? getBoardsConfig)();
      res.json({
        data: planTimelineItem(
          row,
          boards[row.board_key],
          boardConfigFor(await config, row.board_key),
          getBoardColumnsFor(deps.db, row.board_key),
          itemHistory(deps.db, row.monday_item_id, staffNames(deps.usersDb)),
        ),
      });
    } catch (err) {
      config = null;
      console.error("[timeline] item", err);
      res.status(500).json({ error: "Could not load the item" });
    }
  });
}
