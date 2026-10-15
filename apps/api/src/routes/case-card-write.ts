// =============================================================================
// P6 case card write-back (M26) — PS Stage + dates on a Fee K, Status + dates
// on an Open Form, and the client's E-File link
// =============================================================================
// The case card edits a short allowlist of columns, one per request:
//
//   PATCH /api/contracts/:localId/case-field   (Paid Fee Ks — Prescheduling)
//   PATCH /api/open-forms/:localId/case-field  (Open Forms / Court Forms)
//     { field, value, from }
//
// Status values must be one of the board's synced labels; dates are
// YYYY-MM-DD or "" (clears). "Reminder sent" and "Evidence received" can't be
// in the future. `from` is what the card showed: if Monday has something else
// now, the write is refused (409) with the current value. Same rails as every
// write-back — personal token first, durable queue on outage, optimistic local
// update, audit. Plan = planCaseFieldWrite (unit-tested).
//
//   POST /api/profiles/:localId/e-file  { url, replaces? }
//
// Sets the profile's E-File (text column, found by title like M18) when it is
// empty — or still holds `replaces` — so a link set in Monday meanwhile is
// never overwritten. SharePoint links only.
// =============================================================================

import type { Express, Request } from "express";
import type BetterSqlite3 from "better-sqlite3";
type DatabaseInstance = BetterSqlite3.Database;
import { requireAuth } from "../auth/middleware.js";
import { dataSource } from "../data-source/index.js";
import { withTokenFallback } from "../write-auth.js";
import type { WriteTokenOptions } from "../write-token.js";
import { enqueueWrite } from "../write-queue/processor.js";
import { auditFromReq } from "../audit/log.js";
import { FIRM_TIMEZONE } from "../firm.js";
import { getBoardColumnsFor, getBoardStatusOptionsFor } from "@case-pipeline/query";
import type { BoardColumns, BoardStatusOptions } from "@case-pipeline/query";

export type CaseKind = "fee_k" | "open_form";

interface FieldDef {
  columnId: string;
  type: "status" | "date";
  label: string;
  /** A date that records something that happened: never in the future. */
  past?: boolean;
}

/** Field key (= synced column key) → its Monday column. by_id in config/boards.yaml. */
export const CASE_FIELDS: Record<CaseKind, Record<string, FieldDef>> = {
  fee_k: {
    ps_stage: { columnId: "status6__1", type: "status", label: "PS Stage" },
    reminder_sent_checked_on: { columnId: "date_mkzktfv1", type: "date", label: "Reminder sent", past: true },
    evidence_received_date: { columnId: "date_mkx8stcx", type: "date", label: "Evidence received", past: true },
  },
  open_form: {
    status: { columnId: "project_status", type: "status", label: "Status" },
    target_date: { columnId: "date_mkkws221", type: "date", label: "Target date" },
    forms_appt_date: { columnId: "date_mkkwqnd4", type: "date", label: "Forms appointment" },
    forms_sent_date: { columnId: "date_mknhv4v7", type: "date", label: "Forms sent", past: true },
  },
};

export const BOARD_KEYS: Record<CaseKind, string> = { fee_k: "fee_ks", open_form: "_cd_open_forms" };

export interface CaseFieldItem {
  mondayItemId: string | null;
  /** The field's current value (label or YYYY-MM-DD), null when empty. */
  current: string | null;
}

export interface CaseFieldPlan {
  field: string;
  def: FieldDef;
  mondayItemId: string;
  mondayBoardId: string;
  from: string | null;
  /** New value; null clears (dates only). */
  to: string | null;
}

export type CaseFieldPlanResult =
  | { plan: CaseFieldPlan }
  | { rejection: { status: number; error: string; current?: string | null; allowed?: string[] } };

