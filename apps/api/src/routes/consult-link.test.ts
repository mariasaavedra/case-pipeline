// =============================================================================
// Consult link — pure rules + the route end to end (Monday mocked at dataSource)
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import Database from "better-sqlite3";
import { initializeSchema } from "@case-pipeline/seed/db/schema";

type Call = { boardId: string; itemId: string; columnId: string; value: unknown };
let calls: Call[] = [];
let mondayDown = false;

vi.mock("../data-source/index.js", () => ({
  dataSource: {
    setColumnValueJson: async (boardId: string, itemId: string, columnId: string, value: unknown) => {
      if (mondayDown) {
        const { NetworkError } = await import("@case-pipeline/monday");
        throw new NetworkError("Monday is down");
      }
      calls.push({ boardId, itemId, columnId, value });
    },
  },
}));
vi.mock("../auth/middleware.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as unknown as { user: unknown }).user = { oid: "oid-1", name: "Ana Reyes", email: "ana@example.com" };
    next();
  },
}));
vi.mock("../audit/log.js", () => ({ auditFromReq: () => {} }));

const { planConsultLink, registerConsultLinkRoutes } = await import("./consult-link.js");

describe("planConsultLink", () => {
  const appt = { boardKey: "appointments_m", mondayItemId: "901", profileLocalId: null };
  const profile = { localId: "p1", mondayItemId: "111", name: "Jorge ROMERO TORO" };

  it("writes the one profile into the Profiles column", () => {
    expect(planConsultLink(appt, profile, "connect_boards4__1")).toEqual({
      ok: true, noop: false, columnId: "connect_boards4__1", value: { item_ids: [111] },
    });
  });

  it("is a no-op when it is already linked to that profile", () => {
    expect(planConsultLink({ ...appt, profileLocalId: "p1" }, profile, "c")).toEqual({ ok: true, noop: true });
  });

  it("refuses to overwrite a link someone made since the page loaded", () => {
    expect(planConsultLink({ ...appt, profileLocalId: "p2" }, profile, "c")).toMatchObject({ ok: false, status: 409 });
  });

  it("refuses rows that are not appointments, and profiles Monday doesn't know yet", () => {
    expect(planConsultLink({ ...appt, boardKey: "call_log" }, profile, "c")).toMatchObject({ ok: false, status: 404 });
    expect(planConsultLink(undefined, profile, "c")).toMatchObject({ ok: false, status: 404 });
    expect(planConsultLink(appt, undefined, "c")).toMatchObject({ ok: false, status: 404 });
    expect(planConsultLink(appt, { ...profile, mondayItemId: null }, "c")).toMatchObject({ ok: false, status: 400 });
    expect(planConsultLink({ ...appt, mondayItemId: null }, profile, "c")).toMatchObject({ ok: false, status: 400 });
  });

  it("needs the Profiles column from the synced schema", () => {
    expect(planConsultLink(appt, profile, null)).toMatchObject({ ok: false, status: 409 });
  });
});

let db: Database.Database;
let server: Server;
let base: string;

function seed() {
  db.prepare("INSERT INTO seed_batches (id, batch_name) VALUES (1, 'test')").run();
  db.prepare(
    `INSERT INTO profiles (batch_id, local_id, monday_item_id, name) VALUES (1, 'p1', '111', 'Jorge H. ROMERO TORO')`,
  ).run();
  db.prepare(
    `INSERT INTO board_items (batch_id, local_id, monday_item_id, board_key, name, next_date, profile_local_id, column_values)
     VALUES (1, 'a1', '901', 'appointments_m', 'INITIAL TP MEETING : Jorge H. ROMERO TORO', '2026-10-09', NULL, ?)`,
  ).run(JSON.stringify({ description: "TP meeting" }));
  const col = db.prepare(
    "INSERT INTO board_columns (board_key, monday_board_id, column_id, title, type, position) VALUES (?, ?, ?, ?, ?, ?)",
  );
  col.run("appointments_m", "B-APPT", "link_to_jail_intakes_x", "link to Jail Intakes", "board_relation", 1);
  col.run("appointments_m", "B-APPT", "connect_boards4__1", "Profiles", "board_relation", 2);
}

async function link(profileLocalId: unknown) {
  const res = await fetch(`${base}/api/reception/consults/a1/profile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profileLocalId }),
  });
  return { status: res.status, json: (await res.json()) as { data?: Record<string, unknown>; error?: string } };
}

function row() {
  return db.prepare("SELECT profile_local_id, column_values FROM board_items WHERE local_id = 'a1'").get() as {
    profile_local_id: string | null;
    column_values: string;
  };
}

beforeEach(() => {
  calls = [];
  mondayDown = false;
  db = new Database(":memory:");
  initializeSchema(db);
  seed();
  const app = express();
  app.use(express.json());
  registerConsultLinkRoutes(app, { db, mondayApiToken: "shared", writeTokenOptions: () => ({ sharedToken: "shared" }) as never });
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(() => {
  server.close();
  db.close();
});

describe("POST /api/reception/consults/:localId/profile", () => {
  it("links the profile in Monday and locally", async () => {
    const r = await link("p1");
    expect(r.status).toBe(200);
    expect(r.json.data).toEqual({ profileLocalId: "p1", profileName: "Jorge H. ROMERO TORO", pending: false });
    expect(calls).toEqual([{ boardId: "B-APPT", itemId: "901", columnId: "connect_boards4__1", value: { item_ids: [111] } }]);
    const r2 = row();
    expect(r2.profile_local_id).toBe("p1");
    // Same shape the sync writes, other columns kept.
    expect(JSON.parse(r2.column_values)).toEqual({
      description: "TP meeting",
      profiles: { linked_item_ids: ["111"], display_value: "Jorge H. ROMERO TORO" },
    });
  });

  it("queues the write on an outage and still links locally", async () => {
    mondayDown = true;
    const r = await link("p1");
    expect(r.status).toBe(202);
    expect(r.json.data?.pending).toBe(true);
    const q = db.prepare("SELECT op_type, monday_item_id, payload FROM write_queue").all() as Array<{ op_type: string; monday_item_id: string; payload: string }>;
    expect(q).toHaveLength(1);
    expect(q[0]!.op_type).toBe("change_column_json");
    expect(JSON.parse(q[0]!.payload)).toEqual({ boardId: "B-APPT", columnId: "connect_boards4__1", value: { item_ids: [111] } });
    expect(row().profile_local_id).toBe("p1");
  });

  it("refuses a missing or unknown profile", async () => {
    expect((await link("")).status).toBe(400);
    expect((await link("nope")).status).toBe(404);
    expect(calls).toEqual([]);
  });
});
