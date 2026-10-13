// =============================================================================
// Contract fees + case type (P14 Contracts → M25 Edit contract)
// =============================================================================
// Staff correct a Fee K's AF / FF / PF and its case type (the "Contract for…"
// dropdown) from the Contracts page. Only what changed is written, in ONE
// Monday write (change_multiple_column_values). An empty fee clears the Monday
// number; a case type replaces every label the dropdown had. A case type the
// dropdown doesn't have is refused unless the client marks it new
// (`newCaseType`) — then Monday adds the label (create_labels_if_missing) and
// the local schema gets it too, so the pickers offer it before the next sync. Same rails as the signing steps —
// personal Monday token first, durable queue on outage, optimistic local
// update, audit — and the same stale check: the client sends what it saw
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
/** The longest new case type label. */
export const MAX_CASE_TYPE_LABEL = 60;

export interface ContractFeesRow {
  monday_item_id: string | null;
  af: unknown;
  ff: unknown;
  pf: unknown;
  /** The "Contract for…" labels as stored: a JSON array (text) or null. */
  contract_for?: unknown;
}

export type Fees = Record<FeeKey, number | null>;

export interface ContractFeesPlan {
  mondayItemId: string;
  mondayBoardId: string;
  from: Partial<Fees> & { caseType?: string[] };
  to: Partial<Fees> & { caseType?: string };
  /** Monday column id → change_multiple_column_values value ("" clears a fee). */
  values: Record<string, string | { labels: string[] }>;
  /** raw_column_values key → the same value, for the optimistic local update. */
  local: Partial<Record<FeeKey | "contract_for", string | { labels: string[] }>>;
  /** A brand-new case type: Monday must add the label; its column id here. */
  newLabel?: { columnId: string; label: string };
}

export type ContractFeesPlanResult =
  | { plan: ContractFeesPlan }
  | { rejection: { status: number; error: string; current?: Fees & { caseType: string[] }; allowed?: string[] } };

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

/** Stored dropdown labels (JSON text or an array) → the labels. */
function toLabels(raw: unknown): string[] {
  let v = raw;
  if (typeof v === "string") {
    try { v = JSON.parse(v); } catch { return []; }
  }
  return Array.isArray(v) ? v.filter((l): l is string => typeof l === "string" && l.trim() !== "") : [];
}

const sameLabels = (a: string[], b: string[]) => a.length === b.length && a.every((l, i) => l === b[i]);

/** The Fee Ks "Contract for…" dropdown — by title, like the New contract write. */
function caseTypeColumn(schema: BoardColumns) {
  return schema.columns.find((c) => c.type === "dropdown" && c.title.trim().toLowerCase().startsWith("contract for"));
}

export function planContractFees(
  body: { fees?: unknown; caseType?: unknown; newCaseType?: unknown; from?: unknown },
  item: ContractFeesRow | null | undefined,
  schema: BoardColumns | null,
): ContractFeesPlanResult {
  if (!item) return { rejection: { status: 404, error: "Contract not found" } };
  if (!item.monday_item_id) {
    return { rejection: { status: 400, error: "This contract has not synced to Monday yet — try again after the next sync" } };
  }
  const fees = body.fees && typeof body.fees === "object" ? (body.fees as Record<string, unknown>) : {};
  let caseType = typeof body.caseType === "string" ? body.caseType.trim().replace(/\s+/g, " ") : undefined;
  if (body.caseType !== undefined && !caseType) return { rejection: { status: 400, error: "Pick a case type" } };

  const currentFees = Object.fromEntries(FEE_KEYS.map((k) => [k, toFee(item[k]) ?? null])) as Fees;
  const currentType = toLabels(item.contract_for);
  const current = { ...currentFees, caseType: currentType };
  const seen = body.from && typeof body.from === "object" ? (body.from as Record<string, unknown>) : {};

  const to: ContractFeesPlan["to"] = {};
  for (const k of FEE_KEYS) {
    if (!Object.hasOwn(fees, k)) continue;
    const v = toFee(fees[k]);
    if (v === undefined || (v !== null && (v < 0 || v > MAX_FEE))) {
      return { rejection: { status: 400, error: `${FEE_COLUMNS[k].label} must be an amount between 0 and ${MAX_FEE.toLocaleString("en-US")}` } };
    }
    if (v !== currentFees[k]) to[k] = v === null ? null : Math.round(v * 100) / 100;
  }
  // A "new" case type that only differs in case from an existing one is that one.
  const typeCol = schema ? caseTypeColumn(schema) : undefined;
  const existing = caseType && typeCol?.options.find((o) => o.label.toLowerCase() === caseType!.toLowerCase());
  if (existing) caseType = existing.label;
  const typeChanged = caseType !== undefined && !sameLabels([caseType], currentType);
  if (Object.keys(to).length === 0 && !typeChanged) return { rejection: { status: 400, error: "Nothing changed" } };

  // Stale check on what is being changed: what the user saw must still be on Monday.
  for (const k of Object.keys(to) as FeeKey[]) {
    if (Object.hasOwn(seen, k) && (toFee(seen[k]) ?? null) !== currentFees[k]) {
      return { rejection: { status: 409, error: "This contract's fees changed since you loaded the page", current } };
    }
  }
  if (typeChanged && Object.hasOwn(seen, "caseType") && !sameLabels(toLabels(seen.caseType), currentType)) {
    return { rejection: { status: 409, error: "This contract's case type changed since you loaded the page", current } };
  }

  if (!schema) return { rejection: { status: 409, error: "Fee Ks columns not synced yet — run a sync first" } };
  const values: ContractFeesPlan["values"] = {};
  const local: ContractFeesPlan["local"] = {};
  const from: ContractFeesPlan["from"] = {};
  for (const [k, v] of Object.entries(to) as [FeeKey, number | null][]) {
    const col = FEE_COLUMNS[k];
    if (!schema.columns.some((c) => c.columnId === col.id)) {
      return { rejection: { status: 409, error: `The ${col.label} column is no longer on the Fee Ks board` } };
    }
    const value = v === null ? "" : String(v);
    values[col.id] = value;
    local[k] = value;
    from[k] = currentFees[k];
  }
  let newLabel: ContractFeesPlan["newLabel"];
  if (typeChanged && caseType) {
    const col = typeCol;
    if (!col) return { rejection: { status: 409, error: "The \"Contract for…\" column is no longer on the Fee Ks board" } };
    if (!existing) {
      if (body.newCaseType !== true) {
        return { rejection: { status: 400, error: `"${caseType}" is not a case type on Monday`, allowed: col.options.map((o) => o.label) } };
      }
      if (caseType.length > MAX_CASE_TYPE_LABEL) {
        return { rejection: { status: 400, error: `A case type can be at most ${MAX_CASE_TYPE_LABEL} characters` } };
      }
      newLabel = { columnId: col.columnId, label: caseType };
    }
    values[col.columnId] = { labels: [caseType] };
    local.contract_for = { labels: [caseType] };
    to.caseType = caseType;
    from.caseType = currentType;
  }
  return { plan: { mondayItemId: item.monday_item_id, mondayBoardId: schema.mondayBoardId, from, to, values, local, ...(newLabel ? { newLabel } : {}) } };
}