const norm = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function isRealDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function planCaseFieldWrite(
  kind: CaseKind,
  body: { field?: unknown; value?: unknown; from?: unknown },
  item: CaseFieldItem | null | undefined,
  schema: BoardColumns | null,
  today: string,
): CaseFieldPlanResult {
  const field = typeof body.field === "string" ? body.field : "";
  const def = CASE_FIELDS[kind][field];
  if (!def) return { rejection: { status: 400, error: `Unknown field "${field}"`, allowed: Object.keys(CASE_FIELDS[kind]) } };
  if (!item) return { rejection: { status: 404, error: "Case not found" } };
  if (!item.mondayItemId) {
    return { rejection: { status: 400, error: "This case has not synced to Monday yet — try again after the next sync" } };
  }
  if (body.value !== undefined && body.value !== null && typeof body.value !== "string") {
    return { rejection: { status: 400, error: `${def.label} must be text` } };
  }
  let to = norm(body.value);

  if (!schema) return { rejection: { status: 409, error: "This board's columns aren't synced yet — run a sync first" } };
  const col = schema.columns.find((c) => c.columnId === def.columnId);
  if (!col) return { rejection: { status: 409, error: `The ${def.label} column is no longer on the board` } };

  if (def.type === "status") {
    if (!to) return { rejection: { status: 400, error: `Pick a ${def.label}` } };
    const labels = col.options.map((o) => o.label).filter((l) => l?.trim());
    const match = labels.find((l) => l.toLowerCase() === to!.toLowerCase());
    if (!match) return { rejection: { status: 400, error: `"${to}" is not a ${def.label} on Monday`, allowed: labels } };
    to = match;
  } else if (to !== null) {
    if (!isRealDate(to)) return { rejection: { status: 400, error: `${def.label} must be a date (YYYY-MM-DD)` } };
    if (def.past && to > today) return { rejection: { status: 400, error: `${def.label} can't be in the future` } };
  }

  if (to === item.current) return { rejection: { status: 400, error: "Nothing changed" } };
  if (Object.hasOwn(body, "from") && norm(body.from) !== item.current) {
    return { rejection: { status: 409, error: `${def.label} changed on Monday since you opened this case`, current: item.current } };
  }

  return { plan: { field, def, mondayItemId: item.mondayItemId, mondayBoardId: schema.mondayBoardId, from: item.current, to } };
}

// -----------------------------------------------------------------------------
// E-File link
// -----------------------------------------------------------------------------

/** Scheme, trailing slash and case don't make a different link. */
const sameLink = (a: string | null, b: string | null) => {
  const n = (u: string | null) => (u ?? "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase();
  return n(a) === n(b);
};

export type EFilePlanResult =
  | { plan: { url: string; previous: string | null } }
  | { rejection: { status: number; error: string; current?: string | null } };

export function planEFileWrite(body: { url?: unknown; replaces?: unknown }, current: string | null): EFilePlanResult {
  const url = norm(body.url);
  if (!url) return { rejection: { status: 400, error: "Paste the E-File folder link" } };
  let ok = false;
  try {
    const u = new URL(url);
    ok = u.protocol === "https:" && /\.sharepoint\.com$/i.test(u.hostname);
  } catch {
    ok = false;
  }
  if (!ok) return { rejection: { status: 400, error: "That isn't a SharePoint link (https://…sharepoint.com/…)" } };
  if (url.length > 2000) return { rejection: { status: 400, error: "That link is too long" } };
  if (current && sameLink(current, url)) return { rejection: { status: 400, error: "That is already the client's E-File" } };
  const replaces = norm(body.replaces);
  if (current && !(replaces && sameLink(current, replaces))) {
    return { rejection: { status: 409, error: "The client already has an E-File link on Monday", current } };
  }
  return { plan: { url, previous: current } };
}

// -----------------------------------------------------------------------------
// Routes
// -----------------------------------------------------------------------------

export interface CaseCardWriteDeps {
  db: DatabaseInstance;
  mondayApiToken: string | undefined;
  writeTokenOptions: WriteTokenOptions;
}

function firmToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: FIRM_TIMEZONE });
}

