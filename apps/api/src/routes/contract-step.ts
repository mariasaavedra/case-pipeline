// =============================================================================
// Contract signing steps (P14 Contracts)
// =============================================================================
// Contracts are signed in Acrobat Pro — attorney first, then the client — which
// can't be connected to the app, so staff record each step here. A step moves
// the Fee K's Contract Stage and stamps the date that goes with it, in ONE
// Monday write (change_multiple_column_values), so a stage never lands without
// its date:
//   sent_for_signature → Atty Reviewing
//   attorney_signed    → Sent to Client      + Contract Sent On
//   client_signed      → Needs Payment Link  + Signed Contract Received On
//   payment_link_sent  → Payment link sent   + Payment Link Sent On
// Same rails as every other write-back — personal Monday token first, durable
// queue on outage, optimistic local update, audit — plus a stale check: the
// client sends the stage it saw (`from`); if the contract moved since, the
// write is refused with the current stage. Step table = CONTRACT_STEPS in
// libs/query/src/pending-contracts.ts. Plan = planContractStep (unit-tested).
// =============================================================================

import type { Express } from "express";
import type BetterSqlite3 from "better-sqlite3";
type DatabaseInstance = BetterSqlite3.Database;
import { requireAuth } from "../auth/middleware.js";
import { dataSource } from "../data-source/index.js";
import { withTokenFallback } from "../write-auth.js";
import type { TokenFallbackOptions } from "../write-auth.js";
import type { WriteTokenOptions } from "../write-token.js";
import { enqueueWrite } from "../write-queue/processor.js";
import { auditFromReq } from "../audit/log.js";
import { feeKCaseTypeSql, getBoardColumnsFor, CONTRACT_STEPS, FEE_K_COLUMN_IDS } from "@case-pipeline/query";
import type { BoardColumns, ContractStep } from "@case-pipeline/query";
import { notifyEvent, inBackground, mondayItemUrl } from "../notify/slack.js";
import { contractStepEvent } from "../notify/events.js";

const BOARD_KEY = "fee_ks";

export interface ContractRow {
  monday_item_id: string | null;
  /** Contract Stage label from raw_column_values (null when unset). */
  stage: string | null;
}

export interface ContractStepPlan {
  step: ContractStep;
  mondayItemId: string;
  mondayBoardId: string;
  from: string | null;
  to: string;
  /** Monday column id → change_multiple_column_values value. */
  values: Record<string, { label: string } | { date: string }>;
  /** raw_column_values key → the same value, for the optimistic local update. */
  local: Record<string, { label: string } | { date: string }>;
}

export type ContractStepPlanResult =
  | { plan: ContractStepPlan }
  | { rejection: { status: number; error: string; current?: string | null; allowed?: string[] } };

export function planContractStep(
  body: { step?: unknown; from?: unknown },
  item: ContractRow | null | undefined,
  schema: BoardColumns | null,
  today: string,
): ContractStepPlanResult {
  if (!item) return { rejection: { status: 404, error: "Contract not found" } };
  if (!item.monday_item_id) {
    return { rejection: { status: 400, error: "This contract has not synced to Monday yet — try again after the next sync" } };
  }
  const step = typeof body.step === "string" ? body.step : "";
  if (!Object.hasOwn(CONTRACT_STEPS, step)) {
    return { rejection: { status: 400, error: "Unknown step", allowed: Object.keys(CONTRACT_STEPS) } };
  }
  const def = CONTRACT_STEPS[step as ContractStep];

  const stageCol = schema?.columns.find((c) => c.columnId === FEE_K_COLUMN_IDS.contractStage.id);
  if (!schema || !stageCol) {
    return { rejection: { status: 409, error: "Fee Ks Contract Stage column not synced yet — run a sync first" } };
  }
  if (!stageCol.options.some((o) => o.label === def.to)) {
    return { rejection: { status: 409, error: `"${def.to}" is no longer a Contract Stage on Monday` } };
  }

  const now = item.stage?.trim() || null;
  const seen = typeof body.from === "string" && body.from.trim() !== "" ? body.from.trim() : null;
  if (body.from !== undefined && seen !== now) {
    return { rejection: { status: 409, error: "This contract's stage changed since you loaded the page", current: now } };
  }
  if (!def.from.includes(now)) {
    return { rejection: { status: 409, error: `Can't do this step from the "${now ?? "No stage"}" stage`, current: now } };
  }

  const values: ContractStepPlan["values"] = { [stageCol.columnId]: { label: def.to } };
  const local: ContractStepPlan["local"] = { [FEE_K_COLUMN_IDS.contractStage.key]: { label: def.to } };
  if (def.date) {
    const col = FEE_K_COLUMN_IDS[def.date];
    // Write the date only when the board has the column; the stage still goes.
    if (schema.columns.some((c) => c.columnId === col.id)) {
      values[col.id] = { date: today };
      local[col.key] = { date: today };
    }
  }
  return {
    plan: { step: step as ContractStep, mondayItemId: item.monday_item_id, mondayBoardId: schema.mondayBoardId, from: now, to: def.to, values, local },
  };
}

export interface ContractStepDeps {
  db: DatabaseInstance;
  mondayApiToken: string | undefined;
  writeTokenOptions: WriteTokenOptions;
}

