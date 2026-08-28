// =============================================================================
// Profile write routes
// =============================================================================
// Extracted verbatim from server.ts. The three writes that hang off a client
// profile: post a note to its Monday update thread, create a contract (Fee K)
// on the client's behalf, and render a DOCX from live Monday data.
//
// The first two share the standard write rails — personal Monday token first,
// durable queue on outage, audit entry. Render is read-only against Monday and
// streams the document straight back; nothing is written to disk on the server.
// =============================================================================

import type { Express } from "express";
import type BetterSqlite3 from "better-sqlite3";
type DatabaseInstance = BetterSqlite3.Database;
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { REPO_ROOT } from "../paths.js";
import { requireAuth } from "../auth/middleware.js";
import { dataSource } from "../data-source/index.js";
import { withTokenFallback } from "../write-auth.js";
import type { WriteTokenOptions } from "../write-token.js";
import { enqueueWrite } from "../write-queue/processor.js";
import { auditFromReq } from "../audit/log.js";
import { getBoardColumnsFor } from "@case-pipeline/query";
import { fetchItem, resolveAllColumns, fetchBoardStructure } from "@case-pipeline/monday";
import { loadConfig } from "@case-pipeline/config";
import { mapItemToTemplateVars, validateTemplateVars, renderDocxTemplate } from "@case-pipeline/template";
import { parseNoteBody } from "./note-write.js";

export interface ProfileWriteDeps {
  db: DatabaseInstance;
  mondayApiToken: string | undefined;
  writeTokenOptions: WriteTokenOptions;
}

