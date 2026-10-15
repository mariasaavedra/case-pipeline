// =============================================================================
// P3.9 — GET /api/clients/:localId/timeline
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { initializeSchema } from "@case-pipeline/seed/db/schema";
import { loadTimelineConfig } from "@case-pipeline/config";
import type { CaseTimeline } from "@case-pipeline/query";

vi.mock("../auth/middleware.js", () => ({
  requireAuth: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

const { registerCaseTimelineRoutes } = await import("./case-timeline.js");

let db: Database.Database;
let server: Server;
let base: string;
let loads = 0;

beforeEach(async () => {
  db = new Database(":memory:");
  initializeSchema(db);
  db.prepare("INSERT INTO seed_batches (batch_name, seed_value, status) VALUES ('test', 1, 'complete')").run();
  db.prepare("INSERT INTO profiles (batch_id, local_id, name) VALUES (1, 'p1', 'Ana RIVERA')").run();
  db.prepare(
    `INSERT INTO board_items (batch_id, local_id, board_key, name, profile_local_id, column_values)
     VALUES (1, 'c1', 'court_cases', '[ORDERED REMOVED 9/11/26] - LB - Ana RIVERA', 'p1', ?)`,
  ).run(JSON.stringify({ nta_date: { date: "2021-06-22" } }));
  loads = 0;
  const app = express();
  registerCaseTimelineRoutes(app, {
    db,
    loadConfig: () => {
      loads++;
      return loadTimelineConfig(resolve(import.meta.dirname, "../../../../config/timeline.yaml"));
    },
    today: () => "2026-10-15",
  });
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => {
  server.close();
  db.close();
});

describe("GET /api/clients/:localId/timeline", () => {
  it("returns the client's milestones and summary", async () => {
    const res = await fetch(`${base}/api/clients/p1/timeline`);
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: CaseTimeline };
    expect(data.today).toBe("2026-10-15");
    expect(data.events.map((e) => e.label)).toEqual(["NTA issued", "Ordered Removed", "BIA appeal deadline (30 days)"]);
    expect(data.summary.attention[0]?.text).toContain("BIA appeal deadline");
  });

  it("404 for an unknown client; the config is read once", async () => {
    expect((await fetch(`${base}/api/clients/nope/timeline`)).status).toBe(404);
    await fetch(`${base}/api/clients/p1/timeline`);
    expect(loads).toBe(1);
  });
});
