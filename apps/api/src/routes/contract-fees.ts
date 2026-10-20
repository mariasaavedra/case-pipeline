// =============================================================================
// Contract fees + case type (P14 Contracts → M25 Edit contract)
// =============================================================================
// Staff correct a Fee K's AF / FF / PF and its case type (the "Fee K Type"
// dropdown; older Fee Ks show "Contract for…" until one is picked) from the Contracts page. Only what changed is written, in ONE
// Monday write (change_multiple_column_values). An empty fee clears the Monday
// number; a case type replaces every label the dropdown had. A case type the
// dropdown doesn't have is refused unless the client marks it new
// (`newCaseType`) — then Monday adds the label (create_labels_if_missing) and
// the local schema gets it too, so the pickers offer it before the next sync. Same rails as the signing steps —
// personal Monday token first, durable queue on outage, optimistic local
// update, audit — and the same stale check: the client sends what it saw
// (`from`); if any of them changed on Monday since, the write is refused with
// the current values. Plan = planContractFees (unit-tested).
//
// Since 2026-10-14 M25 edits everything a contract needs, not only fees and
// case type: also the attorney (the Fee K's People column, same write) and the
// client's e-mail + address — those live on the PROFILE (the Fee K mirrors
// them), so they go out as a second write to the profile item. Same stale
// check for each (`from.attorney`, `from.email`, `from.address`).
// GET /api/contract-info?profile= gives M11 / M2 / M25 the pre-fill: the
// profile's e-mail, address and attorney, and the attorney pick list.
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
import { caseTypeColumn, feeKCaseTypeSql, getBoardColumnsFor } from "@case-pipeline/query";
import { usersDb } from "../db/users-db.js";
import {
  FEE_K_ATTORNEY, applyProfileContactLocally, cleanContact, contractAttorneys, makeMondayUserResolver,
  peopleValue, planProfileContact, splitPeople,
} from "../contract-info.js";
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
  /** The case type labels as stored (Fee K Type, else Contract for — feeKCaseTypeSql): a JSON array (text) or null. */
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
  local: Partial<Record<FeeKey | "fee_k_type", string | { labels: string[] }>>;
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

// The case-type dropdown the app writes is "Fee K Type" (curated, one label,
// required by Monday since 2026-10). Older Fee Ks may only have "Contract
// for…", which readers fall back to (feeKCaseTypeSql).
export { caseTypeColumn };

