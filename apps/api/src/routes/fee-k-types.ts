// =============================================================================
// Fee K Types lookup table routes (P11.3.6)
// =============================================================================
//   GET /api/settings/fee-k-types   anyone signed in (the contract forms read it):
//                                   the saved rows + Monday's Fee K Type labels
//                                   and "It will go to…" boards, from the synced schema.
//                                   Before the first save: the draft, draft = true
//   PUT /api/settings/fee-k-types   admin: replace the table (audited)
// Rules + storage = fee-k-types.ts.
// =============================================================================

import type { Express } from "express";
import type BetterSqlite3 from "better-sqlite3";
type DatabaseInstance = BetterSqlite3.Database;
import { requireAuth, requireAdmin } from "../auth/middleware.js";
import { auditFromReq } from "../audit/log.js";
import { caseTypeColumn, getBoardColumnsFor } from "@case-pipeline/query";
import { feeKTypesSaved, loadFeeKTypes, saveFeeKTypes } from "../fee-k-types.js";
import { DRAFT_FEE_K_TYPES } from "../fee-k-types-draft.js";
import { SUGGESTED_DOCUMENTS } from "../fee-k-type-documents-draft.js";

/** The Fee K's "It will go to…" status column (config/boards.yaml, by_id). */
export const IT_WILL_GO_TO_COLUMN = "status__1";

export function feeKTypeOptions(db: DatabaseInstance): { feeKTypes: string[]; boards: string[] } {
  const schema = getBoardColumnsFor(db, "fee_ks");
  const labels = (c: { options: { label: string }[] } | undefined) => (c?.options ?? []).map((o) => o.label).filter((l) => l.trim() !== "");
  return {
    feeKTypes: labels(schema ? caseTypeColumn(schema) : undefined),
    boards: labels(schema?.columns.find((c) => c.columnId === IT_WILL_GO_TO_COLUMN)),
  };
}

export function registerFeeKTypeRoutes(app: Express, deps: { db: DatabaseInstance }): void {
  const { db } = deps;

  app.get("/api/settings/fee-k-types", requireAuth, (_req, res) => {
    const saved = feeKTypesSaved();
    res.json({ data: { rows: saved ? loadFeeKTypes() : DRAFT_FEE_K_TYPES, draft: !saved, suggestedDocuments: SUGGESTED_DOCUMENTS, ...feeKTypeOptions(db) } });
  });

  app.put("/api/settings/fee-k-types", requireAuth, requireAdmin, (req, res) => {
    try {
      const saved = saveFeeKTypes((req.body as { rows?: unknown } | undefined)?.rows);
      auditFromReq(req, "fee_k_types.updated", {
        targetType: "settings",
        targetId: "fee-k-types",
        metadata: { rows: saved.length },
      });
      res.json({ data: { rows: saved, draft: false, suggestedDocuments: SUGGESTED_DOCUMENTS, ...feeKTypeOptions(db) } });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });
}
