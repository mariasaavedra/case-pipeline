// =============================================================================
// P3.9 Case timeline — GET /api/clients/:localId/timeline
// =============================================================================
// Read-only. The milestone mapping is config/timeline.yaml, read once per
// process (it changes only with a deploy); the rules and the summary are
// libs/query/src/case-timeline.ts.
// =============================================================================

import type { Express } from "express";
import type BetterSqlite3 from "better-sqlite3";
type DatabaseInstance = BetterSqlite3.Database;
import { requireAuth } from "../auth/middleware.js";
import { loadTimelineConfig, type TimelineConfig } from "@case-pipeline/config";
import { getCaseTimeline } from "@case-pipeline/query";
import { FIRM_TIMEZONE } from "../firm.js";

export interface CaseTimelineDeps {
  db: DatabaseInstance;
  /** Override for tests; defaults to config/timeline.yaml. */
  loadConfig?: () => Promise<TimelineConfig>;
  /** The firm's today; defaults to the clock in FIRM_TIMEZONE. */
  today?: () => string;
}

export function registerCaseTimelineRoutes(app: Express, deps: CaseTimelineDeps): void {
  let config: Promise<TimelineConfig> | null = null;
  const loadConfig = deps.loadConfig ?? (() => loadTimelineConfig());
  const today = deps.today ?? (() => new Date().toLocaleDateString("en-CA", { timeZone: FIRM_TIMEZONE }));

  app.get("/api/clients/:localId/timeline", requireAuth, async (req, res) => {
    try {
      config ??= loadConfig();
      const timeline = getCaseTimeline(deps.db, String(req.params.localId), await config, {
        today: today(),
        timeZone: FIRM_TIMEZONE,
      });
      if (!timeline) {
        res.status(404).json({ error: "Client not found" });
        return;
      }
      res.json({ data: timeline });
    } catch (err) {
      config = null; // a bad read is retried on the next request
      console.error("[timeline]", err);
      res.status(500).json({ error: "Could not build the timeline" });
    }
  });
}
