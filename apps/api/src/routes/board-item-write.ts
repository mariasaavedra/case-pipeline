// =============================================================================
// Board item write routes
// =============================================================================
// Extracted verbatim from server.ts. Two write-backs onto an existing board
// item: the status column, and any other simple editable column. Both share
// the same rails — personal Monday token first, durable queue on outage,
// optimistic local update, audit entry.
//
// The status route's validation cascade lives in routes/status-write.ts and is
// unit-tested there.
// =============================================================================

import type { Express } from "express";
import type BetterSqlite3 from "better-sqlite3";
type DatabaseInstance = BetterSqlite3.Database;
import { requireAuth } from "../auth/middleware.js";
import { dataSource } from "../data-source/index.js";
import { withTokenFallback } from "../write-auth.js";
import type { WriteTokenOptions } from "../write-token.js";
import { enqueueWrite } from "../write-queue/processor.js";
import { auditFromReq } from "../audit/log.js";
import { getBoardStatusOptionsFor, getBoardColumnsFor } from "@case-pipeline/query";
import { planStatusWrite, type BoardItemStatusRow } from "./status-write.js";

export interface BoardItemWriteDeps {
  db: DatabaseInstance;
  mondayApiToken: string | undefined;
  writeTokenOptions: WriteTokenOptions;
}

