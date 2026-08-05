// =============================================================================
// Sync health — visibility into the last sync run, coverage, and the write queue
// =============================================================================
// Reads the v21 ledger (sync_runs / sync_run_boards), the write_queue, and
// archived_rows so the admin can SEE that the mirror is complete (per-board
// coverage), what got archived, and whether any write-backs are stuck.

import type BetterSqlite3 from "better-sqlite3";
type Database = BetterSqlite3.Database;

export interface SyncBoardCoverage {
  boardKey: string;
  fetched: number | null;
  expected: number | null;
  upserted: number | null;
  archived: number;
  truncated: boolean;
  error: string | null;
  /** fetched/expected as a percentage, or null when expected is unknown. */
  coveragePct: number | null;
}

export interface SyncHealth {
  lastRun: { id: number; startedAt: string; finishedAt: string | null; mode: string; status: string } | null;
  boards: SyncBoardCoverage[];
  queue: { pending: number; failed: number };
  lastFullSweepAt: string | null;
  archivedTotal: number;
}

export function getSyncHealth(db: Database): SyncHealth {
  const lastRun = db
    .prepare("SELECT id, started_at, finished_at, mode, status FROM sync_runs ORDER BY id DESC LIMIT 1")
    .get() as { id: number; started_at: string; finished_at: string | null; mode: string; status: string } | undefined;

  const boards: SyncBoardCoverage[] = lastRun
    ? (db
        .prepare(
          `SELECT board_key, fetched, expected, upserted, archived, truncated, error
           FROM sync_run_boards WHERE run_id = ? ORDER BY board_key`,
        )
        .all(lastRun.id) as Array<{
          board_key: string; fetched: number | null; expected: number | null;
          upserted: number | null; archived: number; truncated: number; error: string | null;
        }>).map((r) => ({
          boardKey: r.board_key,
          fetched: r.fetched,
          expected: r.expected,
          upserted: r.upserted,
          archived: r.archived,
          truncated: !!r.truncated,
          error: r.error,
          coveragePct: r.expected && r.expected > 0 && r.fetched != null
            ? Math.min(100, Math.round((r.fetched / r.expected) * 100))
            : null,
        }))
    : [];

  const queueRow = db
    .prepare("SELECT SUM(status='pending') AS pending, SUM(status='failed') AS failed FROM write_queue")
    .get() as { pending: number | null; failed: number | null };

  const lastFull = db
    .prepare("SELECT MAX(last_full_sweep_at) AS t FROM sync_watermarks")
    .get() as { t: string | null };

  const archived = db.prepare("SELECT COUNT(*) AS n FROM archived_rows").get() as { n: number };

  return {
    lastRun: lastRun
      ? { id: lastRun.id, startedAt: lastRun.started_at, finishedAt: lastRun.finished_at, mode: lastRun.mode, status: lastRun.status }
      : null,
    boards,
    queue: { pending: queueRow.pending ?? 0, failed: queueRow.failed ?? 0 },
    lastFullSweepAt: lastFull.t,
    archivedTotal: archived.n,
  };
}

export interface ArchivedRow {
  id: number;
  sourceTable: string;
  boardKey: string | null;
  mondayItemId: string | null;
  localId: string | null;
  archivedAt: string;
  runId: number | null;
  name: string | null;
}

/** Recently archived (reconciled-away) rows, newest first. `name` is pulled from
 * the snapshot for display. */
export function getArchivedRows(db: Database, limit = 100): ArchivedRow[] {
  const rows = db
    .prepare(
      `SELECT id, source_table, board_key, monday_item_id, local_id, snapshot_json, run_id, archived_at
       FROM archived_rows ORDER BY id DESC LIMIT ?`,
    )
    .all(limit) as Array<{
      id: number; source_table: string; board_key: string | null; monday_item_id: string | null;
      local_id: string | null; snapshot_json: string; run_id: number | null; archived_at: string;
    }>;
  return rows.map((r) => {
    let name: string | null = null;
    try {
      name = (JSON.parse(r.snapshot_json) as { name?: string }).name ?? null;
    } catch {
      /* ignore */
    }
    return {
      id: r.id, sourceTable: r.source_table, boardKey: r.board_key, mondayItemId: r.monday_item_id,
      localId: r.local_id, archivedAt: r.archived_at, runId: r.run_id, name,
    };
  });
}
