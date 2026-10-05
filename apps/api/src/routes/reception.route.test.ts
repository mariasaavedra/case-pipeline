// =============================================================================
// Reception prep route — end to end with Monday mocked at the dataSource seam
// =============================================================================
// The pure rules are in reception.test.ts. This drives POST …/prep through a
// real Express app and SQLite, to prove the writes that actually go out: two
// updates (profile + appointment), the pin, the E&A entry, the write-backs —
// and that an outage queues instead of losing the note.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import Database from "better-sqlite3";
import { initializeSchema } from "@case-pipeline/seed/db/schema";

type Call = { op: string; [k: string]: unknown };
let calls: Call[] = [];
let failUpdates = false;
/** "refuse": Monday rejects a blank title (non-retryable); "down": an outage. */
let activityMode: "ok" | "refuse" | "down" = "ok";

vi.mock("../data-source/index.js", () => ({
  dataSource: {
    postUpdate: async (itemId: string, body: string) => {
      if (failUpdates) throw new Error("Monday is down");
      calls.push({ op: "update", itemId, body });
      return `upd-${itemId}`;
    },
    pinUpdate: async (updateId: string, itemId: string) => {
      calls.push({ op: "pin", updateId, itemId });
    },
    createTimelineItem: async (input: { itemId: string; title: string; customActivityId: string; content?: string }) => {
      const { MondayApiError, NetworkError } = await import("@case-pipeline/monday");
      if (activityMode === "down") throw new NetworkError("Monday is down");
      if (activityMode === "refuse" && input.title === "") throw new MondayApiError("title must not be blank", 200, false);
      calls.push({ op: "activity", ...input });
      return "tl-1";
    },
    setColumnValue: async (boardId: string, itemId: string, columnId: string, value: string) => {
      calls.push({ op: "column", boardId, itemId, columnId, value });
    },
    addFile: async (itemId: string, columnId: string, fileName: string, bytes: Uint8Array, contentType: string) => {
      calls.push({ op: "file", itemId, columnId, fileName, bytes: bytes.length, contentType });
      return "asset-1";
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
vi.mock("@case-pipeline/monday", async (orig) => ({
  ...(await orig<typeof import("@case-pipeline/monday")>()),
  // The account has no "Consult Prep Note" yet → falls back to Consult note.
  fetchCustomActivities: async () => new Map([["other-id", "Casenote"]]),
}));

const { registerReceptionRoutes, CONSULT_NOTE_ACTIVITY_ID, PREP_TITLE_FALLBACK } = await import("./reception.js");

let db: Database.Database;
let server: Server;
let base: string;

function seed(profileRaw: Record<string, unknown> = {}) {
  db.prepare("INSERT INTO seed_batches (id, batch_name) VALUES (1, 'test')").run();
  db.prepare(
    `INSERT INTO profiles (batch_id, local_id, monday_item_id, name, phone, raw_column_values)
     VALUES (1, 'p1', '111', 'Shad Kreiger', '639 099 8178', ?)`,
  ).run(JSON.stringify(profileRaw));
  db.prepare(
    `INSERT INTO board_items (batch_id, local_id, monday_item_id, board_key, name, next_date, next_time, attorney, profile_local_id, column_values)
     VALUES (1, 'a1', '901', 'appointments_m', 'Shad Kreiger', '2026-10-02', '14:00', 'Michael', 'p1', ?)`,
  ).run(JSON.stringify({ description: "Old description" }));
  const col = db.prepare(
    "INSERT INTO board_columns (board_key, monday_board_id, column_id, title, type, position) VALUES (?, ?, ?, ?, ?, ?)",
  );
  col.run("profiles", "B-PROF", "phone7__1", "Phone", "text", 1);
  col.run("profiles", "B-PROF", "e_file__1", "E-File", "text", 2);
  col.run("profiles", "B-PROF", "text_mkxphk77", "Consult File", "text", 3);
  col.run("appointments_m", "B-APPT", "long_text", "Description", "long_text", 1);
}

async function prep(body: Record<string, unknown>) {
  const res = await fetch(`${base}/api/reception/consults/a1/prep`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ interpreter: { need: "No" }, ...body }),
  });
  return { status: res.status, json: (await res.json()) as { data?: Record<string, unknown>; error?: string } };
}

beforeEach(async () => {
  calls = [];
  failUpdates = false;
  activityMode = "ok";
  db = new Database(":memory:");
  initializeSchema(db);
  const app = express();
  app.use(express.json());
  registerReceptionRoutes(app, { db, mondayApiToken: "shared", writeTokenOptions: () => ({ sharedToken: "shared" }) as never });
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(() => {
  server.close();
  db.close();
});

const consultFolder = "https://sharmacrawford.sharepoint.com/sites/scalconsults/Shared%20Documents/2026%20Consults/K/KREIGER,%20Shad";

describe("POST /api/reception/consults/:localId/prep", () => {
  it("posts the note three ways, pins it on the appointment, and writes back the edits", async () => {
    seed();
    const r = await prep({
      apptType: "1st time", method: "Phone", phone: "816 555 0000", description: "New description",
      folderLinks: [{ kind: "consult_file", url: consultFolder }],
    });
    expect(r.status).toBe(200);
    expect(r.json.data).toEqual({ prepped: true, pending: false, wroteBack: ["phone", "description", "consult_file"] });

    const ops = calls.map((c) => `${c.op}:${(c.itemId as string | undefined) ?? (c.updateId as string)}`);
    expect(ops).toEqual([
      "update:111",          // profile
      "update:901",          // appointment…
      "pin:901",             // …pinned
      "activity:111",        // E&A on the profile
      "column:111", "column:901", "column:111",
    ]);
    // The pin targets the update just posted on the appointment, not the profile's.
    expect(calls.find((c) => c.op === "pin")).toEqual({ op: "pin", updateId: "upd-901", itemId: "901" });
    const activity = calls.find((c) => c.op === "activity")!;
    expect(activity.customActivityId).toBe(CONSULT_NOTE_ACTIVITY_ID);
    // No title, like staff's own entries; HTML content so the folder is a named link.
    expect(activity.title).toBe("");
    expect(String(activity.content)).toContain(`<a href="${consultFolder}" target="_blank" rel="noopener noreferrer">Consult folder</a>`);
    expect(String(activity.content)).not.toMatch(/Consult prep|Prepared by/);

    const columns = calls.filter((c) => c.op === "column").map((c) => [c.boardId, c.columnId, c.value]);
    expect(columns).toEqual([
      ["B-PROF", "phone7__1", "816 555 0000"],
      ["B-APPT", "long_text", "New description"],
      ["B-PROF", "text_mkxphk77", consultFolder],
    ]);

    // Local mirror + the Prepped mark.
    const p = db.prepare("SELECT phone, json_extract(raw_column_values, '$.consult_file') AS cf FROM profiles").get() as { phone: string; cf: string };
    expect(p).toEqual({ phone: "816 555 0000", cf: consultFolder });
    expect(db.prepare("SELECT appt_type, method, pending FROM consult_preps").get()).toEqual({ appt_type: "1st time", method: "Phone", pending: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM client_updates WHERE profile_local_id = 'p1'").get()).toEqual({ n: 1 });
  });

  it("never overwrites a folder link the profile already has", async () => {
    seed({ consult_file: "https://sharmacrawford.sharepoint.com/already/there" });
    const r = await prep({ apptType: "1st time", method: "Zoom", zoomLink: "https://zoom.us/j/1", folderLinks: [{ kind: "consult_file", url: consultFolder }] });
    expect(r.json.data?.wroteBack).toEqual([]);
    expect(calls.some((c) => c.op === "column")).toBe(false);
  });

  it("queues the notes when Monday is down, and still marks the consult prepped", async () => {
    seed();
    failUpdates = true;
    const r = await prep({ apptType: "Trial Prep", method: "Other", methodOther: "In person" });
    expect(r.status).toBe(202);
    expect(r.json.data?.pending).toBe(true);
    const queued = db.prepare("SELECT op_type, monday_item_id FROM write_queue ORDER BY id").all();
    expect(queued).toEqual([
      { op_type: "create_update", monday_item_id: "111" },
      { op_type: "create_update", monday_item_id: "901" },
    ]);
    expect(db.prepare("SELECT pending FROM consult_preps").get()).toEqual({ pending: 1 });
  });

  it("retries the E&A entry once with a title when Monday refuses a blank one", async () => {
    seed();
    activityMode = "refuse";
    const r = await prep({ apptType: "1st time", method: "Phone", phone: "639 099 8178" });
    expect(r.status).toBe(200);
    const activities = calls.filter((c) => c.op === "activity");
    expect(activities.map((a) => a.title)).toEqual([PREP_TITLE_FALLBACK]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM write_queue").get()).toEqual({ n: 0 });
  });

  it("queues the E&A entry with a title when Monday is down", async () => {
    seed();
    activityMode = "down";
    const r = await prep({ apptType: "1st time", method: "Phone", phone: "639 099 8178" });
    expect(r.status).toBe(202);
    const row = db.prepare("SELECT op_type, payload FROM write_queue").get() as { op_type: string; payload: string };
    expect(row.op_type).toBe("create_timeline_item");
    expect(JSON.parse(row.payload).title).toBe(PREP_TITLE_FALLBACK);
  });

  it("refuses an appointment with no linked profile", async () => {
    seed();
    db.prepare("UPDATE board_items SET profile_local_id = NULL").run();
    const r = await prep({ apptType: "1st time", method: "Phone", phone: "816 555 0000" });
    expect(r.status).toBe(409);
    expect(calls).toEqual([]);
  });
});

describe("POST /api/reception/consults/:localId/files", () => {
  it("copies the file into the APPOINTMENT's Files column, found by title on its board", async () => {
    seed();
    db.prepare("INSERT INTO board_columns (board_key, monday_board_id, column_id, title, type, position) VALUES (?, ?, ?, ?, ?, ?)")
      .run("appointments_m", "B-APPT", "file_mm7raex5", "Files", "file", 2);
    const res = await fetch(`${base}/api/reception/consults/a1/files?name=Passport.pdf&type=application/pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: new Uint8Array([1, 2, 3]),
    });
    expect(res.status).toBe(200);
    expect(calls).toEqual([
      { op: "file", itemId: "901", columnId: "file_mm7raex5", fileName: "Passport.pdf", bytes: 3, contentType: "application/pdf" },
    ]);
  });

  it("says so when the appointment's board has no Files column synced", async () => {
    seed();
    const res = await fetch(`${base}/api/reception/consults/a1/files?name=x.pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: new Uint8Array([1]),
    });
    expect(res.status).toBe(409);
    expect(calls).toEqual([]);
  });
});
