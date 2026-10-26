// =============================================================================
// Buzón checklist — the documents a client is asked to send (docs/features/buzon.md)
// =============================================================================
// Items live per CLIENT (upload_checklist_items, schema v39), not per link, so
// a new link shows the same list. A Fee K's list is copied from its Fee K
// Type(s) in Settings → Firm → Fee K Types; a later Settings edit doesn't touch
// a list a client already has. Staff can add one by hand, or mark one "Already
// have it" (not_needed) — the client never sees those.
//
// The client page shows each document once: two cases asking for "Passport"
// are one row, and a file sent for it counts for both.
// =============================================================================

import type BetterSqlite3 from "better-sqlite3";
type DatabaseInstance = BetterSqlite3.Database;
import { feeKCaseTypeSql } from "@case-pipeline/query";
import { feeKTypeLookup, type FeeKTypeRow } from "../fee-k-types.js";
export { evidenceFolder } from "./filing.js";

export const ITEM_STATUSES = ["missing", "received", "not_needed"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const MAX_ITEMS_PER_CLIENT = 80;

export interface ChecklistRow {
  id: number;
  profile_local_id: string;
  profile_monday_id: string | null;
  fee_k_local_id: string | null;
  fee_k_monday_id: string | null;
  fee_k_type: string | null;
  appointment_monday_id: string | null;
  consult_list: string | null;
  label_en: string;
  label_es: string;
  required: number;
  status: ItemStatus;
  position: number;
  received_at: string | null;
  added_by_name: string | null;
  updated_by_name: string | null;
  created_at: string;
}

export interface ClientKey {
  localId: string;
  mondayId: string | null;
}

/** A client's rows by their Monday id when they have one (survives a re-sync), else the local id. */
export function clientClause(p: ClientKey, alias = ""): { sql: string; args: string[] } {
  const a = alias ? `${alias}.` : "";
  return p.mondayId
    ? { sql: `(${a}profile_monday_id = ? OR ${a}profile_local_id = ?)`, args: [p.mondayId, p.localId] }
    : { sql: `${a}profile_local_id = ?`, args: [p.localId] };
}

export function checklistFor(db: DatabaseInstance, p: ClientKey): ChecklistRow[] {
  const who = clientClause(p);
  return db.prepare(`SELECT * FROM upload_checklist_items WHERE ${who.sql} ORDER BY position, id`).all(...who.args) as ChecklistRow[];
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

// --- What the client sees ------------------------------------------------------

export interface PublicItem {
  /** The item a file for this row is filed under (the first of its name). */
  id: number;
  en: string;
  es: string;
  required: boolean;
  received: boolean;
}

/** One row per document name, not_needed left out. Never says which case it is for. */
export function publicChecklist(rows: ChecklistRow[]): PublicItem[] {
  const byName = new Map<string, PublicItem>();
  for (const r of rows) {
    if (r.status === "not_needed") continue;
    const k = norm(r.label_en);
    const seen = byName.get(k);
    if (seen) {
      seen.required ||= r.required === 1;
      seen.received ||= r.status === "received";
      continue;
    }
    byName.set(k, { id: r.id, en: r.label_en, es: r.label_es, required: r.required === 1, received: r.status === "received" });
  }
  return [...byName.values()];
}

/**
 * A file came in for `item`: it and every other item of the same name still
 * missing for this client turn received. Returns the item ids marked.
 */
export function markReceived(db: DatabaseInstance, item: ChecklistRow): number[] {
  const who = clientClause({ localId: item.profile_local_id, mondayId: item.profile_monday_id });
  const same = (db.prepare(
    `SELECT id, label_en FROM upload_checklist_items WHERE ${who.sql} AND status = 'missing'`,
  ).all(...who.args) as { id: number; label_en: string }[]).filter((r) => norm(r.label_en) === norm(item.label_en));
  const mark = db.prepare(
    "UPDATE upload_checklist_items SET status = 'received', received_at = COALESCE(received_at, datetime('now')), updated_at = datetime('now') WHERE id = ?",
  );
  db.transaction(() => same.forEach((r) => mark.run(r.id)))();
  return same.map((r) => r.id);
}

// --- A Fee K's list ------------------------------------------------------------

export interface ClientFeeK {
  localId: string;
  mondayId: string | null;
  name: string;
  feeKTypes: string[];
  contractStage: string | null;
}

function parseLabels(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];
  } catch {
    return [];
  }
}

