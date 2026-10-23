// =============================================================================
// Job run ledger (users.db v19) — when each background job last ran and how
// =============================================================================
// The Workflows screen (Settings → Workflows, P11.7) shows each automation's
// last run and its failures this week. The sync, the webhook processor, the
// write queue and the Slack queue already keep their own history; this table
// is for the jobs that only ever wrote to the log (consult sweep, Drive intake,
// client uploads, LawPay, Fee K auto-fill, backup).
//
// One row per run that actually started. A tick skipped because something else
// was running is not a run and is not stored — those would be most rows.
// `summary` is a count line ("3 filled, 0 failed"), never a client's name.
// Rows older than KEEP_DAYS are pruned hourly (server.ts).
// =============================================================================

import type BetterSqlite3 from "better-sqlite3";

type Database = BetterSqlite3.Database;

export const createJobRunsTableSql = `
  CREATE TABLE IF NOT EXISTS job_runs (
    id           INTEGER PRIMARY KEY,
    job          TEXT NOT NULL,
    started_at   TEXT NOT NULL,
    finished_at  TEXT,
    status       TEXT NOT NULL,
    summary      TEXT,
    error        TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_job_runs_job ON job_runs(job, started_at DESC);
`;

export const KEEP_DAYS = 14;
const ERROR_MAX = 500;

export type JobRunStatus = "running" | "ok" | "failed";

export interface JobRun {
  job: string;
  startedAt: string;
  finishedAt: string | null;
  status: JobRunStatus;
  summary: string | null;
  error: string | null;
}

/** What a tracked run reports: a summary line, and an error when it failed without throwing. */
export interface RunOutcome {
  summary?: string | null;
  error?: string | null;
}

const clip = (s: string | null | undefined): string | null => (s ? s.slice(0, ERROR_MAX) : null);

// The ledger never fails a job: a write that fails is logged and skipped
// (startRun then returns null, and finishRun(null) does nothing).

export function startRun(db: Database, job: string, now = new Date()): number | null {
  try {
    return Number(
      db.prepare(`INSERT INTO job_runs (job, started_at, status) VALUES (?, ?, 'running')`).run(job, now.toISOString())
        .lastInsertRowid,
    );
  } catch (err) {
    console.error(`[job-runs] could not record the start of ${job}:`, err);
    return null;
  }
}

export function finishRun(db: Database, id: number | null, outcome: RunOutcome, now = new Date()): void {
  if (id === null) return;
  try {
    db.prepare(`UPDATE job_runs SET finished_at = ?, status = ?, summary = ?, error = ? WHERE id = ?`).run(
      now.toISOString(),
      outcome.error ? "failed" : "ok",
      outcome.summary ?? null,
      clip(outcome.error),
      id,
    );
  } catch (err) {
    console.error(`[job-runs] could not record the end of run ${id}:`, err);
  }
}

/**
 * Record a run that has already finished. For jobs that only say at the end
 * whether they ran at all (the LawPay readers return null when one is still
 * going), so a skipped tick never leaves a row.
 */
export function recordRun(db: Database, job: string, startedAt: Date, outcome: RunOutcome, now = new Date()): void {
  finishRun(db, startRun(db, job, startedAt), outcome, now);
}

/**
 * Record one run of `job` around `fn`. `fn` returns a summary line, or a
 * RunOutcome with `error` for a job that reports failure in its result. A throw
 * is stored as failed and rethrown, so the caller's own error handling (the
 * log line, notifyOps) is unchanged. A ledger write that fails never fails the
 * job.
 */
export async function trackRun<T extends string | RunOutcome | null | void>(
  db: Database,
  job: string,
  fn: () => Promise<T>,
): Promise<T> {
  const id = startRun(db, job);
  try {
    const result = await fn();
    finishRun(db, id, typeof result === "string" ? { summary: result } : (result ?? {}));
    return result;
  } catch (err) {
    finishRun(db, id, { error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

/** On boot: a run still marked running was cut off by a restart. */
export function recoverInterruptedRuns(db: Database): number {
  return db
    .prepare(
      `UPDATE job_runs SET status = 'failed', finished_at = started_at, error = 'Interrupted by a restart'
       WHERE status = 'running'`,
    )
    .run().changes;
}

export function pruneRuns(db: Database, now = new Date()): number {
  const cutoff = new Date(now.getTime() - KEEP_DAYS * 86_400_000).toISOString();
  return db.prepare(`DELETE FROM job_runs WHERE started_at < ?`).run(cutoff).changes;
}

export interface JobRunStats {
  lastRun: JobRun | null;
  /** Failed runs since `since`. */
  failures: number;
  /** Up to 5 most recent failures since `since`, newest first. */
  recentFailures: JobRun[];
}

interface Raw {
  job: string; started_at: string; finished_at: string | null; status: JobRunStatus; summary: string | null; error: string | null;
}

const toRun = (r: Raw): JobRun => ({
  job: r.job, startedAt: r.started_at, finishedAt: r.finished_at, status: r.status, summary: r.summary, error: r.error,
});

export function runStats(db: Database, job: string, since: Date): JobRunStats {
  const last = db
    .prepare(`SELECT * FROM job_runs WHERE job = ? ORDER BY started_at DESC, id DESC LIMIT 1`)
    .get(job) as Raw | undefined;
  const sinceIso = since.toISOString();
  const { n } = db
    .prepare(`SELECT COUNT(*) AS n FROM job_runs WHERE job = ? AND status = 'failed' AND started_at >= ?`)
    .get(job, sinceIso) as { n: number };
  const recent = db
    .prepare(
      `SELECT * FROM job_runs WHERE job = ? AND status = 'failed' AND started_at >= ?
       ORDER BY started_at DESC, id DESC LIMIT 5`,
    )
    .all(job, sinceIso) as Raw[];
  return { lastRun: last ? toRun(last) : null, failures: n, recentFailures: recent.map(toRun) };
}
