// =============================================================================
// Settings → Workflows (P11.7) — every automation, its switch and its last runs
// =============================================================================
//   GET /api/workflows   catalog + on/off + last run + failures in 7 days
//
// Admin-only, read-only. Switches stay in .env; the page names the setting
// that's missing, never a value. Report = workflows/report.ts.
// =============================================================================

import type { Express } from "express";
import type BetterSqlite3 from "better-sqlite3";
import { requireAuth, requireAdmin } from "../auth/middleware.js";
import { buildWorkflowsReport } from "../workflows/report.js";

export interface WorkflowsRouteDeps {
  db: BetterSqlite3.Database;
  usersDb: BetterSqlite3.Database;
  live: boolean;
}

export function registerWorkflowsRoutes(app: Express, deps: WorkflowsRouteDeps): void {
  app.get("/api/workflows", requireAuth, requireAdmin, (_req, res) => {
    try {
      res.json({ data: buildWorkflowsReport(deps) });
    } catch (err) {
      console.error("[workflows] report failed:", err);
      res.status(500).json({ error: "Could not load workflows" });
    }
  });
}
