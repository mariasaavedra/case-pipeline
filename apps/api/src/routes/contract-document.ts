// =============================================================================
// Contract generation support (P14 → M22 Generate contract)
// =============================================================================
// The contract itself is filled in the browser, from the firm's templates in
// SharePoint (apps/web/src/lib/contract-fill.ts) — templates never pass through
// this server. The API only:
//   GET  /api/contracts/:localId/document-form — what Monday knows, to pre-fill
//        the form: client, e-mail, address, attorney, AF / FF / PF, and the
//        client's next hearing (type + date) from their open court case.
//   POST /api/contracts/:localId/document-generated — audit entry for a
//        generated contract (template name + fees; no client details).
// Nothing is written to Monday.
// =============================================================================

import type { Express } from "express";
import type BetterSqlite3 from "better-sqlite3";
type DatabaseInstance = BetterSqlite3.Database;
import { requireAuth } from "../auth/middleware.js";
import { auditFromReq } from "../audit/log.js";
import { hearingKindOf } from "@case-pipeline/query";

interface ContractDocRow {
  monday_item_id: string | null;
  itemName: string;
  profileLocalId: string | null;
  clientName: string | null;
  email: string | null;
  address: string | null;
  attorney: string | null;
  contractFor: string | null;
  af: unknown;
  ff: unknown;
  pf: unknown;
}

export interface ContractPrefill {
  clientName: string;
  email: string;
  /** One line, as Monday keeps it. */
  address: string;
  attorneyName: string;
  contractFor: string[];
  attorneyFee: number | null;
  filingFee: number | null;
  processingFee: number | null;
  /** "Master Hearing" / "Individual Hearing" / Monday's own label; "" when none. */
  hearingType: string;
  /** ISO date of the next hearing; "" when none. */
  hearingDate: string;
}

const amount = (raw: unknown): number | null => {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
};

function labels(raw: string | null): string[] {
  try {
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((l): l is string => typeof l === "string") : [];
  } catch {
    return [];
  }
}

/** How the 2026 COURT contract names a hearing. */
export function contractHearingType(mondayLabel: string | null): string {
  if (!mondayLabel) return "";
  const kind = hearingKindOf(mondayLabel);
  return kind === "mch" ? "Master Hearing" : kind === "trial" ? "Individual Hearing" : mondayLabel;
}

export function contractPrefill(row: ContractDocRow, hearing: { type: string | null; date: string | null } | null): ContractPrefill {
  return {
    clientName: (row.clientName ?? row.itemName).trim(),
    email: row.email?.trim() ?? "",
    address: row.address?.trim() ?? "",
    // First listed attorney; a people label can read "A, B".
    attorneyName: (row.attorney ?? "").split(",").map((s) => s.trim()).find((s) => s && !s.includes("@")) ?? "",
    contractFor: labels(row.contractFor),
    attorneyFee: amount(row.af),
    filingFee: amount(row.ff),
    processingFee: amount(row.pf),
    hearingType: contractHearingType(hearing?.type ?? null),
    hearingDate: hearing?.date ?? "",
  };
}

export function registerContractDocumentRoutes(app: Express, deps: { db: DatabaseInstance }): void {
  const { db } = deps;

  const load = (localId: string) =>
    db.prepare(`
      SELECT c.monday_item_id, c.name AS itemName, p.local_id AS profileLocalId,
             p.name AS clientName, p.email, p.address,
             json_extract(c.raw_column_values, '$.attorney.label')      AS attorney,
             json_extract(c.raw_column_values, '$.contract_for.labels') AS contractFor,
             json_extract(c.raw_column_values, '$.af')                  AS af,
             json_extract(c.raw_column_values, '$.ff')                  AS ff,
             json_extract(c.raw_column_values, '$.pf')                  AS pf
        FROM contracts c
        LEFT JOIN profiles p ON p.local_id = c.profile_local_id
       WHERE c.local_id = ? AND c.deleted_at IS NULL
    `).get(localId) as ContractDocRow | undefined;

  app.get("/api/contracts/:localId/document-form", requireAuth, (req, res) => {
    const row = load(String(req.params.localId));
    if (!row) {
      res.status(404).json({ error: "Contract not found" });
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    const hearing = row.profileLocalId
      ? (db.prepare(`
          SELECT json_extract(column_values, '$.hearing_type.label') AS type, next_date AS date
            FROM board_items
           WHERE board_key = 'court_cases' AND profile_local_id = ? AND deleted_at IS NULL AND next_date >= ?
           ORDER BY next_date LIMIT 1
        `).get(row.profileLocalId, today) as { type: string | null; date: string | null } | undefined) ?? null
      : null;
    res.json({ data: contractPrefill(row, hearing) });
  });

  app.post("/api/contracts/:localId/document-generated", requireAuth, (req, res) => {
    const localId = String(req.params.localId);
    const row = load(localId);
    if (!row) {
      res.status(404).json({ error: "Contract not found" });
      return;
    }
    const b = (req.body ?? {}) as { template?: unknown; format?: unknown; attorneyFee?: unknown; filingFee?: unknown };
    auditFromReq(req, "doc.contract_generated", {
      targetType: "contract", targetId: localId, targetMondayId: row.monday_item_id,
      metadata: {
        template: typeof b.template === "string" ? b.template.slice(0, 200) : null,
        format: b.format === "pdf" ? "pdf" : "docx",
        attorneyFee: amount(b.attorneyFee), filingFee: amount(b.filingFee),
      },
    });
    res.status(204).end();
  });
}
