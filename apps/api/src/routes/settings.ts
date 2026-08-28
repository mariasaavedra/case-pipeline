// =============================================================================
// Settings routes
// =============================================================================
// Extracted verbatim from server.ts. Firm-wide configuration an admin edits
// through the Settings page: which attorney boards feed the appointment views,
// the default KPI display columns, status label/color overrides, and the
// urgency thresholds.
//
// The read halves are open to any authenticated user — the web needs them to
// render badges and to explain what "default" means — while every mutation is
// admin-only and audited. The attorney-board file helpers are shared with the
// appointment/calendar routes still in server.ts, so they live one level up in
// ../attorney-boards.ts rather than here.
// =============================================================================

import type { Express } from "express";
import type BetterSqlite3 from "better-sqlite3";
type DatabaseInstance = BetterSqlite3.Database;
import { requireAdmin } from "../auth/middleware.js";
import { auditFromReq } from "../audit/log.js";
import { getBoardStatusOptions, getBoardColumns } from "@case-pipeline/query";
import { loadAttorneyBoards, saveAttorneyBoards, type AttorneyBoard } from "../attorney-boards.js";
import { loadGlobalKpiColumns, saveGlobalKpiColumns } from "./kpi-columns.js";
import { loadStatusOverrides, saveStatusOverrides } from "./status-overrides.js";
import { loadUrgencySettings, saveUrgencySettings } from "./urgency-settings.js";

export function registerSettingsRoutes(app: Express, db: DatabaseInstance): void {

  // =============================================================================
  // Settings — Attorney Boards
  // =============================================================================

  app.get("/api/settings/attorney-boards", (_req, res) => {
    res.json({ data: loadAttorneyBoards() });
  });

  app.post("/api/settings/attorney-boards", requireAdmin, (req, res) => {
    const { boardKey, mondayBoardId, displayName } = req.body as Partial<AttorneyBoard>;

    if (!boardKey || !displayName) {
      res.status(400).json({ error: "boardKey and displayName are required" });
      return;
    }
    if (!/^appointments_[a-z0-9_]+$/.test(boardKey)) {
      res.status(400).json({ error: "boardKey must match appointments_<letters> (e.g. appointments_js)" });
      return;
    }

    const boards = loadAttorneyBoards();
    if (boards.find((b) => b.boardKey === boardKey)) {
      res.status(409).json({ error: `Board key "${boardKey}" already exists` });
      return;
    }

    const newBoard: AttorneyBoard = {
      boardKey,
      mondayBoardId: mondayBoardId ?? "",
      displayName,
      active: true,
    };
    boards.push(newBoard);
    saveAttorneyBoards(boards);
    auditFromReq(req, "attorney_board.added", {
      targetType: "attorney_board",
      targetId: boardKey,
      metadata: { mondayBoardId: newBoard.mondayBoardId, displayName },
    });
    res.json({ data: boards });
  });

  app.delete("/api/settings/attorney-boards/:boardKey", requireAdmin, (req, res) => {
    const { boardKey } = req.params;
    const boards = loadAttorneyBoards();
    const idx = boards.findIndex((b) => b.boardKey === boardKey);
    if (idx === -1) {
      res.status(404).json({ error: `Board key "${boardKey}" not found` });
      return;
    }
    boards.splice(idx, 1);
    saveAttorneyBoards(boards);
    auditFromReq(req, "attorney_board.removed", {
      targetType: "attorney_board",
      targetId: String(boardKey),
    });
    res.json({ data: boards });
  });

  // =============================================================================
  // Settings — Dashboard KPI display columns (firm-wide defaults)
  // =============================================================================
  // Readable by anyone (the dashboard needs it to explain what "default" means);
  // writable only by admins, since it changes the view for every user who hasn't
  // picked their own column.

  app.get("/api/settings/kpi-columns", (_req, res) => {
    res.json({ data: loadGlobalKpiColumns() });
  });

  app.put("/api/settings/kpi-columns", requireAdmin, (req, res) => {
    const body = req.body as { columns?: unknown };
    if (typeof body?.columns !== "object" || body.columns === null || Array.isArray(body.columns)) {
      res.status(400).json({ error: "columns must be an object of { cardKey: columnId }" });
      return;
    }
    // The whole map is replaced, so the client must send every card it wants kept.
    const saved = saveGlobalKpiColumns(body.columns as Record<string, string>);
    auditFromReq(req, "kpi_columns.updated", {
      targetType: "settings",
      targetId: "kpi-columns",
      metadata: saved,
    });
    res.json({ data: saved });
  });

  // =============================================================================
  // Settings — Status tag overrides (firm-wide label + color per Monday status)
  // =============================================================================
  // Readable by anyone (the web needs it to render badges); writable only by
  // admins, audited. `status-catalog` enumerates the distinct statuses that exist
  // in the synced data so the editor can list what there is to override.

  app.get("/api/settings/status-overrides", (_req, res) => {
    res.json({ data: loadStatusOverrides() });
  });

  app.put("/api/settings/status-overrides", requireAdmin, (req, res) => {
    try {
      const saved = saveStatusOverrides(req.body);
      auditFromReq(req, "status_overrides.updated", {
        targetType: "settings",
        targetId: "status-overrides",
        metadata: { count: Object.keys(saved).length },
      });
      res.json({ data: saved });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.get("/api/settings/urgency", (_req, res) => {
    res.json({ data: loadUrgencySettings() });
  });

  app.put("/api/settings/urgency", requireAdmin, (req, res) => {
    const saved = saveUrgencySettings(req.body);
    auditFromReq(req, "urgency_settings.updated", {
      targetType: "settings",
      targetId: "urgency",
      metadata: saved,
    });
    res.json({ data: saved });
  });

  // Per-board status column options (labels + native Monday colors) for the status
  // editor. Any authed user — needed to render/choose statuses inline.
  app.get("/api/boards/status-options", (_req, res) => {
    res.json({ data: getBoardStatusOptions(db) });
  });
  // Full per-board column schema (all columns + choice options) for the
  // all-columns expand/edit view. Any authed user.
  app.get("/api/boards/columns", (_req, res) => {
    res.json({ data: getBoardColumns(db) });
  });
  app.get("/api/settings/status-catalog", (_req, res) => {
    const rows = db
      .prepare(
        `SELECT status, COUNT(*) AS count FROM board_items
         WHERE status IS NOT NULL AND status <> ''
         GROUP BY status ORDER BY count DESC`,
      )
      .all() as Array<{ status: string; count: number }>;
    res.json({ data: rows });
  });
}
