// =============================================================================
// Buzón checklist counts for case cards (docs/features/buzon.md)
// =============================================================================
// Per Fee K: how many of the required documents its client was asked to send
// have come in (upload_checklist_items, schema v39). Not needed ones are left
// out. The rules and writes are in apps/api/src/uploads/checklist.ts.
// =============================================================================

import type BetterSqlite3 from "better-sqlite3";
type Database = BetterSqlite3.Database;

export interface ChecklistCount {
  received: number;
  total: number;
}

/** Fee K local id → its count, only for Fee Ks that have a checklist. One query for the batch. */
export function checklistCounts(db: Database, feeKLocalIds: string[]): Map<string, ChecklistCount> {
  const out = new Map<string, ChecklistCount>();
  if (!feeKLocalIds.length) return out;
  // A database from before v39 (some tests) has no checklist table.
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'upload_checklist_items'").get()) return out;
  const rows = db.prepare(`
    SELECT c.local_id AS id,
           SUM(i.status = 'received') AS received,
           COUNT(*) AS total
      FROM contracts c
      JOIN upload_checklist_items i
        ON (i.fee_k_local_id = c.local_id OR (c.monday_item_id IS NOT NULL AND i.fee_k_monday_id = c.monday_item_id))
     WHERE c.local_id IN (SELECT value FROM json_each(?))
       AND i.required = 1 AND i.status != 'not_needed'
     GROUP BY c.local_id
  `).all(JSON.stringify(feeKLocalIds)) as { id: string; received: number; total: number }[];
  for (const r of rows) out.set(r.id, { received: r.received, total: r.total });
  return out;
}
