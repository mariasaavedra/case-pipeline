// =============================================================================
// Board schema refresh — keep column/status definitions fresh at startup
// =============================================================================
// Fetches each board's STRUCTURE only (no items — light, ~one call per board)
// and repopulates board_columns + board_status_options. Run in the background on
// every API startup so the all-columns editor and the status editor work
// immediately after a deploy, without waiting for the next data sync. The rows
// persist in the DB, so a failed refresh just leaves the last-good schema in
// place. Mirrors the capture logic in scripts/sync/index.ts (resolveBoard).
// =============================================================================

import type BetterSqlite3 from "better-sqlite3";
type Database = BetterSqlite3.Database;
import { fetchBoardStructure, resolveAllColumns, parseStatusOptions } from "@case-pipeline/monday";
import { loadBoardsConfig } from "@case-pipeline/config";

interface ResolvedMeta {
  id: string;
  type: string;
}

export async function refreshBoardSchema(db: Database): Promise<{ boards: number; failed: number }> {
  const boardsConfig = await loadBoardsConfig();

  const upsertStatus = db.prepare(`
    INSERT INTO board_status_options (board_key, monday_board_id, status_column_id, options, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(board_key) DO UPDATE SET
      monday_board_id = excluded.monday_board_id,
      status_column_id = excluded.status_column_id,
      options = excluded.options,
      updated_at = excluded.updated_at
  `);
  const deleteCols = db.prepare("DELETE FROM board_columns WHERE board_key = ?");
  const insertCol = db.prepare(`
    INSERT INTO board_columns (board_key, monday_board_id, column_id, title, type, options, position, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);

  let boards = 0;
  let failed = 0;
  for (const [key, config] of Object.entries(boardsConfig)) {
    try {
      const structure = await fetchBoardStructure(config.id);
      const resolved = resolveAllColumns(structure.columns, config) as Record<string, ResolvedMeta | undefined>;

      const statusMeta = resolved.status;
      if (statusMeta) {
        const statusCol = structure.columns.find((c) => c.id === statusMeta.id);
        if (statusCol) {
          const opts = parseStatusOptions(statusCol);
          if (opts.length > 0) upsertStatus.run(key, config.id, statusMeta.id, JSON.stringify(opts));
        }
      }

      const tx = db.transaction(() => {
        deleteCols.run(key);
        structure.columns.forEach((col, i) => {
          const opts = parseStatusOptions(col);
          insertCol.run(key, config.id, col.id, col.title, col.type, opts.length > 0 ? JSON.stringify(opts) : null, i);
        });
      });
      tx();
      boards++;
    } catch (e) {
      failed++;
      console.error(`[schema-refresh] ${key} failed:`, e instanceof Error ? e.message : e);
    }
  }
  return { boards, failed };
}