/** The current value of `field` on a Fee K or Open Form, as the plan compares it. */
function readItem(db: DatabaseInstance, kind: CaseKind, localId: string, field: string): CaseFieldItem | undefined {
  const def = CASE_FIELDS[kind][field];
  if (!def) return undefined;
  if (kind === "fee_k") {
    const path = def.type === "status" ? `$.${field}.label` : `$.${field}.date`;
    const row = db
      .prepare(`SELECT monday_item_id AS mondayItemId, json_extract(raw_column_values, '${path}') AS current
                  FROM contracts WHERE local_id = ? AND deleted_at IS NULL`)
      .get(localId) as { mondayItemId: string | null; current: unknown } | undefined;
    return row && { mondayItemId: row.mondayItemId, current: norm(row.current) };
  }
  const expr = def.type === "status" ? "status" : `json_extract(column_values, '$.${field}.date')`;
  const row = db
    .prepare(`SELECT monday_item_id AS mondayItemId, ${expr} AS current
                FROM board_items WHERE local_id = ? AND board_key = ?`)
    .get(localId, BOARD_KEYS.open_form) as { mondayItemId: string | null; current: unknown } | undefined;
  return row && { mondayItemId: row.mondayItemId, current: norm(row.current) };
}

/** Mirror the write into live.db so the page shows it before the next sync. */
function applyLocal(db: DatabaseInstance, kind: CaseKind, localId: string, plan: CaseFieldPlan): void {
  const { field, def, to } = plan;
  const json = to === null ? null : JSON.stringify(def.type === "status" ? { label: to } : { date: to });
  const table = kind === "fee_k" ? "contracts" : "board_items";
  const col = kind === "fee_k" ? "raw_column_values" : "column_values";
  if (json === null) {
    db.prepare(`UPDATE ${table} SET ${col} = json_remove(COALESCE(${col}, '{}'), '$.${field}') WHERE local_id = ?`).run(localId);
  } else {
    db.prepare(`UPDATE ${table} SET ${col} = json_set(COALESCE(${col}, '{}'), '$.${field}', json(?)) WHERE local_id = ?`).run(json, localId);
  }
  if (kind === "open_form" && field === "status") {
    db.prepare("UPDATE board_items SET status = ? WHERE local_id = ?").run(to, localId);
  }
  if (kind === "open_form" && field === "target_date") {
    db.prepare("UPDATE board_items SET next_date = ? WHERE local_id = ?").run(to, localId);
  }
}

