// =============================================================================
// Buzón checklist — staff routes (docs/features/buzon.md)
// =============================================================================
// All behind requireAuth, audited upload_checklist.*:
//   GET    /api/profiles/:localId/upload-checklist         items + the client's Fee Ks and
//                                                           how many documents each one's type asks for
//   POST   /api/profiles/:localId/upload-checklist         {feeKLocalId} → copy that Fee K's list in
//   POST   /api/profiles/:localId/upload-checklist/items   {labelEn, labelEs?, required?, feeKLocalId?} one by hand
//   PATCH  /api/upload-checklist/:id                       {status?: missing | not_needed, required?}
//   DELETE /api/upload-checklist/:id                       only while nothing was sent for it (else 409: mark it not needed)
// Rules = uploads/checklist.ts. The client page reads the list through the
// public /api/u/:token (routes/client-uploads.ts).
// =============================================================================

import type { Express } from "express";
import type BetterSqlite3 from "better-sqlite3";
type DatabaseInstance = BetterSqlite3.Database;
import { requireAuth } from "../auth/middleware.js";
import { auditFromReq } from "../audit/log.js";
import { loadFeeKTypes, type FeeKTypeRow } from "../fee-k-types.js";
import {
  MAX_ITEMS_PER_CLIENT, addConsultList, addFeeKList, checklistFor, clientConsults, clientFeeKs, documentsForFeeK, evidenceFolder,
  type ChecklistRow, type ClientKey,
} from "../uploads/checklist.js";
import { CAF_FOLDER, CONSULT_FOLDER } from "../uploads/filing.js";
import { consultListsSaved, loadConsultLists, saveConsultLists } from "../consult-lists.js";
import { requireAdmin } from "../auth/middleware.js";

const MAX_LABEL = 120;
const label = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, MAX_LABEL) : "");

function profileOf(db: DatabaseInstance, localId: string): (ClientKey & { name: string }) | undefined {
  return db.prepare(
    "SELECT local_id AS localId, monday_item_id AS mondayId, name FROM profiles WHERE local_id = ? AND deleted_at IS NULL",
  ).get(localId) as (ClientKey & { name: string }) | undefined;
}

export function checklistView(db: DatabaseInstance, p: ClientKey, table: FeeKTypeRow[]) {
  const rows = checklistFor(db, p);
  const files = rows.length
    ? (db.prepare(
        `SELECT item_id AS id, COUNT(*) AS n FROM client_uploads WHERE item_id IN (${rows.map(() => "?").join(",")}) GROUP BY item_id`,
      ).all(...rows.map((r) => r.id)) as { id: number; n: number }[])
    : [];
  const fileCount = new Map(files.map((f) => [f.id, f.n]));
  return {
    items: rows.map((r) => ({
      id: r.id,
      labelEn: r.label_en,
      labelEs: r.label_es,
      required: r.required === 1,
      status: r.status,
      feeKLocalId: r.fee_k_local_id,
      feeKType: r.fee_k_type,
      appointmentMondayId: r.appointment_monday_id,
      consultList: r.consult_list,
      folder: r.appointment_monday_id ? `Consult File → ${CONSULT_FOLDER}` : r.fee_k_type ? evidenceFolder(r.fee_k_type) : CAF_FOLDER,
      receivedAt: r.received_at,
      files: fileCount.get(r.id) ?? 0,
      addedBy: r.added_by_name,
    })),
    feeKs: clientFeeKs(db, p).map((k) => ({
      localId: k.localId,
      name: k.name,
      feeKTypes: k.feeKTypes,
      contractStage: k.contractStage,
      documents: documentsForFeeK(k, table).length,
      added: rows.some((r) => r.fee_k_local_id === k.localId || (!!k.mondayId && r.fee_k_monday_id === k.mondayId)),
    })),
    consults: clientConsults(db, p).slice(0, 10).map((c) => ({
      ...c,
      lists: [...new Set(rows.filter((r) => r.appointment_monday_id === c.mondayId).map((r) => r.consult_list).filter(Boolean))],
    })),
  };
}