export interface ContractStepActor {
  tokenOptions: TokenFallbackOptions;
  /** Azure OID for the write queue (a retry posts under their token); null = shared token. */
  authorOid: string | null;
  audit: (action: string, opts: { targetType: string; targetId: string; targetMondayId: string; metadata: Record<string, unknown> }) => void;
}

export type ContractStepOutcome =
  | { ok: true; status: 200 | 202; data: { localId: string; step: ContractStep; stage: string; date: string; pending: boolean } }
  | { ok: false; status: number; body: Record<string, unknown> };

/**
 * Plan + write one step. Used by the P14 menu (the caller's token) and by the
 * Adobe Sign receiver (routes/esign.ts — the sender's token, no `from`).
 */
export async function executeContractStep(
  db: DatabaseInstance,
  localId: string,
  body: { step?: unknown; from?: unknown },
  actor: ContractStepActor,
): Promise<ContractStepOutcome> {
  const item = db
    .prepare(
      `SELECT monday_item_id, json_extract(raw_column_values, '$.contract_stage.label') AS stage
         FROM contracts WHERE local_id = ? AND deleted_at IS NULL`,
    )
    .get(localId) as ContractRow | undefined;
  const today = new Date().toISOString().slice(0, 10);
  const planned = planContractStep(body, item, getBoardColumnsFor(db, BOARD_KEY), today);
  if ("rejection" in planned) {
    const { status, ...rest } = planned.rejection;
    return { ok: false, status, body: rest };
  }

  const { step, mondayItemId, mondayBoardId, from, to, values, local } = planned.plan;
  const applyLocal = () => {
    for (const [key, value] of Object.entries(local)) {
      db.prepare(`UPDATE contracts SET raw_column_values = json_set(COALESCE(raw_column_values, '{}'), '$.${key}', json(?)) WHERE local_id = ?`)
        .run(JSON.stringify(value), localId);
    }
  };
  const audit = (extra: Record<string, unknown>) =>
    actor.audit("monday.contract_step", {
      targetType: "contract", targetId: localId, targetMondayId: mondayItemId,
      metadata: { mondayItemId, boardKey: BOARD_KEY, step, from, to, columns: Object.keys(values), ...extra },
    });

  let pending = false;
  try {
    const outcome = await withTokenFallback(
      (token) => dataSource.setColumnValues(mondayBoardId, mondayItemId, values, token),
      actor.tokenOptions,
    );
    audit({ usedPersonalToken: outcome.usedPersonalToken, fellBackToSharedToken: outcome.fellBackToSharedToken });
  } catch (err) {
    console.error("[write-back] contract step failed; queueing for retry:", err);
    pending = true;
    for (const [columnId, value] of Object.entries(values)) {
      enqueueWrite(db, {
        opType: "change_column_json", targetTable: "contracts", targetLocalId: localId,
        mondayItemId, authorOid: actor.authorOid,
        payload: { boardId: mondayBoardId, columnId, value },
      });
    }
    audit({ queued: true });
  }
  applyLocal();
  return { ok: true, status: pending ? 202 : 200, data: { localId, step, stage: to, date: today, pending } };
}

export function registerContractStepRoutes(app: Express, deps: ContractStepDeps): void {
  const { db, mondayApiToken: MONDAY_API_TOKEN, writeTokenOptions } = deps;

  app.post("/api/contracts/:localId/step", requireAuth, async (req, res) => {
    if (!MONDAY_API_TOKEN) {
      res.status(503).json({ error: "Monday.com write-back not configured (MONDAY_API_TOKEN missing)" });
      return;
    }
    const result = await executeContractStep(db, String(req.params.localId), (req.body ?? {}) as { step?: unknown; from?: unknown }, {
      tokenOptions: writeTokenOptions(req),
      authorOid: req.user?.oid ?? null,
      audit: (action, opts) => auditFromReq(req, action, opts),
    });
    if (result.ok) {
      res.status(result.status).json({ data: result.data });
      // Slack: only here, not in executeContractStep — the Adobe Sign receiver
      // shares that function and posts its own message (esign/notify.ts).
      const c = db
        .prepare(
          `SELECT c.monday_item_id AS mondayItemId, COALESCE(p.name, c.name) AS clientName,
                  ${feeKCaseTypeSql()} AS contractFor
             FROM contracts c LEFT JOIN profiles p ON p.local_id = c.profile_local_id
            WHERE c.local_id = ?`,
        )
        .get(String(req.params.localId)) as { mondayItemId: string | null; clientName: string; contractFor: string | null } | undefined;
      const text = c && contractStepEvent({
        step: result.data.step,
        clientName: c.clientName,
        contractFor: parseLabelList(c.contractFor),
        by: req.user?.name,
        link: mondayItemUrl(getBoardColumnsFor(db, BOARD_KEY)?.mondayBoardId, c.mondayItemId),
      });
      if (text) inBackground(notifyEvent(result.data.step === "client_signed" ? "contract_signed" : "payment_link_sent", text));
    } else res.status(result.status).json(result.body);
  });
}

/** contract_for.labels as stored: a JSON array (or a JSON-encoded string of one). */
function parseLabelList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
