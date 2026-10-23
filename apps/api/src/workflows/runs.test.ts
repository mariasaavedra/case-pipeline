import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { createJobRunsTableSql, trackRun, recoverInterruptedRuns, pruneRuns, runStats, startRun, finishRun } from "./runs.js";

let db: Database.Database;
beforeEach(() => {
  db = new Database(":memory:");
  db.exec(createJobRunsTableSql);
});

const all = () => db.prepare("SELECT job, status, summary, error FROM job_runs ORDER BY id").all();

describe("trackRun", () => {
  it("stores a summary string as an ok run", async () => {
    await expect(trackRun(db, "feek", async () => "3 filled, 0 failed")).resolves.toBe("3 filled, 0 failed");
    expect(all()).toEqual([{ job: "feek", status: "ok", summary: "3 filled, 0 failed", error: null }]);
  });

  it("stores a returned error as failed without throwing", async () => {
    await trackRun(db, "lawpay", async () => ({ summary: null, error: "Slack said no" }));
    expect(all()).toEqual([{ job: "lawpay", status: "failed", summary: null, error: "Slack said no" }]);
  });

  it("stores a throw as failed and rethrows it", async () => {
    await expect(trackRun(db, "backup", async () => { throw new Error("disk full"); })).rejects.toThrow("disk full");
    expect(all()).toEqual([{ job: "backup", status: "failed", summary: null, error: "disk full" }]);
  });

  it("clips long errors", async () => {
    await trackRun(db, "x", async () => ({ error: "e".repeat(2000) }));
    expect((all()[0] as { error: string }).error).toHaveLength(500);
  });

  it("still runs the job when the ledger can't be written", async () => {
    db.exec("DROP TABLE job_runs");
    await expect(trackRun(db, "x", async () => "fine")).resolves.toBe("fine");
  });
});

describe("recoverInterruptedRuns / pruneRuns", () => {
  it("marks runs cut off by a restart as failed", () => {
    startRun(db, "drive");
    expect(recoverInterruptedRuns(db)).toBe(1);
    expect(all()).toEqual([{ job: "drive", status: "failed", summary: null, error: "Interrupted by a restart" }]);
  });

  it("drops runs older than 14 days", () => {
    const now = new Date("2026-10-23T12:00:00Z");
    finishRun(db, startRun(db, "a", new Date("2026-10-01T00:00:00Z")), {});
    finishRun(db, startRun(db, "a", new Date("2026-10-20T00:00:00Z")), {});
    expect(pruneRuns(db, now)).toBe(1);
    expect(all()).toHaveLength(1);
  });
});

describe("runStats", () => {
  it("gives the last run and the failures since a date, newest first", () => {
    const at = (iso: string) => new Date(iso);
    finishRun(db, startRun(db, "j", at("2026-10-10T00:00:00Z")), { error: "old" });
    finishRun(db, startRun(db, "j", at("2026-10-20T00:00:00Z")), { error: "first" });
    finishRun(db, startRun(db, "j", at("2026-10-21T00:00:00Z")), { error: "second" });
    finishRun(db, startRun(db, "j", at("2026-10-22T00:00:00Z")), { summary: "ok now" });
    finishRun(db, startRun(db, "other", at("2026-10-23T00:00:00Z")), { error: "not mine" });

    const s = runStats(db, "j", at("2026-10-16T00:00:00Z"));
    expect(s.lastRun).toMatchObject({ status: "ok", summary: "ok now", startedAt: "2026-10-22T00:00:00.000Z" });
    expect(s.failures).toBe(2);
    expect(s.recentFailures.map((r) => r.error)).toEqual(["second", "first"]);
  });

  it("has no last run for a job that never ran", () => {
    expect(runStats(db, "never", new Date())).toEqual({ lastRun: null, failures: 0, recentFailures: [] });
  });
});
