// =============================================================================
// Generated documents (P3.0 → M23 Generate document) — the G-28 first
// =============================================================================
//   GET  /api/profiles/:localId/documents/g28 — the pre-filled form (attorney
//        from Settings, client from Monday, a detained client's facility),
//        the attorney list to switch between, and the form's box sizes
//   POST /api/profiles/:localId/documents/g28 — the edited form → filled PDF.
//        Refused (400) with the list of problems when something is missing or
//        doesn't fit. Audited (agency, role, attorney — no client details).
//   GET  /api/settings/documents             — firm / attorneys / facilities
//   PUT  /api/settings/documents             — admin-only, audited
//
// The browser saves the PDF and puts a copy in the client's SharePoint folder
// with the user's own Microsoft 365 access. Nothing is written to Monday.
// =============================================================================

import fs from "node:fs";
import path from "node:path";
import type { Express } from "express";
import type BetterSqlite3 from "better-sqlite3";
type DatabaseInstance = BetterSqlite3.Database;
import { getOpenDetentions } from "@case-pipeline/query";
import { requireAdmin } from "../auth/middleware.js";
import { auditFromReq } from "../audit/log.js";
import { FIRM_TIMEZONE } from "../firm.js";
import { REPO_ROOT } from "../paths.js";
import { loadDocumentSettings, saveDocumentSettings } from "../documents/document-settings.js";
import {
  fillG28, g28FileName, g28Prefill, g28Problems, sanitizeG28Input, G28_LIMITS, type G28ProfileRow,
} from "../documents/g28.js";

const G28_TEMPLATE = path.join(REPO_ROOT, "templates/forms/g-28.pdf");

export function registerDocumentRoutes(app: Express, deps: { db: DatabaseInstance }): void {
  const { db } = deps;

  const loadProfile = (localId: string) =>
    db.prepare(`
      SELECT name,
             json_extract(raw_column_values, '$.first_name')       AS firstName,
             json_extract(raw_column_values, '$.last_name')        AS lastName,
             json_extract(raw_column_values, '$.middle_name')      AS middleName,
             a_number                                              AS aNumber,
             phone, email,
             json_extract(raw_column_values, '$.mailing_address')  AS mailingAddress,
             address                                               AS physicalAddress,
             json_extract(raw_column_values, '$.city')             AS city,
             json_extract(raw_column_values, '$.state')            AS state,
             json_extract(raw_column_values, '$.zip_code')         AS zip,
             json_extract(raw_column_values, '$.attorney.label')   AS attorney,
             monday_item_id                                        AS mondayItemId
        FROM profiles
       WHERE local_id = ? AND deleted_at IS NULL
    `).get(localId) as (G28ProfileRow & { mondayItemId: string | null }) | undefined;

  app.get("/api/profiles/:localId/documents/g28", (req, res) => {
    const localId = String(req.params.localId);
    const row = loadProfile(localId);
    if (!row) {
      res.status(404).json({ error: "Client not found" });
      return;
    }
    const settings = loadDocumentSettings();
    res.json({
      data: {
        ...g28Prefill(row, settings, getOpenDetentions(db, localId)[0]?.facility ?? null),
        attorneys: settings.attorneys,
        firm: settings.firm,
        limits: G28_LIMITS,
      },
    });
  });

  app.post("/api/profiles/:localId/documents/g28", async (req, res) => {
    const localId = String(req.params.localId);
    const row = loadProfile(localId);
    if (!row) {
      res.status(404).json({ error: "Client not found" });
      return;
    }
    const input = sanitizeG28Input((req.body as { input?: unknown } | undefined)?.input);
    const problems = g28Problems(input);
    if (problems.length > 0) {
      res.status(400).json({ error: problems.join(" "), problems });
      return;
    }
    try {
      const pdf = await fillG28(new Uint8Array(fs.readFileSync(G28_TEMPLATE)), input);
      const today = new Date().toLocaleDateString("en-CA", { timeZone: FIRM_TIMEZONE });
      const filename = g28FileName(input, today);
      auditFromReq(req, "doc.g28_generated", {
        targetType: "profile", targetId: localId, targetMondayId: row.mondayItemId,
        metadata: { agency: input.matter.agency, clientRole: input.matter.clientRole, attorney: input.attorney.id || null },
      });
      res.setHeader("Content-Type", "application/pdf");
      // RFC 5987 for the en dashes; the plain one for old clients.
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename.replace(/[^\x20-\x7e]/g, "-")}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      );
      res.send(Buffer.from(pdf));
    } catch (err) {
      console.error("[g28] fill failed:", err);
      res.status(500).json({ error: "Could not fill the G-28" });
    }
  });

  app.get("/api/settings/documents", (_req, res) => {
    res.json({ data: loadDocumentSettings() });
  });

  app.put("/api/settings/documents", requireAdmin, (req, res) => {
    const saved = saveDocumentSettings(req.body);
    auditFromReq(req, "document_settings.updated", {
      targetType: "settings",
      targetId: "documents",
      metadata: { attorneys: saved.attorneys.length, facilities: saved.facilities.length },
    });
    res.json({ data: saved });
  });
}
