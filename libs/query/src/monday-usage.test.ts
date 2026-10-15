import { test, expect } from "vitest";
import Database from "better-sqlite3";
import { initializeSchema } from "@case-pipeline/seed/db/schema";
import { addMondayCallCounts, getMondayCallCounts } from "./monday-usage";

test("adds to an existing day/job instead of replacing it, newest day first", () => {
  const db = new Database(":memory:");
  initializeSchema(db);
  addMondayCallCounts(db, [
    { day: "2026-10-13", job: "sync:incremental", calls: 40 },
    { day: "2026-10-14", job: "sync:full", calls: 5000 },
  ]);
  // The sync flushes every minute: later flushes add to the same row.
  addMondayCallCounts(db, [
    { day: "2026-10-14", job: "sync:full", calls: 2500 },
    { day: "2026-10-14", job: "app", calls: 12 },
  ]);
  addMondayCallCounts(db, []);

  expect(getMondayCallCounts(db, "2026-10-13")).toEqual([
    { day: "2026-10-14", job: "sync:full", calls: 7500 },
    { day: "2026-10-14", job: "app", calls: 12 },
    { day: "2026-10-13", job: "sync:incremental", calls: 40 },
  ]);
  expect(getMondayCallCounts(db, "2026-10-14")).toHaveLength(2);
});