export function registerProfileWriteRoutes(app: Express, deps: ProfileWriteDeps): void {
  const { db, mondayApiToken: MONDAY_API_TOKEN, writeTokenOptions } = deps;


  // =============================================================================
  // Profile Write-Back — Post update to Monday.com + persist locally
  // =============================================================================

  app.post("/api/profiles/:localId/updates", requireAuth, async (req, res) => {
    if (!MONDAY_API_TOKEN) {
      res.status(503).json({ error: "Monday.com write-back not configured (MONDAY_API_TOKEN missing)" });
      return;
    }

    const localId = String(req.params.localId);
    const { text, mentions } = parseNoteBody(req.body, "text");
    if (!text) {
      res.status(400).json({ error: "text is required" });
      return;
    }

    const profile = db
      .prepare("SELECT monday_item_id, batch_id FROM profiles WHERE local_id = ?")
      .get(localId) as { monday_item_id: string | null; batch_id: number } | null;

    if (!profile) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }
    if (!profile.monday_item_id) {
      res.status(400).json({ error: "Profile has no Monday.com item ID — cannot post update" });
      return;
    }
    const mondayItemId = profile.monday_item_id; // narrowed; the write closure below can't re-narrow a field

    const newLocalId = randomUUID();
    const now = new Date().toISOString();
    const authorName = req.user?.name ?? req.user?.preferred_username ?? "Staff";
    const authorEmail = req.user?.email ?? req.user?.preferred_username ?? null;

    const insertUpdate = (mondayUpdateId: string | null, syncStatus: "synced" | "pending") =>
      db.prepare(`
        INSERT INTO client_updates
          (batch_id, local_id, monday_update_id, profile_local_id, board_item_local_id,
           board_key, author_name, author_email, text_body, body_html, source_type,
           reply_to_update_id, created_at_source, sync_status)
        VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, NULL, 'update', NULL, ?, ?)
      `).run(profile.batch_id, newLocalId, mondayUpdateId, localId, authorName, authorEmail, text, now, syncStatus);

    const responseData = (pending: boolean) => ({
      localId: newLocalId,
      profileLocalId: localId,
      boardItemLocalId: null,
      boardKey: null,
      authorName,
      authorEmail,
      textBody: text,
      bodyHtml: null,
      sourceType: "update" as const,
      title: null,
      activityTypeName: null,
      replyToUpdateId: null,
      createdAtSource: now,
      attachments: [],
      pending,
    });

    try {
      // Prefer the posting user's personal Monday.com token; if Monday rejects it
      // on permission grounds the shared token takes over (see write-auth.ts).
      const outcome = await withTokenFallback(
        (token) => dataSource.postUpdate(mondayItemId, text, token, undefined, mentions),
        writeTokenOptions(req),
      );
      insertUpdate(outcome.result, "synced");
      auditFromReq(req, "monday.update_posted", {
        targetType: "profile",
        targetId: localId,
        targetMondayId: mondayItemId,
        metadata: {
          mondayItemId: profile.monday_item_id,
          mondayUpdateId: outcome.result,
          usedPersonalToken: outcome.usedPersonalToken,
          fellBackToSharedToken: outcome.fellBackToSharedToken,
        },
      });
      res.json({ data: responseData(false) });
    } catch (err) {
      // Resilient fallback: don't lose the note on a transient Monday.com outage.
      // Persist it locally as pending and enqueue the write for background retry.
      console.error("[write-back] createUpdate failed; queueing for retry:", err);
      insertUpdate(null, "pending");
      enqueueWrite(db, {
        opType: "create_update",
        targetTable: "profiles",
        targetLocalId: localId,
        mondayItemId: profile.monday_item_id,
        authorOid: req.user?.oid ?? null,
        payload: { body: text, mentions },
      });
      res.status(202).json({ data: responseData(true) });
    }
  });

  // =============================================================================
  // Create a contract (Fee K) for a client
  // =============================================================================
  // Creates a new item on the Fee Ks board with the case type + AF/FF/PF amounts,
  // named "<client> — <case type>", auto-linked to the client's profile (and their
  // Open Forms entries when present). Columns are resolved by title from the synced
  // schema (no hardcoded ids). Surcharges are intentionally NOT set here — they're
  // a post-signing decision. Same rails: personal token, queue fallback, audit.

  app.post("/api/profiles/:localId/contracts", requireAuth, async (req, res) => {
    if (!MONDAY_API_TOKEN) {
      res.status(503).json({ error: "Monday.com write-back not configured" });
      return;
    }
    const localId = String(req.params.localId);
    const body = req.body as { caseType?: unknown; af?: unknown; ff?: unknown; pf?: unknown };
    const caseType = (body.caseType ?? "").toString().trim();
    const num = (v: unknown): number | null => {
      if (v === "" || v == null) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const af = num(body.af), ff = num(body.ff), pf = num(body.pf);
    if (!caseType) {
      res.status(400).json({ error: "caseType is required" });
      return;
    }

    const profile = db
      .prepare("SELECT monday_item_id, name FROM profiles WHERE local_id = ?")
      .get(localId) as { monday_item_id: string | null; name: string } | null;
    if (!profile) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }

    const schema = getBoardColumnsFor(db, "fee_ks");
    if (!schema) {
      res.status(409).json({ error: "Fee Ks column schema not synced yet — run a sync first" });
      return;
    }
    const byTitle = (pred: (t: string) => boolean, type?: string) =>
      schema.columns.find((c) => pred(c.title.trim().toLowerCase()) && (!type || c.type === type));
    const caseTypeCol = byTitle((t) => t.startsWith("contract for"), "dropdown");
    const afCol = byTitle((t) => t === "af", "numbers");
    const ffCol = byTitle((t) => t === "ff", "numbers");
    const pfCol = byTitle((t) => t === "pf", "numbers");
    const profileCol = byTitle((t) => t === "profile", "board_relation");
    const openFormsCol = byTitle((t) => t.includes("open forms"), "board_relation");

    if (!caseTypeCol) {
      res.status(409).json({ error: "Could not resolve the 'Contract for...' column on Fee Ks" });
      return;
    }
    if (caseTypeCol.options.length > 0 && !caseTypeCol.options.some((o) => o.label === caseType)) {
      res.status(400).json({ error: "caseType is not a valid option", allowed: caseTypeCol.options.map((o) => o.label) });
      return;
    }

    const columnValues: Record<string, unknown> = { [caseTypeCol.columnId]: { labels: [caseType] } };
    if (afCol && af != null) columnValues[afCol.columnId] = af;
    if (ffCol && ff != null) columnValues[ffCol.columnId] = ff;
    if (pfCol && pf != null) columnValues[pfCol.columnId] = pf;
    if (profileCol && profile.monday_item_id) columnValues[profileCol.columnId] = { item_ids: [Number(profile.monday_item_id)] };
    if (openFormsCol) {
      const ofIds = (db
        .prepare("SELECT monday_item_id FROM board_items WHERE profile_local_id = ? AND board_key = '_cd_open_forms' AND monday_item_id IS NOT NULL")
        .all(localId) as { monday_item_id: string }[]).map((r) => Number(r.monday_item_id)).filter((n) => Number.isFinite(n));
      if (ofIds.length > 0) columnValues[openFormsCol.columnId] = { item_ids: ofIds };
    }

    const itemName = `${profile.name} — ${caseType}`;

    try {
      const outcome = await withTokenFallback(
        (token) => dataSource.createItem(schema.mondayBoardId, itemName, columnValues, token),
        writeTokenOptions(req),
      );
      auditFromReq(req, "monday.contract_created", {
        targetType: "profile", targetId: localId, targetMondayId: profile.monday_item_id,
        metadata: {
          feeKItemId: outcome.result, caseType, af, ff, pf, name: itemName,
          usedPersonalToken: outcome.usedPersonalToken, fellBackToSharedToken: outcome.fellBackToSharedToken,
        },
      });
      res.json({ data: { feeKItemId: outcome.result, name: itemName, pending: false } });
    } catch (err) {
      console.error("[write-back] createItem failed; queueing for retry:", err);
      enqueueWrite(db, {
        opType: "create_item", targetTable: "profiles", targetLocalId: localId,
        mondayItemId: profile.monday_item_id, authorOid: req.user?.oid ?? null,
        payload: { boardId: schema.mondayBoardId, itemName, columnValues },
      });
      auditFromReq(req, "monday.contract_created", {
        targetType: "profile", targetId: localId, targetMondayId: profile.monday_item_id,
        metadata: { caseType, af, ff, pf, name: itemName, queued: true },
      });
      res.status(202).json({ data: { name: itemName, pending: true } });
    }
  });

  // =============================================================================
  // Document generation — render a DOCX for a profile from live Monday.com data
  // =============================================================================
  // Same pipeline as the CLI `render` command: fetch the item from Monday.com,
  // resolve columns per config/boards.yaml, map to template variables, fill the
  // .docx template. Streams the file back as a download; nothing is written to
  // disk on the server.

  app.post("/api/profiles/:localId/render", requireAuth, async (req, res) => {
    if (!MONDAY_API_TOKEN) {
      res.status(503).json({ error: "Document generation not configured (MONDAY_API_TOKEN missing)" });
      return;
    }

    const localId = String(req.params.localId);
    const templateName = (((req.body ?? {}) as { template?: unknown }).template ?? "client_letter_docx").toString();

    const profile = db
      .prepare("SELECT name, monday_item_id FROM profiles WHERE local_id = ?")
      .get(localId) as { name: string; monday_item_id: string | null } | null;

    if (!profile) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }
    if (!profile.monday_item_id) {
      res.status(400).json({ error: "Profile has no Monday.com item ID — cannot generate a document" });
      return;
    }

    try {
      const config = await loadConfig({
        boardsPath: path.join(REPO_ROOT, "config/boards.yaml"),
        templatesPath: path.join(REPO_ROOT, "config/templates.yaml"),
      });

      const templateConfig = config.templates[templateName];
      if (!templateConfig) {
        const available = Object.keys(config.templates).join(", ");
        res.status(400).json({ error: `Unknown template "${templateName}". Available: ${available}` });
        return;
      }
      if (!templateConfig.path.endsWith(".docx")) {
        res.status(400).json({ error: `Template "${templateName}" is not a .docx — only Word templates can be generated from the dashboard` });
        return;
      }
      const boardConfig = config.boards[templateConfig.source_board];
      if (!boardConfig) {
        res.status(500).json({ error: `Template source board "${templateConfig.source_board}" missing from boards.yaml` });
        return;
      }

      const board = await fetchBoardStructure(boardConfig.id);
      const resolvedColumns = resolveAllColumns(board.columns, boardConfig, {});
      const item = await fetchItem(profile.monday_item_id);
      const vars = mapItemToTemplateVars(item, templateConfig, resolvedColumns);

      const validation = validateTemplateVars(vars, templateConfig);
      if (!validation.valid) {
        res.status(422).json({ error: `Missing required data: ${validation.errors.join("; ")}` });
        return;
      }

      const templateBuffer = fs.readFileSync(path.join(REPO_ROOT, templateConfig.path));
      const docx = renderDocxTemplate(templateBuffer, vars);

      auditFromReq(req, "doc.generated", {
        targetType: "profile",
        targetId: localId,
        targetMondayId: profile.monday_item_id,
        metadata: { template: templateName, mondayItemId: profile.monday_item_id },
      });

      const safeName = profile.name.replace(/[^a-zA-Z0-9]+/g, "_").slice(0, 40) || "document";
      const stamp = new Date().toISOString().slice(0, 10);
      res.status(200);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="${safeName}-${stamp}.docx"`);
      res.send(docx);
    } catch (err) {
      console.error("[render] doc generation failed:", err);
      res.status(502).json({ error: "Could not generate the document — Monday.com fetch or template render failed" });
    }
  });
}