/** Append a label Monday just created to the synced column's options, so the
 *  pickers offer it before the next sync (which rewrites the options anyway). */
export function addLocalDropdownLabel(db: DatabaseInstance, boardKey: string, columnId: string, label: string): void {
  const row = db.prepare("SELECT options FROM board_columns WHERE board_key = ? AND column_id = ?")
    .get(boardKey, columnId) as { options: string | null } | undefined;
  if (!row) return;
  let options: unknown[] = [];
  try { const parsed: unknown = JSON.parse(row.options ?? "[]"); if (Array.isArray(parsed)) options = parsed; } catch { /* keep [] */ }
  if (options.some((o) => (o as { label?: unknown })?.label === label)) return;
  db.prepare("UPDATE board_columns SET options = ? WHERE board_key = ? AND column_id = ?")
    .run(JSON.stringify([...options, { label }]), boardKey, columnId);
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
                json_extract(raw_column_values, '$.pf') AS pf,
                json_extract(raw_column_values, '$.contract_for.labels') AS contract_for
           FROM contracts WHERE local_id = ? AND deleted_at IS NULL`,
      )
      .get(localId) as ContractFeesRow | undefined;
    const planned = planContractFees((req.body ?? {}) as { fees?: unknown; caseType?: unknown; newCaseType?: unknown; from?: unknown }, item, getBoardColumnsFor(db, BOARD_KEY));
    if ("rejection" in planned) {
      const { status, ...rest } = planned.rejection;
      res.status(status).json(rest);
      return;
    }

    const { mondayItemId, mondayBoardId, from, to, values, local, newLabel } = planned.plan;
    const applyLocal = () => {
      for (const [key, value] of Object.entries(local)) {
        // A dropdown is stored as an object ({labels}); json() keeps it one.
        const isJson = typeof value === "object";
        db.prepare(`UPDATE contracts SET raw_column_values = json_set(COALESCE(raw_column_values, '{}'), '$.${key}', ${isJson ? "json(?)" : "?"}) WHERE local_id = ?`)
          .run(isJson ? JSON.stringify(value) : value, localId);
      }
      // A new case type joins the local options, so M11 / M25 offer it before the next sync.
      if (newLabel) addLocalDropdownLabel(db, BOARD_KEY, newLabel.columnId, newLabel.label);
    };
    const audit = (extra: Record<string, unknown>) =>
      auditFromReq(req, "monday.contract_fees", {
        targetType: "contract", targetId: localId, targetMondayId: mondayItemId,
        metadata: { mondayItemId, boardKey: BOARD_KEY, from, to, ...(newLabel ? { newCaseType: true } : {}), ...extra },
      });

    let pending = false;
    try {
      const outcome = await withTokenFallback(
        (token) => dataSource.setColumnValues(mondayBoardId, mondayItemId, values, token, !!newLabel),
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
          payload: { boardId: mondayBoardId, columnId, value, ...(newLabel?.columnId === columnId ? { createLabelsIfMissing: true } : {}) },
        });
      }
      audit({ queued: true });
    }
    applyLocal();
    const { caseType: newType, ...fees } = to;
    res.status(pending ? 202 : 200).json({ data: { localId, fees, ...(newType ? { caseType: newType } : {}), pending } });
  });
}