/** The client's Fee Ks, newest first, each with its Fee K Type(s). */
export function clientFeeKs(db: DatabaseInstance, p: ClientKey): ClientFeeK[] {
  const who = p.mondayId
    ? { sql: "(c.profile_monday_id = ? OR c.profile_local_id = ?)", args: [p.mondayId, p.localId] }
    : { sql: "c.profile_local_id = ?", args: [p.localId] };
  const rows = db.prepare(`
    SELECT c.local_id AS localId, c.monday_item_id AS mondayId, c.name,
           ${feeKCaseTypeSql()} AS types,
           json_extract(c.raw_column_values, '$.contract_stage.label') AS contractStage
      FROM contracts c
     WHERE c.deleted_at IS NULL AND ${who.sql}
     ORDER BY c.id DESC
  `).all(...who.args) as { localId: string; mondayId: string | null; name: string; types: string | null; contractStage: string | null }[];
  return rows.map((r) => ({ localId: r.localId, mondayId: r.mondayId, name: r.name, feeKTypes: parseLabels(r.types), contractStage: r.contractStage }));
}

/** The documents a Fee K's type(s) ask for, each tagged with the type it came from. */
export function documentsForFeeK(feeK: Pick<ClientFeeK, "feeKTypes">, table: FeeKTypeRow[]) {
  const find = feeKTypeLookup(table);
  return feeK.feeKTypes.flatMap((t) => {
    const row = find(t);
    return (row?.documents ?? []).map((d) => ({ ...d, feeKType: row!.feeKType }));
  });
}

/**
 * Copy a Fee K's list into the client's checklist. A document this Fee K
 * already has (same name) is skipped, so adding twice adds nothing. Returns
 * how many were added.
 */