export function registerBoardItemWriteRoutes(app: Express, deps: BoardItemWriteDeps): void {
  const { db, mondayApiToken: MONDAY_API_TOKEN, writeTokenOptions } = deps;

  // =============================================================================
  // Status write-back — change a board item's status in Monday.com
  // =============================================================================
  // Any authed staffer can change a status; the write is attributed to their
  // personal Monday token when connected. The new value is restricted to the
  // board's existing labels (from board_status_options), so we never invent a
  // status Monday doesn't have. Same resilient pattern as note write-back: write
  // through to Monday, fall back to the durable queue on outage, update live.db
  // optimistically (the next sync reconciles authoritatively), and audit.

  app.patch("/api/board-items/:localId/status", requireAuth, async (req, res) => {
    if (!MONDAY_API_TOKEN) {
      res.status(503).json({ error: "Monday.com write-back not configured (MONDAY_API_TOKEN missing)" });
      return;
    }

    const localId = String(req.params.localId);

    const item = db
      .prepare("SELECT monday_item_id, board_key, status FROM board_items WHERE local_id = ?")
      .get(localId) as BoardItemStatusRow | null;
    // The board's synced labels are the authority for what is writable — see
    // routes/status-write.ts for the validation cascade and its ordering.
    const def = item ? getBoardStatusOptionsFor(db, item.board_key) : null;
    const planned = planStatusWrite((req.body as { status?: unknown }).status, item, def);
    if ("rejection" in planned) {
      const { status: code, ...rest } = planned.rejection;
      res.status(code).json(rest);
      return;
    }
    const { status, previous, mondayItemId, mondayBoardId, statusColumnId, boardKey } = planned.plan;
    const applyLocal = () =>
      db.prepare("UPDATE board_items SET status = ? WHERE local_id = ?").run(status, localId);

    try {
      const outcome = await withTokenFallback(
        (token) => dataSource.setColumnValue(mondayBoardId, mondayItemId, statusColumnId, status, token),
        writeTokenOptions(req),
      );
      applyLocal();
      auditFromReq(req, "monday.status_changed", {
        targetType: "board_item",
        targetId: localId,
        targetMondayId: mondayItemId,
        metadata: {
          mondayItemId, boardKey, columnId: statusColumnId,
          from: previous, to: status, usedPersonalToken: outcome.usedPersonalToken,
          fellBackToSharedToken: outcome.fellBackToSharedToken,
        },
      });
      res.json({ data: { localId, status, pending: false } });
    } catch (err) {
      console.error("[write-back] changeSimpleColumnValue failed; queueing for retry:", err);
      applyLocal();
      enqueueWrite(db, {
        opType: "change_column",
        targetTable: "board_items",
        targetLocalId: localId,
        mondayItemId,
        authorOid: req.user?.oid ?? null,
        payload: { boardId: mondayBoardId, columnId: statusColumnId, value: status },
      });
      auditFromReq(req, "monday.status_changed", {
        targetType: "board_item",
        targetId: localId,
        targetMondayId: mondayItemId,
        metadata: {
          mondayItemId, boardKey, columnId: statusColumnId,
          from: previous, to: status, queued: true,
        },
      });
      res.status(202).json({ data: { localId, status, pending: true } });
    }
  });

  // =============================================================================
  // Generic column write-back — change any editable column on a board item
  // =============================================================================
  // Generalizes the status endpoint to any simple column (status/dropdown/color,
  // date, numbers, text). Value goes through change_simple_column_value; choice
  // columns are validated against the board's real options. Same resilient rails:
  // personal token, queue fallback, audit. Complex/computed columns are rejected.

  const SIMPLE_EDITABLE_TYPES = new Set([
    "status", "dropdown", "color", "date", "numbers", "numeric", "text", "long-text", "long_text",
  ]);
  const CHOICE_TYPES = new Set(["status", "dropdown", "color"]);

  app.patch("/api/board-items/:localId/columns", requireAuth, async (req, res) => {
    if (!MONDAY_API_TOKEN) {
      res.status(503).json({ error: "Monday.com write-back not configured (MONDAY_API_TOKEN missing)" });
      return;
    }

    const localId = String(req.params.localId);
    const body = req.body as { columnId?: unknown; value?: unknown };
    const columnId = (body.columnId ?? "").toString();
    const value = (body.value ?? "").toString();
    if (!columnId) {
      res.status(400).json({ error: "columnId is required" });
      return;
    }

    const item = db
      .prepare("SELECT monday_item_id, board_key FROM board_items WHERE local_id = ?")
      .get(localId) as { monday_item_id: string | null; board_key: string } | null;
    if (!item) {
      res.status(404).json({ error: "Board item not found" });
      return;
    }
    if (!item.monday_item_id) {
      res.status(400).json({ error: "Board item has no Monday.com item ID" });
      return;
    }

    const schema = getBoardColumnsFor(db, item.board_key);
    const col = schema?.columns.find((c) => c.columnId === columnId);
    if (!schema || !col) {
      res.status(409).json({ error: "Column schema not synced for this board yet — run a sync first" });
      return;
    }
    if (!SIMPLE_EDITABLE_TYPES.has(col.type)) {
      res.status(400).json({ error: `Column type '${col.type}' is not editable here` });
      return;
    }
    // Choice columns: value must be an existing label (empty clears).
    if (value && CHOICE_TYPES.has(col.type) && !col.options.some((o) => o.label === value)) {
      res.status(400).json({ error: "Value is not a valid option for this column", allowed: col.options.map((o) => o.label) });
      return;
    }

    const mondayItemId = item.monday_item_id; // narrowed; the write closure below can't re-narrow a field

    try {
      const outcome = await withTokenFallback(
        (token) => dataSource.setColumnValue(schema.mondayBoardId, mondayItemId, columnId, value, token),
        writeTokenOptions(req),
      );
      auditFromReq(req, "monday.column_changed", {
        targetType: "board_item", targetId: localId, targetMondayId: mondayItemId,
        metadata: {
          mondayItemId: item.monday_item_id, boardKey: item.board_key, columnId, columnType: col.type, value,
          usedPersonalToken: outcome.usedPersonalToken, fellBackToSharedToken: outcome.fellBackToSharedToken,
        },
      });
      res.json({ data: { localId, columnId, value, pending: false } });
    } catch (err) {
      console.error("[write-back] column change failed; queueing for retry:", err);
      enqueueWrite(db, {
        opType: "change_column", targetTable: "board_items", targetLocalId: localId,
        mondayItemId: item.monday_item_id, authorOid: req.user?.oid ?? null,
        payload: { boardId: schema.mondayBoardId, columnId, value },
      });
      auditFromReq(req, "monday.column_changed", {
        targetType: "board_item", targetId: localId, targetMondayId: mondayItemId,
        metadata: { mondayItemId: item.monday_item_id, boardKey: item.board_key, columnId, columnType: col.type, value, queued: true },
      });
      res.status(202).json({ data: { localId, columnId, value, pending: true } });
    }
  });
}
