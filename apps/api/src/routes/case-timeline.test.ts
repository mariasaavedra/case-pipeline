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
import { loadBoardsConfig, loadTimelineConfig } from "@case-pipeline/config";
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
    loadBoards: () => loadBoardsConfig(resolve(import.meta.dirname, "../../../../config/boards.yaml")),
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

describe("GET /api/timeline/items/:localId (M29)", () => {
  const OUTCOMES = [{ index: 0, label: "Added on Cal", color: "#007eb5" }, { index: 1, label: "ATTENDED", color: "#00c875" }];

  function calendaringItem() {
    const col = db.prepare(
      `INSERT INTO board_columns (board_key, monday_board_id, column_id, title, type, options, position, updated_at)
       VALUES ('calendaring', '9287895872', ?, ?, ?, ?, ?, datetime('now'))`,
    );
    col.run("color_mkrjc7n8", "Calendaring Status", "status", JSON.stringify(OUTCOMES), 1);
    col.run("long_text_mkyx3p9a", "Quick note", "long_text", null, 2);
    col.run("color_mkrjp51q", "Type", "status", null, 3);
    col.run("date_mkrjnbth", "Hearing Date - Calendaring", "date", null, 4);
    col.run("text_unmapped", "Not in boards.yaml", "text", null, 5);
    col.run("button_mkyrajkp", "Notify", "button", null, 6);
    db.prepare(
      `INSERT INTO board_items (batch_id, local_id, board_key, name, status, monday_item_id, profile_local_id, column_values)
       VALUES (1, 'h1', 'calendaring', '[9/30/26] MASTER: Ana RIVERA', 'Added on Cal', '555', 'p1', ?)`,
    ).run(JSON.stringify({ status: { label: "Added on Cal" }, type: { label: "Master" }, hearing_date_calendaring: { date: "2026-09-30" } }));
  }

  it("lists the item's editable fields, the ones the timeline reads first, with their values", async () => {
    calendaringItem();
    const res = await fetch(`${base}/api/timeline/items/h1`);
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: import("./case-timeline.js").TimelineItem };
    expect(data).toMatchObject({ boardKey: "calendaring", boardName: "Calendaring", mondayBoardId: "9287895872", mondayItemId: "555", status: "Added on Cal" });
    expect(data.fields.map((f) => [f.key, f.value, f.primary])).toEqual([
      ["status", "Added on Cal", true],
      ["hearing_date_calendaring", "2026-09-30", true],
      ["calendaring_quick_note", "", true],
      ["type", "Master", false],
    ]);
    expect(data.fields[0]?.options.map((o) => o.label)).toEqual(["Added on Cal", "ATTENDED"]);
  });

  it("404 for an unknown or deleted item", async () => {
    expect((await fetch(`${base}/api/timeline/items/nope`)).status).toBe(404);
  });
});