export function registerCaseCardWriteRoutes(app: Express, deps: CaseCardWriteDeps): void {
  const { db, mondayApiToken: MONDAY_API_TOKEN, writeTokenOptions } = deps;

  const writeField = (kind: CaseKind) => async (req: Request, res: import("express").Response) => {
    if (!MONDAY_API_TOKEN) {
      res.status(503).json({ error: "Monday.com write-back not configured (MONDAY_API_TOKEN missing)" });
      return;
    }
    const localId = String(req.params.localId);
    const body = (req.body ?? {}) as { field?: unknown; value?: unknown; from?: unknown };
    const field = typeof body.field === "string" ? body.field : "";
    const boardKey = BOARD_KEYS[kind];
    // Status labels: the board's synced status definition is the authority for
    // Open Forms (as on every other status write); the PS Stage column's own
    // options for Fee Ks, whose "main" status is Contract Stage.
    let schema = getBoardColumnsFor(db, boardKey);
    if (schema && kind === "open_form" && field === "status") schema = withStatusOptions(schema, getBoardStatusOptionsFor(db, boardKey));
    const planned = planCaseFieldWrite(kind, body, readItem(db, kind, localId, field), schema, firmToday());
    if ("rejection" in planned) {
      const { status, ...rest } = planned.rejection;
      res.status(status).json(rest);
      return;
    }
    const plan = planned.plan;
    const { mondayItemId, mondayBoardId, def, from, to } = plan;
    const audit = (extra: Record<string, unknown>) =>
      auditFromReq(req, "monday.case_field_changed", {
        targetType: kind === "fee_k" ? "contract" : "board_item", targetId: localId, targetMondayId: mondayItemId,
        metadata: { mondayItemId, boardKey, field, columnId: def.columnId, from, to, ...extra },
      });

    let pending = false;
    try {
      const outcome = await withTokenFallback(
        (token) => dataSource.setColumnValue(mondayBoardId, mondayItemId, def.columnId, to ?? "", token),
        writeTokenOptions(req),
      );
      audit({ usedPersonalToken: outcome.usedPersonalToken, fellBackToSharedToken: outcome.fellBackToSharedToken });
    } catch (err) {
      console.error("[write-back] case card field failed; queueing for retry:", err);
      pending = true;
      enqueueWrite(db, {
        opType: "change_column", targetTable: kind === "fee_k" ? "contracts" : "board_items", targetLocalId: localId,
        mondayItemId, authorOid: req.user?.oid ?? null,
        payload: { boardId: mondayBoardId, columnId: def.columnId, value: to ?? "" },
      });
      audit({ queued: true });
    }
    applyLocal(db, kind, localId, plan);
    res.status(pending ? 202 : 200).json({ data: { localId, field, value: to, pending } });
  };

  app.patch("/api/contracts/:localId/case-field", requireAuth, writeField("fee_k"));
  app.patch("/api/open-forms/:localId/case-field", requireAuth, writeField("open_form"));

  app.post("/api/profiles/:localId/e-file", requireAuth, async (req, res) => {
    if (!MONDAY_API_TOKEN) {
      res.status(503).json({ error: "Monday.com write-back not configured (MONDAY_API_TOKEN missing)" });
      return;
    }
    const localId = String(req.params.localId);
    const profile = db
      .prepare(`SELECT monday_item_id AS mondayItemId, json_extract(raw_column_values, '$.e_file') AS eFile
                  FROM profiles WHERE local_id = ? AND deleted_at IS NULL`)
      .get(localId) as { mondayItemId: string | null; eFile: unknown } | undefined;
    if (!profile) {
      res.status(404).json({ error: "Client not found" });
      return;
    }
    if (!profile.mondayItemId) {
      res.status(400).json({ error: "This client has not synced to Monday yet — try again after the next sync" });
      return;
    }
    const planned = planEFileWrite((req.body ?? {}) as { url?: unknown; replaces?: unknown }, norm(profile.eFile));
    if ("rejection" in planned) {
      const { status, ...rest } = planned.rejection;
      res.status(status).json(rest);
      return;
    }
    const schema = getBoardColumnsFor(db, "profiles");
    // A text column only: a link column wants JSON, and E-File is text today.
    const col = schema?.columns.find((c) => c.title.trim().toLowerCase() === "e-file" && c.type === "text");
    if (!schema || !col) {
      res.status(409).json({ error: "The profile's E-File column isn't synced (or isn't a text column) — run a sync first" });
      return;
    }
    const { url, previous } = planned.plan;
    const mondayItemId = profile.mondayItemId;
    const audit = (extra: Record<string, unknown>) =>
      auditFromReq(req, "monday.efile_linked", {
        targetType: "profile", targetId: localId, targetMondayId: mondayItemId,
        metadata: { mondayItemId, columnId: col.columnId, replaced: previous !== null, ...extra },
      });
    let pending = false;
    try {
      const outcome = await withTokenFallback(
        (token) => dataSource.setColumnValue(schema.mondayBoardId, mondayItemId, col.columnId, url, token),
        writeTokenOptions(req),
      );
      audit({ usedPersonalToken: outcome.usedPersonalToken, fellBackToSharedToken: outcome.fellBackToSharedToken });
    } catch (err) {
      console.error("[write-back] E-File link failed; queueing for retry:", err);
      pending = true;
      enqueueWrite(db, {
        opType: "change_column", targetTable: "profiles", targetLocalId: localId,
        mondayItemId, authorOid: req.user?.oid ?? null,
        payload: { boardId: schema.mondayBoardId, columnId: col.columnId, value: url },
      });
      audit({ queued: true });
    }
    db.prepare(`UPDATE profiles SET raw_column_values = json_set(COALESCE(raw_column_values, '{}'), '$.e_file', ?) WHERE local_id = ?`)
      .run(url, localId);
    res.status(pending ? 202 : 200).json({ data: { localId, eFile: url, pending } });
  });
}

/** The board's status column with the labels from its synced status definition. */
function withStatusOptions(schema: BoardColumns, status: BoardStatusOptions | null): BoardColumns {
  if (!status) return schema;
  return {
    ...schema,
    columns: schema.columns.map((c) => (c.columnId === status.statusColumnId ? { ...c, options: status.options } : c)),
  };
}
