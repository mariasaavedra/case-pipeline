// =============================================================================
// P4 My Day — which board is "mine", the day's read, and the consult note
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import Database from "better-sqlite3";
import { initializeSchema } from "@case-pipeline/seed/db/schema";

type Call = { op: string; [k: string]: unknown };
let calls: Call[] = [];
let down = false;

vi.mock("../data-source/index.js", () => ({
  dataSource: {
    createTimelineItem: async (input: { itemId: string; title: string; customActivityId: string; content?: string }) => {
      const { NetworkError } = await import("@case-pipeline/monday");
      if (down) throw new NetworkError("Monday is down");
      calls.push({ op: "activity", ...input });
      return "tl-1";
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

const {
  resolveMyBoard, getMyDay, parseConsultNoteBody, consultNoteActivity, registerMyDayRoutes, CONSULT_NOTE_MAX,
} = await import("./my-day.js");
const { CONSULT_NOTE_ACTIVITY_ID } = await import("./reception.js");

const BOARDS = [
  { boardKey: "appointments_r", mondayBoardId: "1", displayName: "R", attorneyName: "Rekha Sharma-Crawford", active: true },
  { boardKey: "appointments_m", mondayBoardId: "2", displayName: "M", attorneyName: "Michael Sharma-Crawford", active: true },
  { boardKey: "appointments_old", mondayBoardId: "3", displayName: "O", attorneyName: "Old Attorney", active: false },
];

describe("resolveMyBoard", () => {
  const user = (over: Partial<{ attorney_board: string | null; name: string; monday_name: string | null }> = {}) => ({
    attorney_board: null, name: "Someone Else", monday_name: null, ...over,
  });

  it("uses the board an admin linked", () => {
    expect(resolveMyBoard(user({ attorney_board: "appointments_m" }), BOARDS)).toBe("appointments_m");
  });
  it("ignores a link to a switched-off or unknown board and falls back to the name", () => {
    expect(resolveMyBoard(user({ attorney_board: "appointments_old", name: "Old Attorney" }), BOARDS)).toBeNull();
    expect(resolveMyBoard(user({ attorney_board: "nope", name: "michael sharma-crawford" }), BOARDS)).toBe("appointments_m");
  });
  it("matches the Monday name too", () => {
    expect(resolveMyBoard(user({ monday_name: "Rekha Sharma-Crawford" }), BOARDS)).toBe("appointments_r");
  });
  it("is null for staff who are not attorneys, and for no user", () => {
    expect(resolveMyBoard(user(), BOARDS)).toBeNull();
    expect(resolveMyBoard(null, BOARDS)).toBeNull();
  });
});

describe("consult note body + activity", () => {
  it("requires a note and bounds its length", () => {
    expect(parseConsultNoteBody({ note: "  " })).toEqual({ ok: false, error: "note is required" });
    expect(parseConsultNoteBody({ note: "x".repeat(CONSULT_NOTE_MAX + 1) }).ok).toBe(false);
    expect(parseConsultNoteBody({ note: " Hired, I-130 next. " })).toEqual({ ok: true, note: "Hired, I-130 next." });
  });
  it("logs under Consult note, titled with the consult's date", () => {
    expect(consultNoteActivity("Hired.", "2026-10-07")).toEqual({
      title: "Consult note — Oct 7, 2026", customActivityId: CONSULT_NOTE_ACTIVITY_ID, content: "Hired.",
    });
    expect(consultNoteActivity("Hired.", null).title).toBe("Consult note");
  });
});

let db: Database.Database;

function seed() {
  db.prepare("INSERT INTO seed_batches (id, batch_name) VALUES (1, 'test')").run();
  db.prepare(
    `INSERT INTO profiles (batch_id, local_id, monday_item_id, name, phone, raw_column_values)
     VALUES (1, 'p1', '111', 'Ana Ferreira', '555 640 7723', ?)`,
  ).run(JSON.stringify({ consult_file: "https://sp.example/consult/ferreira" }));
  const appt = db.prepare(
    `INSERT INTO board_items (batch_id, local_id, monday_item_id, board_key, name, status, next_date, next_time, profile_local_id, column_values)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  appt.run("a2", "902", "appointments_m", "Later client", null, "2026-10-07", "15:00", null, JSON.stringify({}));
  appt.run("a1", "901", "appointments_m", "Ana Ferreira", "Upcoming", "2026-10-07", "11:30", "p1",
    JSON.stringify({ calendly: "Yes", description: "Me llegó una carta de la corte.\n\nReception: NTA received last week." }));
  appt.run("a3", "903", "appointments_r", "Other board", null, "2026-10-07", "09:00", null, JSON.stringify({}));
  appt.run("a4", "904", "appointments_m", "Tomorrow", null, "2026-10-08", "09:00", null, JSON.stringify({}));
  const prep = db.prepare(
    `INSERT INTO consult_preps (appointment_local_id, appointment_monday_id, profile_local_id, appt_type, method, fields, note_text, author_name, pending)
     VALUES ('a1', '901', 'p1', ?, ?, ?, '', ?, 0)`,
  );
  const body = {
    apptType: "1st time", apptTypeOther: null, detainedAt: null, method: "Phone", phone: "555 640 7723", zoomLink: null,
    methodOther: null, interpreter: { need: "Spanish" }, description: "NTA received last week.", clientWrote: null,
    documents: [{ name: "Notice to Appear.pdf", url: "https://sp.example/nta.pdf" }], folderLinks: [],
  };
  prep.run("Standard Follow up", "Zoom", JSON.stringify({ ...body, apptType: "Standard Follow up", method: "Zoom", zoomLink: "z" }), "Old prep");
  prep.run("1st time", "Phone", JSON.stringify(body), "Karla");
}

describe("getMyDay", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    initializeSchema(db);
    seed();
  });
  afterEach(() => db.close());

  it("lists one board's appointments for one day, earliest first", () => {
    const day = getMyDay(db, "appointments_m", "2026-10-07", "M");
    expect(day.map((e) => e.localId)).toEqual(["a1", "a2"]);
  });

  it("carries the latest prep, the client's words and reception's part apart", () => {
    const [ana] = getMyDay(db, "appointments_m", "2026-10-07", "M");
    expect(ana!.prep).toMatchObject({
      author: "Karla", apptType: "1st time", method: "Phone", methodDetail: "555 640 7723", interpreterNeeded: true,
      description: "NTA received last week.", documents: [{ name: "Notice to Appear.pdf", url: "https://sp.example/nta.pdf" }],
    });
    expect(ana!.prep!.interpreter).toMatch(/^Spanish — /);
    expect(ana!.clientWrote).toBe("Me llegó una carta de la corte.");
    expect(ana!.description).toBe("NTA received last week.");
    expect(ana!.profile?.consultFile).toBe("https://sp.example/consult/ferreira");
  });

  it("has no prep and no profile where there is none", () => {
    const later = getMyDay(db, "appointments_m", "2026-10-07", "M")[1]!;
    expect(later.prep).toBeNull();
    expect(later.profile).toBeNull();
    expect(later.updates).toEqual([]);
  });
});

describe("POST /api/appointments/:localId/consult-note", () => {
  let server: Server;
  let base: string;
  let summaries: Array<{ appointmentLocalId: string; note: string; author: string | null }> = [];
  let summaryResult: "started" | "disabled" | "throw" = "started";

  beforeEach(async () => {
    calls = [];
    down = false;
    summaries = [];
    summaryResult = "started";
    db = new Database(":memory:");
    initializeSchema(db);
    seed();
    const app = express();
    app.use(express.json());
    registerMyDayRoutes(app, {
      db, mondayApiToken: "tok", writeTokenOptions: () => ({ sharedToken: "tok" }) as never,
      startSummary: (r) => {
        if (summaryResult === "throw") throw new Error("spawn failed");
        summaries.push({ appointmentLocalId: r.appointmentLocalId, note: r.note, author: r.author });
        return summaryResult;
      },
    });
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(() => {
    server.close();
    db.close();
  });

  const post = (id: string, body: unknown) =>
    fetch(`${base}/api/appointments/${id}/consult-note`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });

  it("logs a Consult note on the client's profile", async () => {
    const res = await post("a1", { note: "Hired for removal defense." });
    expect(res.status).toBe(200);
    expect(calls).toEqual([{
      op: "activity", itemId: "111", title: "Consult note — Oct 7, 2026",
      customActivityId: CONSULT_NOTE_ACTIVITY_ID, content: "Hired for removal defense.",
    }]);
  });

  it("queues the note when Monday is down", async () => {
    down = true;
    const res = await post("a1", { note: "Hired." });
    expect(res.status).toBe(202);
    const q = db.prepare("SELECT op_type, mondayItemId FROM (SELECT op_type, monday_item_id AS mondayItemId FROM write_queue)").all();
    expect(q).toEqual([{ op_type: "create_timeline_item", mondayItemId: "111" }]);
  });

  it("refuses an appointment with no linked profile, and anything that is not an appointment", async () => {
    expect((await post("a2", { note: "x" })).status).toBe(409);
    expect((await post("nope", { note: "x" })).status).toBe(404);
    expect((await post("a1", { note: "" })).status).toBe(400);
    expect(calls).toEqual([]);
    expect(summaries).toEqual([]);
  });

  it("starts the post-consult process (Consultation Summary) with the note just written", async () => {
    const res = await post("a1", { note: "Hired for removal defense." });
    expect((await res.json()).data).toEqual({ posted: true, pending: false, summary: "started" });
    expect(summaries).toEqual([{ appointmentLocalId: "a1", note: "Hired for removal defense.", author: "Ana Reyes" }]);
  });

  it("starts it even when the note had to be queued — the summary carries its own copy", async () => {
    down = true;
    await post("a1", { note: "Hired." });
    expect(summaries).toHaveLength(1);
  });

  it("says so when the server has the summary switched off, and never fails the note over it", async () => {
    summaryResult = "disabled";
    expect((await (await post("a1", { note: "x" })).json()).data.summary).toBe("disabled");
    summaryResult = "throw";
    const res = await post("a1", { note: "x" });
    expect(res.status).toBe(200);
    expect((await res.json()).data.summary).toBe("failed");
  });
});
