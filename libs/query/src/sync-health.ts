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

interface RunRow { id: number; started_at: string; finished_at: string | null; mode: string; status: string }
type RunInfo = { id: number; startedAt: string; finishedAt: string | null; mode: string; status: string };

/** A write-back that Monday refused, kept for inspection. Counts alone said
 * "3 failed" without saying why — and the why (an under-scoped personal token,
 * a deleted item, a label that no longer exists) is the whole diagnosis. */
export interface WriteQueueFailure {
  id: number;
  opType: string;
  mondayItemId: string | null;
  targetTable: string | null;
  targetLocalId: string | null;
  attempts: number;
  lastError: string | null;
  updatedAt: string;
  /** 'failed' (dead-lettered) or 'pending' (still retrying, but erroring). */
  status: string;
}

export interface SyncHealth {
  /** Most recent run, any mode — for recency/status. */
  lastRun: RunInfo | null;
  /** Most recent FULL run — the only mode where per-board coverage is meaningful
   * (an incremental run fetches only changed items, so fetched << expected is normal). */
  lastFullRun: RunInfo | null;
  /** Per-board coverage from the last FULL run (empty until one has run). */
  boards: SyncBoardCoverage[];
  queue: {
    pending: number;
    failed: number;
    /** Most recent erroring write-backs (dead-lettered first), newest first. */
    failures: WriteQueueFailure[];
  };
  lastFullSweepAt: string | null;
  archivedTotal: number;
}

const QUEUE_FAILURE_LIMIT = 20;

export function getSyncHealth(db: Database): SyncHealth {
  const lastRun = db
    .prepare("SELECT id, started_at, finished_at, mode, status FROM sync_runs ORDER BY id DESC LIMIT 1")
    .get() as RunRow | undefined;
  // Coverage is only meaningful for a full sweep — incremental runs fetch just
  // the changed items, so use the last FULL run for the per-board bars.
  const fullRun = db
    .prepare("SELECT id, started_at, finished_at, mode, status FROM sync_runs WHERE mode = 'full' ORDER BY id DESC LIMIT 1")
    .get() as RunRow | undefined;

  const boards: SyncBoardCoverage[] = fullRun
    ? (db
        .prepare(
          `SELECT board_key, fetched, expected, upserted, archived, truncated, error
           FROM sync_run_boards WHERE run_id = ? ORDER BY board_key`,
        )
        .all(fullRun.id) as Array<{
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

  // Dead-lettered rows first (nothing will retry those), then pending rows that
  // are erroring their way toward it.
  const failures = (db
    .prepare(
      `SELECT id, op_type, monday_item_id, target_table, target_local_id,
              attempts, last_error, updated_at, status
         FROM write_queue
        WHERE last_error IS NOT NULL
        ORDER BY (status = 'failed') DESC, updated_at DESC
        LIMIT ?`,
    )
    .all(QUEUE_FAILURE_LIMIT) as Array<{
      id: number; op_type: string; monday_item_id: string | null;
      target_table: string | null; target_local_id: string | null;
      attempts: number; last_error: string | null; updated_at: string; status: string;
    }>).map((r) => ({
      id: r.id,
      opType: r.op_type,
      mondayItemId: r.monday_item_id,
      targetTable: r.target_table,
      targetLocalId: r.target_local_id,
      attempts: r.attempts,
      lastError: r.last_error,
      updatedAt: r.updated_at,
      status: r.status,
    }));

  const lastFull = db
    .prepare("SELECT MAX(last_full_sweep_at) AS t FROM sync_watermarks")
    .get() as { t: string | null };

  const archived = db.prepare("SELECT COUNT(*) AS n FROM archived_rows").get() as { n: number };

  const toInfo = (r: RunRow | undefined): RunInfo | null =>
    r ? { id: r.id, startedAt: r.started_at, finishedAt: r.finished_at, mode: r.mode, status: r.status } : null;

  return {
    lastRun: toInfo(lastRun),
    lastFullRun: toInfo(fullRun),
    boards,
    queue: { pending: queueRow.pending ?? 0, failed: queueRow.failed ?? 0, failures },
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
