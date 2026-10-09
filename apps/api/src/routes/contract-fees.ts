// =============================================================================
// Contract fees (P14 Contracts → M25 Edit fees)
// =============================================================================
// Staff correct a Fee K's AF / FF / PF from the Contracts page. Only the fees
// that changed are written, in ONE Monday write (change_multiple_column_values).
// An empty fee clears the Monday number. Same rails as the signing steps —
// personal Monday token first, durable queue on outage, optimistic local
// update, audit — and the same stale check: the client sends the fees it saw
// (`from`); if any of them changed on Monday since, the write is refused with
// the current values. Plan = planContractFees (unit-tested).
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
import { getBoardColumnsFor } from "@case-pipeline/query";
import type { BoardColumns } from "@case-pipeline/query";

const BOARD_KEY = "fee_ks";

export type FeeKey = "af" | "ff" | "pf";

/** Fee → Monday number column id (by_id in config/boards.yaml) and its raw_column_values key. */
export const FEE_COLUMNS: Record<FeeKey, { id: string; label: string }> = {
  af: { id: "deal_value", label: "AF" },
  ff: { id: "numbers__1", label: "FF" },
  pf: { id: "numbers5__1", label: "PF" },
};
const FEE_KEYS = Object.keys(FEE_COLUMNS) as FeeKey[];

/** The most a fee can be — guards against a typo with extra zeros. */
const MAX_FEE = 1_000_000;

export interface ContractFeesRow {
  monday_item_id: string | null;
  af: unknown;
  ff: unknown;
  pf: unknown;
}

export type Fees = Record<FeeKey, number | null>;

export interface ContractFeesPlan {
  mondayItemId: string;
  mondayBoardId: string;
  from: Partial<Fees>;
  to: Partial<Fees>;
  /** Monday column id → change_multiple_column_values value ("" clears). */
  values: Record<string, string>;
  /** raw_column_values key → the same value, for the optimistic local update. */
  local: Partial<Record<FeeKey, string>>;
}

export type ContractFeesPlanResult =
  | { plan: ContractFeesPlan }
  | { rejection: { status: number; error: string; current?: Fees } };

