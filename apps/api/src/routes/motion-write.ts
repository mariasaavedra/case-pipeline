// =============================================================================
// Motion status write-back (P15 Motions tab)
// =============================================================================
// Changes a motion's Status on the Motions board, and stamps the date that goes
// with it: "Filed" → MTN Filed on, Granted / Denied (incl. "… - NO JO") → Dec.
// Date. Same rails as every other write-back — personal Monday token first,
// durable queue on outage, audit — plus:
//   - a stale check: the client sends the status it saw (`from`); if the motion
//     changed since, the write is refused with the current status;
//   - an optimistic local update of `status` and the date in `column_values`,
//     so the Motions tab shows the decision before the next sync.
// Column ids and allowed labels come from the synced board schema, never from
// the request. Monday may move the item to another group by automation; the
// app reads the phase from the status, so it doesn't depend on that.
// Plan = planMotionStatusWrite (unit-tested).
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
import { getBoardColumnsFor, MOTION_COLUMN_IDS, motionDateFieldFor, motionPhaseOf } from "@case-pipeline/query";
import type { BoardColumns } from "@case-pipeline/query";

const BOARD_KEY = "motions";

export interface MotionRow {
  monday_item_id: string | null;
  board_key: string;
  status: string | null;
  group_title?: string | null;
}

export interface MotionStatusPlan {
  mondayItemId: string;
  mondayBoardId: string;
  statusColumnId: string;
  from: string | null;
  to: string;
  /** The date written with this status, when the status carries one. */
  date: { field: "filed_on" | "decided_on"; key: string; columnId: string; value: string } | null;
}

export type MotionStatusPlanResult =
  | { plan: MotionStatusPlan }
  | { rejection: { status: number; error: string; current?: string | null; allowed?: string[] } };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function planMotionStatusWrite(
  body: { status?: unknown; from?: unknown; date?: unknown },
  item: MotionRow | null | undefined,
  schema: BoardColumns | null,
  today: string,
): MotionStatusPlanResult {
  if (!item || item.board_key !== BOARD_KEY) {
    return { rejection: { status: 404, error: "Motion not found" } };
  }
  if (!item.monday_item_id) {
    return { rejection: { status: 400, error: "This motion has not synced to Monday yet — try again after the next sync" } };
  }
  const statusCol = schema?.columns.find((c) => c.columnId === MOTION_COLUMN_IDS.status);
  if (!schema || !statusCol) {
    return { rejection: { status: 409, error: "Motions Status column not synced yet — run a sync first" } };
  }
  const to = typeof body.status === "string" ? body.status.trim() : "";
  const allowed = statusCol.options.map((o) => o.label);
  if (!to || !allowed.includes(to)) {
    return { rejection: { status: 400, error: "Not a Status on the Motions board", allowed } };
  }
  const now = item.status?.trim() || null;
  const seen = typeof body.from === "string" && body.from.trim() !== "" ? body.from.trim() : null;
  if (body.from !== undefined && seen !== now) {
    return { rejection: { status: 409, error: "This motion's status changed since you loaded the page", current: now } };
  }

  let date: MotionStatusPlan["date"] = null;
  const field = motionDateFieldFor(to);
  if (field) {
    const value = body.date === undefined || body.date === null || body.date === "" ? today : String(body.date);
    if (!ISO_DATE.test(value) || Number.isNaN(new Date(value).getTime())) {
      return { rejection: { status: 400, error: "Date must be YYYY-MM-DD" } };
    }
    if (value > today) {
      return { rejection: { status: 400, error: "Date can't be in the future" } };
    }
    const columnId = field === "filed_on" ? MOTION_COLUMN_IDS.filedOn : MOTION_COLUMN_IDS.decidedOn;
    // Write the date only when the board has the column; the status still goes.
    if (schema.columns.some((c) => c.columnId === columnId)) {
      date = { field, key: field === "filed_on" ? "mtn_filed_on" : "dec_date", columnId, value };
    }
  }
  if (now === to && !date) {
    return { rejection: { status: 409, error: "The motion already has this status", current: now } };
  }
  return {
    plan: { mondayItemId: item.monday_item_id, mondayBoardId: schema.mondayBoardId, statusColumnId: statusCol.columnId, from: now, to, date },
  };
}

