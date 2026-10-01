// =============================================================================
// Court case prep stage write-back (P15 Prep Pipeline)
// =============================================================================
// Moves a court case to another Case Prep Status. Same rails as every other
// write-back — personal Monday token first, durable queue on outage, audit —
// plus two things the generic column route doesn't do:
//   - a stale check: the client sends the stage it saw (`from`); if the case has
//     moved since (another tab, the board itself), the write is refused with the
//     current stage instead of silently overwriting someone else's change;
//   - an optimistic local update of `column_values.case_prep_status`, so the
//     card stays in its new column until the next sync confirms it.
// The column id and allowed labels come from the synced board schema, never
// from the request. Plan = planPrepStageWrite (unit-tested).
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
import { getBoardColumnsFor, PREP_STAGE_COLUMN_TITLE } from "@case-pipeline/query";
import type { BoardColumns } from "@case-pipeline/query";

const BOARD_KEY = "court_cases";

export interface CourtCaseRow {
  monday_item_id: string | null;
  board_key: string;
  column_values: string;
}

export interface PrepStagePlan {
  mondayItemId: string;
  mondayBoardId: string;
  columnId: string;
  from: string | null;
  to: string;
}

export type PrepStagePlanResult =
  | { plan: PrepStagePlan }
  | { noop: true; stage: string }
  | { rejection: { status: number; error: string; current?: string | null; allowed?: string[] } };

function currentStage(columnValues: string): string | null {
  try {
    const cv = JSON.parse(columnValues) as { case_prep_status?: { label?: unknown } | null };
    const l = cv.case_prep_status?.label;
    return typeof l === "string" && l.trim() !== "" ? l.trim() : null;
  } catch {
    return null;
  }
}

export function planPrepStageWrite(
  body: { stage?: unknown; from?: unknown },
  item: CourtCaseRow | null | undefined,
  schema: BoardColumns | null,
): PrepStagePlanResult {
  if (!item || item.board_key !== BOARD_KEY) {
    return { rejection: { status: 404, error: "Court case not found" } };
  }
  if (!item.monday_item_id) {
    return { rejection: { status: 400, error: "This case has not synced to Monday yet — try again after the next sync" } };
  }
  const col = schema?.columns.find((c) => c.title === PREP_STAGE_COLUMN_TITLE);
  if (!schema || !col) {
    return { rejection: { status: 409, error: "Case Prep Status column not synced yet — run a sync first" } };
  }
  const to = typeof body.stage === "string" ? body.stage.trim() : "";
  const allowed = col.options.map((o) => o.label);
  if (!to || !allowed.includes(to)) {
    return { rejection: { status: 400, error: "Not a Case Prep Status on this board", allowed } };
  }
  const now = currentStage(item.column_values);
  // `from` is what the user saw. null/"" both mean "no stage".
  const seen = typeof body.from === "string" && body.from.trim() !== "" ? body.from.trim() : null;
  if (body.from !== undefined && seen !== now) {
    return {
      rejection: { status: 409, error: "This case's stage changed since you loaded the page", current: now },
    };
  }
  if (now === to) return { noop: true, stage: to };
  return {
    plan: { mondayItemId: item.monday_item_id, mondayBoardId: schema.mondayBoardId, columnId: col.columnId, from: now, to },
  };
}

export interface CourtCaseWriteDeps {
  db: DatabaseInstance;
  mondayApiToken: string | undefined;
  writeTokenOptions: WriteTokenOptions;
}

export function registerCourtCaseWriteRoutes(app: Express, deps: CourtCaseWriteDeps): void {
  const { db, mondayApiToken: MONDAY_API_TOKEN, writeTokenOptions } = deps;

  app.patch("/api/court-cases/:localId/prep-stage", requireAuth, async (req, res) => {
    if (!MONDAY_API_TOKEN) {
      res.status(503).json({ error: "Monday.com write-back not configured (MONDAY_API_TOKEN missing)" });
      return;
    }
    const localId = String(req.params.localId);
    const item = db
      .prepare("SELECT monday_item_id, board_key, column_values FROM board_items WHERE local_id = ? AND deleted_at IS NULL")
      .get(localId) as CourtCaseRow | undefined;
    const planned = planPrepStageWrite(
      (req.body ?? {}) as { stage?: unknown; from?: unknown },
      item,
      getBoardColumnsFor(db, BOARD_KEY),
    );
    if ("rejection" in planned) {
      const { status, ...rest } = planned.rejection;
      res.status(status).json(rest);
      return;
    }
    if ("noop" in planned) {
      res.json({ data: { localId, stage: planned.stage, pending: false } });
      return;
    }

    const { mondayItemId, mondayBoardId, columnId, from, to } = planned.plan;
    const applyLocal = () =>
      db.prepare("UPDATE board_items SET column_values = json_set(column_values, '$.case_prep_status', json(?)) WHERE local_id = ?")
        .run(JSON.stringify({ label: to }), localId);
    const audit = (extra: Record<string, unknown>) =>
      auditFromReq(req, "monday.column_changed", {
        targetType: "board_item", targetId: localId, targetMondayId: mondayItemId,
        metadata: { mondayItemId, boardKey: BOARD_KEY, columnId, columnTitle: PREP_STAGE_COLUMN_TITLE, from, to, ...extra },
      });

    try {
      const outcome = await withTokenFallback(
        (token) => dataSource.setColumnValue(mondayBoardId, mondayItemId, columnId, to, token),
        writeTokenOptions(req),
      );
      applyLocal();
      audit({ usedPersonalToken: outcome.usedPersonalToken, fellBackToSharedToken: outcome.fellBackToSharedToken });
      res.json({ data: { localId, stage: to, pending: false } });
    } catch (err) {
      console.error("[write-back] prep stage change failed; queueing for retry:", err);
      applyLocal();
      enqueueWrite(db, {
        opType: "change_column", targetTable: "board_items", targetLocalId: localId,
        mondayItemId, authorOid: req.user?.oid ?? null,
        payload: { boardId: mondayBoardId, columnId, value: to },
      });
      audit({ queued: true });
      res.status(202).json({ data: { localId, stage: to, pending: true } });
    }
  });
}
