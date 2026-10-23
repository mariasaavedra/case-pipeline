// =============================================================================
// Workflows report — the catalog + each workflow's switch and run history
// =============================================================================
// What GET /api/workflows returns. History comes from wherever the workflow
// keeps it (catalog.ts `history`): our job_runs ledger, or the table the
// feature already writes one row per item to. Times are ISO UTC; SQLite's
// datetime('now') strings are converted.
// =============================================================================

import type BetterSqlite3 from "better-sqlite3";
import { WORKFLOWS, WORKFLOW_GROUPS, describeCron, type WorkflowDef, type WorkflowGroup, type WorkflowHistory } from "./catalog.js";
import { runStats } from "./runs.js";

type Database = BetterSqlite3.Database;

export const FAILURE_WINDOW_DAYS = 7;

export interface WorkflowRunView {
  at: string;
  status: "running" | "ok" | "failed";
  summary: string | null;
  error: string | null;
}

export interface WorkflowView {
  key: string;
  name: string;
  when: string;
  then: string;
  group: WorkflowGroup;
  kind: WorkflowDef["kind"];
  schedule: { cron: string; words: string; firmTime: boolean } | null;
  on: boolean;
  reason: string | null;
  doc: string | null;
  opsEvent: string | null;
  /** False when nothing we can read records its runs (Slack posts, outside the app). */
  tracked: boolean;
  lastRun: WorkflowRunView | null;
  failures: number;
  recentFailures: { at: string; error: string | null }[];
  /** Set when its history couldn't be read. */
  historyError: string | null;
}

export interface WorkflowsReport {
  groups: typeof WORKFLOW_GROUPS;
  failureWindowDays: number;
  workflows: WorkflowView[];
}

export interface ReportDeps {
  /** The mirror (live.db / seed.db). */
  db: Database;
  usersDb: Database;
  live: boolean;
  env?: NodeJS.ProcessEnv;
  now?: Date;
}

/** "2026-10-23 12:00:00" (SQLite) → "2026-10-23T12:00:00.000Z"; ISO passes through. */
export function toIso(s: string): string {
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s) ? `${s.replace(" ", "T")}.000Z` : s;
}

interface History {
  lastRun: WorkflowRunView | null;
  failures: number;
  recentFailures: { at: string; error: string | null }[];
}

const EMPTY: History = { lastRun: null, failures: 0, recentFailures: [] };

/**
 * History from a table with one row per item: the newest finished row is the
 * last run, rows in a failed state since `since` are the failures.
 */
function fromItemTable(
  db: Database,
  q: { table: string; at: string; done: string; failed: string; error: string; waiting?: string },
  since: Date,
): History {
  const last = db
    .prepare(`SELECT ${q.at} AS at, (${q.failed}) AS failed, ${q.error} AS error FROM ${q.table}
              WHERE ${q.done} AND ${q.at} IS NOT NULL ORDER BY datetime(${q.at}) DESC, id DESC LIMIT 1`)
    .get() as { at: string; failed: number; error: string | null } | undefined;
  const waiting = q.waiting
    ? (db.prepare(`SELECT COUNT(*) AS n FROM ${q.table} WHERE ${q.waiting}`).get() as { n: number }).n
    : null;
  const recentWhere = `${q.failed} AND datetime(${q.at}) >= datetime(?)`;
  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM ${q.table} WHERE ${recentWhere}`).get(since.toISOString()) as { n: number };
  const recent = db
    .prepare(`SELECT ${q.at} AS at, ${q.error} AS error FROM ${q.table} WHERE ${recentWhere}
              ORDER BY datetime(${q.at}) DESC, id DESC LIMIT 5`)
    .all(since.toISOString()) as { at: string; error: string | null }[];
  return {
    lastRun: last
      ? {
          at: toIso(last.at),
          status: last.failed ? "failed" : "ok",
          summary: waiting === null ? null : `${waiting} waiting`,
          error: last.failed ? last.error : null,
        }
      : null,
    failures: n,
    recentFailures: recent.map((r) => ({ at: toIso(r.at), error: r.error })),
  };
}

function readHistory(kind: WorkflowHistory, key: string, deps: ReportDeps, since: Date): History {
  switch (kind) {
    case "job_runs": {
      const s = runStats(deps.usersDb, key, since);
      return {
        lastRun: s.lastRun
          ? { at: s.lastRun.startedAt, status: s.lastRun.status, summary: s.lastRun.summary, error: s.lastRun.error }
          : null,
        failures: s.failures,
        recentFailures: s.recentFailures.map((r) => ({ at: r.startedAt, error: r.error })),
      };
    }
    case "write_queue":
      return fromItemTable(deps.db, {
        table: "write_queue", at: "updated_at", error: "op_type || ': ' || COALESCE(last_error, 'failed')",
        done: "status IN ('synced', 'failed')", failed: "status = 'failed'", waiting: "status IN ('pending', 'syncing')",
      }, since);
    case "webhook_events":
      return fromItemTable(deps.db, {
        table: "webhook_events", at: "processed_at", error: "event_type || ': ' || COALESCE(last_error, 'failed')",
        done: "status IN ('processed', 'skipped', 'failed')", failed: "status = 'failed'", waiting: "status = 'pending'",
      }, since);
    case "slack_queue":
      return fromItemTable(deps.usersDb, {
        table: "slack_queue", at: "updated_at", error: "error",
        done: "status IN ('sent', 'failed')", failed: "status = 'failed'", waiting: "status = 'queued'",
      }, since);
    case "esign":
      return fromItemTable(deps.db, {
        table: "esign_agreements", at: "updated_at", error: "COALESCE(last_error, 'send failed')",
        done: "1", failed: "status = 'send_failed'",
      }, since);
    case "none":
      return EMPTY;
  }
}

export function buildWorkflowsReport(deps: ReportDeps): WorkflowsReport {
  const env = deps.env ?? process.env;
  const now = deps.now ?? new Date();
  const since = new Date(now.getTime() - FAILURE_WINDOW_DAYS * 86_400_000);

  const workflows = WORKFLOWS.map((w): WorkflowView => {
    const sw = w.enabled({ env, live: deps.live });
    const sched = w.schedule?.(env);
    let history = EMPTY;
    let historyError: string | null = null;
    try {
      history = readHistory(w.history, w.key, deps, since);
    } catch (err) {
      historyError = (err as Error).message;
    }
    return {
      key: w.key, name: w.name, when: w.when, then: w.then, group: w.group, kind: w.kind,
      schedule: sched ? { ...sched, words: describeCron(sched.cron) } : null,
      on: sw.on, reason: sw.reason ?? null,
      doc: w.doc ?? null, opsEvent: w.opsEvent ?? null,
      tracked: w.history !== "none",
      ...history,
      historyError,
    };
  });

  return { groups: WORKFLOW_GROUPS, failureWindowDays: FAILURE_WINDOW_DAYS, workflows };
}