/** A stored or submitted fee as a number; null = not set. undefined = not a fee. */
function toFee(raw: unknown): number | null | undefined {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : undefined;
  if (typeof raw === "string") {
    const s = raw.replace(/[$,\s]/g, "");
    if (s === "") return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

export function planContractFees(
  body: { fees?: unknown; from?: unknown },
  item: ContractFeesRow | null | undefined,
  schema: BoardColumns | null,
): ContractFeesPlanResult {
  if (!item) return { rejection: { status: 404, error: "Contract not found" } };
  if (!item.monday_item_id) {
    return { rejection: { status: 400, error: "This contract has not synced to Monday yet — try again after the next sync" } };
  }
  const fees = body.fees && typeof body.fees === "object" ? (body.fees as Record<string, unknown>) : null;
  if (!fees) return { rejection: { status: 400, error: "No fees to save" } };

  const current = Object.fromEntries(FEE_KEYS.map((k) => [k, toFee(item[k]) ?? null])) as Fees;
  const seen = body.from && typeof body.from === "object" ? (body.from as Record<string, unknown>) : {};

  const to: Partial<Fees> = {};
  for (const k of FEE_KEYS) {
    if (!Object.hasOwn(fees, k)) continue;
    const v = toFee(fees[k]);
    if (v === undefined || (v !== null && (v < 0 || v > MAX_FEE))) {
      return { rejection: { status: 400, error: `${FEE_COLUMNS[k].label} must be an amount between 0 and ${MAX_FEE.toLocaleString("en-US")}` } };
    }
    if (v !== current[k]) to[k] = v === null ? null : Math.round(v * 100) / 100;
  }
  if (Object.keys(to).length === 0) return { rejection: { status: 400, error: "Nothing changed" } };

  // Stale check on the fees being changed: what the user saw must still be on Monday.
  for (const k of Object.keys(to) as FeeKey[]) {
    if (Object.hasOwn(seen, k) && (toFee(seen[k]) ?? null) !== current[k]) {
      return { rejection: { status: 409, error: "This contract's fees changed since you loaded the page", current } };
    }
  }

  if (!schema) return { rejection: { status: 409, error: "Fee Ks columns not synced yet — run a sync first" } };
  const values: Record<string, string> = {};
  const local: ContractFeesPlan["local"] = {};
  const from: Partial<Fees> = {};
  for (const [k, v] of Object.entries(to) as [FeeKey, number | null][]) {
    const col = FEE_COLUMNS[k];
    if (!schema.columns.some((c) => c.columnId === col.id)) {
      return { rejection: { status: 409, error: `The ${col.label} column is no longer on the Fee Ks board` } };
    }
    values[col.id] = v === null ? "" : String(v);
    local[k] = values[col.id];
    from[k] = current[k];
  }
  return { plan: { mondayItemId: item.monday_item_id, mondayBoardId: schema.mondayBoardId, from, to, values, local } };
}

export interface ContractFeesDeps {
  db: DatabaseInstance;
  mondayApiToken: string | undefined;
  writeTokenOptions: WriteTokenOptions;
}

export function registerContractFeesRoutes(app: Express, deps: ContractFeesDeps): void {
  const { db, mondayApiToken: MONDAY_API_TOKEN, writeTokenOptions } = deps;

  app.patch("/api/contracts/:localId/fees", requireAuth, async (req, res) => {
    if (!MONDAY_API_TOKEN) {
      res.status(503).json({ error: "Monday.com write-back not configured (MONDAY_API_TOKEN missing)" });
      return;
    }
    const localId = String(req.params.localId);
    const item = db
      .prepare(
        `SELECT monday_item_id,
                json_extract(raw_column_values, '$.af') AS af,
                json_extract(raw_column_values, '$.ff') AS ff,
                json_extract(raw_column_values, '$.pf') AS pf
           FROM contracts WHERE local_id = ? AND deleted_at IS NULL`,
      )
      .get(localId) as ContractFeesRow | undefined;
    const planned = planContractFees((req.body ?? {}) as { fees?: unknown; from?: unknown }, item, getBoardColumnsFor(db, BOARD_KEY));
    if ("rejection" in planned) {
      const { status, ...rest } = planned.rejection;
      res.status(status).json(rest);
      return;
    }

    const { mondayItemId, mondayBoardId, from, to, values, local } = planned.plan;
    const applyLocal = () => {
      for (const [key, value] of Object.entries(local)) {
        db.prepare(`UPDATE contracts SET raw_column_values = json_set(COALESCE(raw_column_values, '{}'), '$.${key}', ?) WHERE local_id = ?`)
          .run(value, localId);
      }
    };
    const audit = (extra: Record<string, unknown>) =>
      auditFromReq(req, "monday.contract_fees", {
        targetType: "contract", targetId: localId, targetMondayId: mondayItemId,
        metadata: { mondayItemId, boardKey: BOARD_KEY, from, to, ...extra },
      });

    let pending = false;
    try {
      const outcome = await withTokenFallback(
        (token) => dataSource.setColumnValues(mondayBoardId, mondayItemId, values, token),
        writeTokenOptions(req),
      );
      audit({ usedPersonalToken: outcome.usedPersonalToken, fellBackToSharedToken: outcome.fellBackToSharedToken });
    } catch (err) {
      console.error("[write-back] contract fees failed; queueing for retry:", err);
      pending = true;
      for (const [columnId, value] of Object.entries(values)) {
        enqueueWrite(db, {
          opType: "change_column_json", targetTable: "contracts", targetLocalId: localId,
          mondayItemId, authorOid: req.user?.oid ?? null,
          payload: { boardId: mondayBoardId, columnId, value },
        });
      }
      audit({ queued: true });
    }
    applyLocal();
    res.status(pending ? 202 : 200).json({ data: { localId, fees: to, pending } });
  });
}