export function addFeeKList(
  db: DatabaseInstance,
  p: ClientKey,
  feeK: ClientFeeK,
  table: FeeKTypeRow[],
  by: string | null,
): number {
  const docs = documentsForFeeK(feeK, table);
  const existing = checklistFor(db, p);
  const have = new Set(existing.filter((r) => sameFeeK(r, feeK)).map((r) => norm(r.label_en)));
  let position = existing.reduce((m, r) => Math.max(m, r.position), 0);
  const room = MAX_ITEMS_PER_CLIENT - existing.length;
  const fresh = docs.filter((d) => !have.has(norm(d.en)) && (have.add(norm(d.en)), true)).slice(0, Math.max(0, room));
  const ins = db.prepare(`
    INSERT INTO upload_checklist_items
      (profile_local_id, profile_monday_id, fee_k_local_id, fee_k_monday_id, fee_k_type, label_en, label_es, required, position, added_by_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  db.transaction(() => {
    for (const d of fresh) {
      ins.run(p.localId, p.mondayId, feeK.localId, feeK.mondayId, d.feeKType, d.en, d.es || d.en, d.required ? 1 : 0, ++position, by);
    }
  })();
  return fresh.length;
}

/**
 * M30 → Evidence → a case type: that one type's list, for any type (decided
 * 2026-10-26). Tied to the client's newest Fee K of that type when they have
 * one (so its Evidence Received + bells work), else to no Fee K — the files
 * still go to EVIDENCE <type>. A document this type already has for the client
 * is skipped. Returns how many were added, or null for a type with no list.
 */
export function addCaseTypeList(
  db: DatabaseInstance,
  p: ClientKey,
  feeKType: string,
  table: FeeKTypeRow[],
  by: string | null,
): { added: number; feeK: ClientFeeK | null } | null {
  const row = feeKTypeLookup(table)(feeKType);
  if (!row?.documents?.length) return null;
  const feeK = clientFeeKs(db, p).find((k) => k.feeKTypes.some((t) => norm(t) === norm(row.feeKType))) ?? null;
  const existing = checklistFor(db, p);
  const have = new Set(existing.filter((r) => r.fee_k_type && norm(r.fee_k_type) === norm(row.feeKType)).map((r) => norm(r.label_en)));
  let position = existing.reduce((m, r) => Math.max(m, r.position), 0);
  const room = MAX_ITEMS_PER_CLIENT - existing.length;
  const fresh = row.documents.filter((d) => !have.has(norm(d.en)) && (have.add(norm(d.en)), true)).slice(0, Math.max(0, room));
  const ins = db.prepare(`
    INSERT INTO upload_checklist_items
      (profile_local_id, profile_monday_id, fee_k_local_id, fee_k_monday_id, fee_k_type, label_en, label_es, required, position, added_by_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  db.transaction(() => {
    for (const d of fresh) {
      ins.run(p.localId, p.mondayId, feeK?.localId ?? null, feeK?.mondayId ?? null, row.feeKType, d.en, d.es || d.en, d.required ? 1 : 0, ++position, by);
    }
  })();
  return { added: fresh.length, feeK };
}

/**
 * Copy a consult list (Settings → Firm → Consult document lists) onto the
 * client's checklist for one appointment (Phase 5). A document already asked
 * for this appointment is skipped. Returns how many were added.
 */
export function addConsultList(
  db: DatabaseInstance,
  p: ClientKey,
  list: { key: string; documents: { en: string; es: string; required: boolean }[] },
  appointmentMondayId: string,
  by: string | null,
): number {
  const existing = checklistFor(db, p);
  const have = new Set(existing.filter((r) => r.appointment_monday_id === appointmentMondayId).map((r) => norm(r.label_en)));
  let position = existing.reduce((m, r) => Math.max(m, r.position), 0);
  const room = MAX_ITEMS_PER_CLIENT - existing.length;
  const fresh = list.documents.filter((d) => !have.has(norm(d.en)) && (have.add(norm(d.en)), true)).slice(0, Math.max(0, room));
  const ins = db.prepare(`
    INSERT INTO upload_checklist_items
      (profile_local_id, profile_monday_id, appointment_monday_id, consult_list, label_en, label_es, required, position, added_by_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  db.transaction(() => {
    for (const d of fresh) ins.run(p.localId, p.mondayId, appointmentMondayId, list.key, d.en, d.es || d.en, d.required ? 1 : 0, ++position, by);
  })();
  return fresh.length;
}

/** The client's consults (appointments on the attorney boards), newest first. */
export function clientConsults(db: DatabaseInstance, p: ClientKey): { mondayId: string; name: string; date: string | null }[] {
  return db.prepare(`
    SELECT monday_item_id AS mondayId, name, COALESCE(json_extract(column_values, '$.consult_date.date'), json_extract(column_values, '$.consult_date')) AS date
      FROM board_items
     WHERE profile_local_id = ? AND board_key LIKE 'appointments_%' AND deleted_at IS NULL AND monday_item_id IS NOT NULL
     ORDER BY date DESC, id DESC
  `).all(p.localId) as { mondayId: string; name: string; date: string | null }[];
}

function sameFeeK(r: ChecklistRow, feeK: Pick<ClientFeeK, "localId" | "mondayId">): boolean {
  return (!!feeK.mondayId && r.fee_k_monday_id === feeK.mondayId) || r.fee_k_local_id === feeK.localId;
}

// Counts for case cards (P13 / P6): libs/query/src/upload-checklist.ts.