export function planContractFees(
  body: { fees?: unknown; caseType?: unknown; newCaseType?: unknown; from?: unknown },
  item: ContractFeesRow | null | undefined,
  schema: BoardColumns | null,
  opts: { allowNoChange?: boolean } = {},
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
  if (Object.keys(to).length === 0 && !typeChanged) {
    if (!opts.allowNoChange) return { rejection: { status: 400, error: "Nothing changed" } };
    if (!schema) return { rejection: { status: 409, error: "Fee Ks columns not synced yet — run a sync first" } };
    return { plan: { mondayItemId: item.monday_item_id, mondayBoardId: schema.mondayBoardId, from: {}, to: {}, values: {}, local: {} } };
  }

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
    if (!col) return { rejection: { status: 409, error: "The \"Fee K Type\" column is no longer on the Fee Ks board" } };
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
    local.fee_k_type = { labels: [caseType] };
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
  const resolveMondayUser = makeMondayUserResolver(MONDAY_API_TOKEN, usersDb);

  // Pre-fill for M11 / M2 / M25: the client's e-mail, address and attorney
  // (from the profile), plus who can be picked as the attorney.
  app.get("/api/contract-info", requireAuth, (req, res) => {
    const profileLocalId = typeof req.query.profile === "string" ? req.query.profile : "";
    const p = profileLocalId
      ? (db.prepare(
          `SELECT email, address, json_extract(raw_column_values, '$.attorney.label') AS attorney
             FROM profiles WHERE local_id = ?`,
        ).get(profileLocalId) as { email: string | null; address: string | null; attorney: string | null } | undefined)
      : undefined;
    res.json({
      data: {
        attorneys: contractAttorneys(db),
        email: p?.email?.trim() ?? "",
        address: p?.address?.trim() ?? "",
        attorney: splitPeople(p?.attorney)[0] ?? "",
      },
    });
  });

  app.patch("/api/contracts/:localId/fees", requireAuth, async (req, res) => {
    if (!MONDAY_API_TOKEN) {
      res.status(503).json({ error: "Monday.com write-back not configured (MONDAY_API_TOKEN missing)" });
      return;
    }
    const localId = String(req.params.localId);
    const item = db
      .prepare(
        `SELECT c.monday_item_id,
                json_extract(c.raw_column_values, '$.af') AS af,
                json_extract(c.raw_column_values, '$.ff') AS ff,
                json_extract(c.raw_column_values, '$.pf') AS pf,
                ${feeKCaseTypeSql()} AS contract_for,
                json_extract(c.raw_column_values, '$.attorney.label') AS attorney,
                p.local_id AS profile_local_id, p.monday_item_id AS profile_monday_id, p.email, p.address
           FROM contracts c LEFT JOIN profiles p ON p.local_id = c.profile_local_id
          WHERE c.local_id = ? AND c.deleted_at IS NULL`,
      )
      .get(localId) as (ContractFeesRow & {
        attorney: string | null; profile_local_id: string | null; profile_monday_id: string | null;
        email: string | null; address: string | null;
      }) | undefined;
    const body = (req.body ?? {}) as {
      fees?: unknown; caseType?: unknown; newCaseType?: unknown; from?: unknown;
      attorney?: unknown; email?: unknown; address?: unknown;
    };
    const seen = body.from && typeof body.from === "object" ? (body.from as Record<string, unknown>) : {};
    const planned = planContractFees(body, item, getBoardColumnsFor(db, BOARD_KEY), { allowNoChange: true });
    if ("rejection" in planned) {
      const { status, ...rest } = planned.rejection;
      res.status(status).json(rest);
      return;
    }
    const row = item!;

    // Attorney: the Fee K's People column, in the same write as the fees.
    const currentAttorneys = splitPeople(row.attorney);
    const attorney = typeof body.attorney === "string" ? body.attorney.trim().replace(/\s+/g, " ") : undefined;
    if (body.attorney !== undefined && !attorney) {
      res.status(400).json({ error: "Pick the attorney" });
      return;
    }
    const attorneyChanged = attorney !== undefined && !(currentAttorneys.length === 1 && currentAttorneys[0]!.toLowerCase() === attorney.toLowerCase());
    if (attorneyChanged && Object.hasOwn(seen, "attorney")) {
      const saw = Array.isArray(seen.attorney) ? (seen.attorney as unknown[]).map(String) : [];
      if (saw.join("|").toLowerCase() !== currentAttorneys.join("|").toLowerCase()) {
        res.status(409).json({ error: "This contract's attorney changed since you loaded the page", current: { attorney: currentAttorneys } });
        return;
      }
    }

    // E-mail / address: on the client's profile.
    const contact = cleanContact({ email: body.email, address: body.address }, false);
    if ("error" in contact) {
      res.status(400).json({ error: contact.error });
      return;
    }
    if ((contact.email !== undefined && !contact.email) || (contact.address !== undefined && !contact.address)) {
      res.status(400).json({ error: "The client's e-mail and address can't be emptied here" });
      return;
    }
    const profileSchema = getBoardColumnsFor(db, "profiles");
    const contactPlan = planProfileContact({ email: row.email, address: row.address }, contact, profileSchema);
    if (contactPlan.changed.length > 0) {
      if (!row.profile_local_id || !row.profile_monday_id || !profileSchema) {
        res.status(409).json({ error: "This contract isn't linked to a client profile on Monday — link it there first" });
        return;
      }
      for (const key of contactPlan.changed) {
        if (Object.hasOwn(seen, key) && String(seen[key] ?? "").trim() !== (row[key] ?? "").trim()) {
          res.status(409).json({ error: `The client's ${key === "email" ? "e-mail" : "address"} changed since you loaded the page`, current: { email: row.email, address: row.address } });
          return;
        }
      }
    }

    const { mondayItemId, mondayBoardId, from, to, values, local, newLabel } = planned.plan;
    let attorneyUserId: number | null = null;
    if (attorneyChanged) {
      if (!getBoardColumnsFor(db, BOARD_KEY)?.columns.some((c) => c.columnId === FEE_K_ATTORNEY.id)) {
        res.status(409).json({ error: "The Attorney column is no longer on the Fee Ks board" });
        return;
      }
      try {
        attorneyUserId = await resolveMondayUser(attorney!);
      } catch (err) {
        console.error("[write-back] could not list Monday users:", err);
        res.status(502).json({ error: "Monday did not answer — try again in a minute" });
        return;
      }
      if (attorneyUserId == null) {
        res.status(400).json({ error: `"${attorney}" matches no Monday user — add their Monday e-mail in Settings → Documents` });
        return;
      }
      values[FEE_K_ATTORNEY.id] = peopleValue(attorneyUserId) as never;
      (local as Record<string, unknown>)[FEE_K_ATTORNEY.key] = { label: attorney };
    }
    if (Object.keys(values).length === 0 && contactPlan.changed.length === 0) {
      res.status(400).json({ error: "Nothing changed" });
      return;
    }
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
        metadata: {
          mondayItemId, boardKey: BOARD_KEY, from, to, ...(newLabel ? { newCaseType: true } : {}),
          ...(attorneyChanged ? { attorney: { from: currentAttorneys, to: attorney } } : {}),
          ...(contactPlan.changed.length ? { clientContactChanged: contactPlan.changed } : {}),
          ...extra,
        },
      });

    let pending = false;
    // The client's e-mail / address: a write to the profile item.
    if (contactPlan.changed.length > 0) {
      const profileBoard = profileSchema!.mondayBoardId;
      const profileItemId = row.profile_monday_id!;
      try {
        await withTokenFallback((token) => dataSource.setColumnValues(profileBoard, profileItemId, contactPlan.values, token), writeTokenOptions(req));
      } catch (err) {
        console.error("[write-back] client contact update failed; queueing for retry:", err);
        pending = true;
        for (const [columnId, value] of Object.entries(contactPlan.values)) {
          enqueueWrite(db, {
            opType: "change_column_json", targetTable: "profiles", targetLocalId: row.profile_local_id,
            mondayItemId: profileItemId, authorOid: req.user?.oid ?? null,
            payload: { boardId: profileBoard, columnId, value },
          });
        }
      }
      applyProfileContactLocally(db, row.profile_local_id!, contactPlan.local);
    }
    if (Object.keys(values).length === 0) {
      audit({ queued: pending });
      res.status(pending ? 202 : 200).json({ data: { localId, fees: {}, pending } });
      return;
    }
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
    res.status(pending ? 202 : 200).json({ data: { localId, fees, ...(newType ? { caseType: newType } : {}), ...(attorneyChanged ? { attorney } : {}), pending } });
  });
}