export interface MotionWriteDeps {
  db: DatabaseInstance;
  mondayApiToken: string | undefined;
  writeTokenOptions: WriteTokenOptions;
}

export function registerMotionWriteRoutes(app: Express, deps: MotionWriteDeps): void {
  const { db, mondayApiToken: MONDAY_API_TOKEN, writeTokenOptions } = deps;

  app.patch("/api/motions/:localId/status", requireAuth, async (req, res) => {
    if (!MONDAY_API_TOKEN) {
      res.status(503).json({ error: "Monday.com write-back not configured (MONDAY_API_TOKEN missing)" });
      return;
    }
    const localId = String(req.params.localId);
    const item = db
      .prepare("SELECT monday_item_id, board_key, status, group_title FROM board_items WHERE local_id = ? AND deleted_at IS NULL")
      .get(localId) as MotionRow | undefined;
    const today = new Date().toISOString().slice(0, 10);
    const planned = planMotionStatusWrite(
      (req.body ?? {}) as { status?: unknown; from?: unknown; date?: unknown },
      item,
      getBoardColumnsFor(db, BOARD_KEY),
      today,
    );
    if ("rejection" in planned) {
      const { status, ...rest } = planned.rejection;
      res.status(status).json(rest);
      return;
    }

    const { mondayItemId, mondayBoardId, statusColumnId, from, to, date } = planned.plan;
    const applyLocal = () => {
      db.prepare("UPDATE board_items SET status = ?, column_values = json_set(column_values, '$.status', json(?)) WHERE local_id = ?")
        .run(to, JSON.stringify({ label: to }), localId);
      if (date) {
        db.prepare(`UPDATE board_items SET column_values = json_set(column_values, '$.${date.key}', json(?)) WHERE local_id = ?`)
          .run(JSON.stringify({ date: date.value }), localId);
      }
    };
    const queue = (columnId: string, value: string) =>
      enqueueWrite(db, {
        opType: "change_column", targetTable: "board_items", targetLocalId: localId,
        mondayItemId, authorOid: req.user?.oid ?? null,
        payload: { boardId: mondayBoardId, columnId, value },
      });
    const audit = (extra: Record<string, unknown>) =>
      auditFromReq(req, "monday.status_changed", {
        targetType: "board_item", targetId: localId, targetMondayId: mondayItemId,
        metadata: {
          mondayItemId, boardKey: BOARD_KEY, columnId: statusColumnId, from, to,
          ...(date ? { dateColumnId: date.columnId, date: date.value } : {}), ...extra,
        },
      });
    const reply = (pending: boolean) =>
      res.status(pending ? 202 : 200).json({
        data: { localId, status: to, phase: motionPhaseOf(item?.group_title ?? null, to), filedOn: date?.field === "filed_on" ? date.value : undefined, decidedOn: date?.field === "decided_on" ? date.value : undefined, pending },
      });

    // Status first; the date only after it, so a date never lands on a motion
    // whose status write failed outright.
    let outcome;
    try {
      outcome = from === to
        ? null
        : await withTokenFallback(
            (token) => dataSource.setColumnValue(mondayBoardId, mondayItemId, statusColumnId, to, token),
            writeTokenOptions(req),
          );
    } catch (err) {
      console.error("[write-back] motion status change failed; queueing for retry:", err);
      applyLocal();
      queue(statusColumnId, to);
      if (date) queue(date.columnId, date.value);
      audit({ queued: true });
      reply(true);
      return;
    }

    let dateQueued = false;
    if (date) {
      try {
        await withTokenFallback(
          (token) => dataSource.setColumnValue(mondayBoardId, mondayItemId, date.columnId, date.value, token),
          writeTokenOptions(req),
        );
      } catch (err) {
        console.error("[write-back] motion date write failed; queueing for retry:", err);
        queue(date.columnId, date.value);
        dateQueued = true;
      }
    }
    applyLocal();
    audit({
      usedPersonalToken: outcome?.usedPersonalToken, fellBackToSharedToken: outcome?.fellBackToSharedToken,
      ...(dateQueued ? { dateQueued: true } : {}),
    });
    reply(dateQueued);
  });
}