export function registerUploadChecklistRoutes(app: Express, deps: { db: DatabaseInstance; feeKTypes?: () => FeeKTypeRow[] }): void {
  const { db } = deps;
  const table = deps.feeKTypes ?? loadFeeKTypes;

  app.get("/api/profiles/:localId/upload-checklist", requireAuth, (req, res) => {
    const p = profileOf(db, String(req.params.localId));
    if (!p) {
      res.status(404).json({ error: "Client not found" });
      return;
    }
    res.json({ data: checklistView(db, p, table()) });
  });

  app.post("/api/profiles/:localId/upload-checklist", requireAuth, (req, res) => {
    const p = profileOf(db, String(req.params.localId));
    if (!p) {
      res.status(404).json({ error: "Client not found" });
      return;
    }
    const feeKLocalId = String((req.body ?? {}).feeKLocalId ?? "");
    const feeK = clientFeeKs(db, p).find((k) => k.localId === feeKLocalId);
    if (!feeK) {
      res.status(404).json({ error: "That Fee K isn't this client's" });
      return;
    }
    const rows = table();
    if (!documentsForFeeK(feeK, rows).length) {
      res.status(400).json({ error: "This case type has no document list. Add one in Settings → Firm → Fee K Types." });
      return;
    }
    const added = addFeeKList(db, p, feeK, rows, req.user?.name ? String(req.user.name) : null);
    auditFromReq(req, "upload_checklist.case_added", {
      targetType: "profile", targetId: p.localId, targetMondayId: p.mondayId,
      metadata: { feeK: feeK.mondayId ?? feeK.localId, added },
    });
    res.status(201).json({ data: { added, ...checklistView(db, p, rows) } });
  });

  // --- Consultations (Phase 5) ---------------------------------------------------

  app.get("/api/settings/consult-lists", requireAuth, (_req, res) => {
    res.json({ data: { lists: loadConsultLists(), draft: !consultListsSaved() } });
  });

  app.put("/api/settings/consult-lists", requireAuth, requireAdmin, (req, res) => {
    try {
      const lists = saveConsultLists((req.body as { lists?: unknown } | undefined)?.lists);
      auditFromReq(req, "consult_lists.updated", { targetType: "settings", targetId: "consult-lists", metadata: { lists: lists.length } });
      res.json({ data: { lists, draft: false } });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post("/api/profiles/:localId/upload-checklist/consult", requireAuth, (req, res) => {
    const p = profileOf(db, String(req.params.localId));
    if (!p) {
      res.status(404).json({ error: "Client not found" });
      return;
    }
    const body = (req.body ?? {}) as { listKey?: unknown; appointmentMondayId?: unknown };
    const list = loadConsultLists().find((l) => l.key === String(body.listKey ?? ""));
    if (!list) {
      res.status(404).json({ error: "No such consult list" });
      return;
    }
    const appt = String(body.appointmentMondayId ?? "");
    if (!clientConsults(db, p).some((c) => c.mondayId === appt)) {
      res.status(404).json({ error: "That consult isn't this client's" });
      return;
    }
    const added = addConsultList(db, p, list, appt, req.user?.name ? String(req.user.name) : null);
    auditFromReq(req, "upload_checklist.consult_added", {
      targetType: "profile", targetId: p.localId, targetMondayId: p.mondayId,
      metadata: { list: list.key, appointment: appt, added },
    });
    res.status(201).json({ data: { added, ...checklistView(db, p, table()) } });
  });

  app.post("/api/profiles/:localId/upload-checklist/items", requireAuth, (req, res) => {
    const p = profileOf(db, String(req.params.localId));
    if (!p) {
      res.status(404).json({ error: "Client not found" });
      return;
    }
    const body = (req.body ?? {}) as { labelEn?: unknown; labelEs?: unknown; required?: unknown; feeKLocalId?: unknown };
    const en = label(body.labelEn);
    if (!en) {
      res.status(400).json({ error: "Name the document" });
      return;
    }
    const existing = checklistFor(db, p);
    if (existing.length >= MAX_ITEMS_PER_CLIENT) {
      res.status(400).json({ error: `A client's list can have up to ${MAX_ITEMS_PER_CLIENT} documents` });
      return;
    }
    // With a Fee K the file goes to that case's EVIDENCE folder; without one, to CAF.
    let feeK: ReturnType<typeof clientFeeKs>[number] | undefined;
    if (body.feeKLocalId) {
      feeK = clientFeeKs(db, p).find((k) => k.localId === String(body.feeKLocalId));
      if (!feeK) {
        res.status(404).json({ error: "That Fee K isn't this client's" });
        return;
      }
    }
    const position = existing.reduce((m, r) => Math.max(m, r.position), 0) + 1;
    const id = Number(db.prepare(`
      INSERT INTO upload_checklist_items
        (profile_local_id, profile_monday_id, fee_k_local_id, fee_k_monday_id, fee_k_type, label_en, label_es, required, position, added_by_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      p.localId, p.mondayId, feeK?.localId ?? null, feeK?.mondayId ?? null, feeK?.feeKTypes[0] ?? null,
      en, label(body.labelEs) || en, body.required === false ? 0 : 1, position, req.user?.name ? String(req.user.name) : null,
    ).lastInsertRowid);
    auditFromReq(req, "upload_checklist.item_added", {
      targetType: "profile", targetId: p.localId, targetMondayId: p.mondayId,
      metadata: { item: id, feeK: feeK ? feeK.mondayId ?? feeK.localId : null },
    });
    res.status(201).json({ data: { id, ...checklistView(db, p, table()) } });
  });

  function itemById(id: string): ChecklistRow | undefined {
    return /^\d+$/.test(id) ? (db.prepare("SELECT * FROM upload_checklist_items WHERE id = ?").get(Number(id)) as ChecklistRow | undefined) : undefined;
  }
  const keyOf = (r: ChecklistRow): ClientKey => ({ localId: r.profile_local_id, mondayId: r.profile_monday_id });

  app.patch("/api/upload-checklist/:id", requireAuth, (req, res) => {
    const item = itemById(String(req.params.id));
    if (!item) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    const body = (req.body ?? {}) as { status?: unknown; required?: unknown };
    const sets: string[] = [];
    const args: unknown[] = [];
    if (body.status !== undefined) {
      // Staff can't mark a document received: only a file does that. "missing" on a
      // received one = ask again (a blurry photo); its files stay.
      if (body.status !== "missing" && body.status !== "not_needed") {
        res.status(400).json({ error: "status must be missing or not_needed" });
        return;
      }
      sets.push("status = ?");
      args.push(body.status);
    }
    if (body.required !== undefined) {
      if (typeof body.required !== "boolean") {
        res.status(400).json({ error: "required must be true or false" });
        return;
      }
      sets.push("required = ?");
      args.push(body.required ? 1 : 0);
    }
    if (!sets.length) {
      res.status(400).json({ error: "Nothing to change" });
      return;
    }
    db.prepare(`UPDATE upload_checklist_items SET ${sets.join(", ")}, updated_by_name = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(...args, req.user?.name ? String(req.user.name) : null, item.id);
    auditFromReq(req, "upload_checklist.item_changed", {
      targetType: "profile", targetId: item.profile_local_id, targetMondayId: item.profile_monday_id,
      metadata: { item: item.id, from: item.status, ...(body.status !== undefined ? { status: body.status } : {}), ...(body.required !== undefined ? { required: body.required } : {}) },
    });
    res.json({ data: checklistView(db, keyOf(item), table()) });
  });

  app.delete("/api/upload-checklist/:id", requireAuth, (req, res) => {
    const item = itemById(String(req.params.id));
    if (!item) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    if (db.prepare("SELECT 1 FROM client_uploads WHERE item_id = ?").get(item.id)) {
      res.status(409).json({ error: "The client already sent files for this one. Mark it \"Already have it\" instead." });
      return;
    }
    db.prepare("DELETE FROM upload_checklist_items WHERE id = ?").run(item.id);
    auditFromReq(req, "upload_checklist.item_removed", {
      targetType: "profile", targetId: item.profile_local_id, targetMondayId: item.profile_monday_id,
      metadata: { item: item.id },
    });
    res.json({ data: checklistView(db, keyOf(item), table()) });
  });
}
