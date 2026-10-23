import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { buildWorkflowsReport, toIso } from "./report.js";
import { createJobRunsTableSql, startRun, finishRun } from "./runs.js";
import { createSlackQueueTableSql } from "../notify/slack-queue.js";

let db: Database.Database;
let usersDb: Database.Database;
const now = new Date("2026-10-23T12:00:00Z");

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE write_queue (id INTEGER PRIMARY KEY, op_type TEXT, status TEXT, last_error TEXT, updated_at TEXT);
    CREATE TABLE webhook_events (id INTEGER PRIMARY KEY, event_type TEXT, status TEXT, last_error TEXT, processed_at TEXT);
    CREATE TABLE esign_agreements (id INTEGER PRIMARY KEY, status TEXT, last_error TEXT, updated_at TEXT);
  `);
  usersDb = new Database(":memory:");
  usersDb.exec(createJobRunsTableSql);
  usersDb.exec(createSlackQueueTableSql);
});

const report = (env: NodeJS.ProcessEnv = {}, live = true) => buildWorkflowsReport({ db, usersDb, live, env, now });
const find = (r: ReturnType<typeof report>, key: string) => r.workflows.find((w) => w.key === key)!;

describe("buildWorkflowsReport", () => {
  it("reads job_runs: last run, failures this week only", () => {
    finishRun(usersDb, startRun(usersDb, "fee_k_autofill", new Date("2026-10-10T00:00:00Z")), { error: "old" });
    finishRun(usersDb, startRun(usersDb, "fee_k_autofill", new Date("2026-10-22T00:00:00Z")), { error: "Monday 500" });
    finishRun(usersDb, startRun(usersDb, "fee_k_autofill", new Date("2026-10-23T11:45:00Z")), { summary: "2 filled" });

    const w = find(report({ FEE_K_AUTOFILL: "on", FEE_K_AUTOFILL_SINCE: "2026-10-01", MONDAY_API_TOKEN: "t" }), "fee_k_autofill");
    expect(w).toMatchObject({
      on: true, reason: null, tracked: true,
      schedule: { cron: "*/15 7-20 * * *", words: "Every 15 minutes, 7 am–8 pm", firmTime: true },
      lastRun: { at: "2026-10-23T11:45:00.000Z", status: "ok", summary: "2 filled", error: null },
      failures: 1,
      recentFailures: [{ at: "2026-10-22T00:00:00.000Z", error: "Monday 500" }],
    });
  });

  it("reads the write queue: last delivered write, waiting count, failed writes", () => {
    db.prepare("INSERT INTO write_queue (op_type, status, last_error, updated_at) VALUES (?, ?, ?, ?)").run("change_column", "synced", null, "2026-10-23 11:00:00");
    db.prepare("INSERT INTO write_queue (op_type, status, last_error, updated_at) VALUES (?, ?, ?, ?)").run("create_update", "failed", "403", "2026-10-21T09:00:00.000Z");
    db.prepare("INSERT INTO write_queue (op_type, status, last_error, updated_at) VALUES (?, ?, ?, ?)").run("create_update", "pending", null, "2026-10-23 11:30:00");

    const w = find(report({ MONDAY_API_TOKEN: "t" }), "write_queue");
    expect(w.lastRun).toEqual({ at: "2026-10-23T11:00:00.000Z", status: "ok", summary: "1 waiting", error: null });
    expect(w.failures).toBe(1);
    expect(w.recentFailures).toEqual([{ at: "2026-10-21T09:00:00.000Z", error: "create_update: 403" }]);
  });

  it("marks the last run failed when the newest row failed", () => {
    db.prepare("INSERT INTO webhook_events (event_type, status, last_error, processed_at) VALUES (?, ?, ?, ?)").run("update_column_value", "processed", null, "2026-10-23T10:00:00.000Z");
    db.prepare("INSERT INTO webhook_events (event_type, status, last_error, processed_at) VALUES (?, ?, ?, ?)").run("create_pulse", "failed", "timeout", "2026-10-23T11:00:00.000Z");
    expect(find(report({ MONDAY_WEBHOOK_SECRET: "s", MONDAY_API_TOKEN: "t" }), "webhooks").lastRun)
      .toMatchObject({ status: "failed", error: "create_pulse: timeout" });
  });

  it("untracked workflows have no history; a missing table is reported, not thrown", () => {
    db.exec("DROP TABLE esign_agreements");
    const r = report();
    expect(find(r, "slack_events")).toMatchObject({ tracked: false, lastRun: null, failures: 0, historyError: null });
    expect(find(r, "esign").historyError).toMatch(/esign_agreements/);
    expect(find(r, "monday_create_appt")).toMatchObject({ kind: "external", on: true, reason: "Managed in Monday", schedule: null });
  });

  it("seed data: scheduled jobs say they only run on live data", () => {
    expect(find(report({ NIGHTLY_SYNC: "on", MONDAY_API_TOKEN: "t" }, false), "sync_full"))
      .toMatchObject({ on: false, reason: "Only runs on live data" });
  });

  it("never returns a setting's value", () => {
    const json = JSON.stringify(report({ MONDAY_API_TOKEN: "very-secret-token", ZAPIER_ESIGN_SECRET: "zap-secret", SLACK_BOT_TOKEN: "xoxb-secret" }));
    expect(json).not.toMatch(/very-secret-token|zap-secret|xoxb-secret/);
  });
});

describe("toIso", () => {
  it("converts SQLite datetime strings and leaves ISO alone", () => {
    expect(toIso("2026-10-23 12:00:00")).toBe("2026-10-23T12:00:00.000Z");
    expect(toIso("2026-10-23T12:00:00.000Z")).toBe("2026-10-23T12:00:00.000Z");
  });
});
