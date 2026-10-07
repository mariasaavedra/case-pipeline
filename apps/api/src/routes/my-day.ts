// =============================================================================
// P4 My Day — one attorney's appointments for one day, and the consult note
// =============================================================================
// The attorney's working view: the day's appointments on ONE attorney board,
// each with what reception prepared (M18's consult_preps row), what the client
// wrote, the client's notes and file. Built from the two reads that already
// exist rather than a third copy of their SQL:
//
//   - getReceptionConsults (P17) — the row list, prep summary, Calendly
//     description, detention, deleted rows excluded, ordered by time;
//   - getAppointments (old P4) — profile, timeline updates, case summary.
//
// After the consult the attorney sets the status (the generic, validated
// PATCH /api/board-items/:localId/status) and writes a consult note, which is
// the one write this module owns: an Emails & Activities "Consult note" on the
// profile, which then starts the post-consult process — the Consultation
// Summary in the client's SharePoint folder (consult-summary.ts).
//
// Like the release note (detention-write.ts) the note is not mirrored into
// client_updates — the E&A sync dedupes on Monday's own fields, so a local copy
// would come back twice. It shows in Notes after the next sync.
// =============================================================================

import type { Express } from "express";
import type BetterSqlite3 from "better-sqlite3";
type DatabaseInstance = BetterSqlite3.Database;
import { requireAuth } from "../auth/middleware.js";
import { dataSource } from "../data-source/index.js";
import { withTokenFallback } from "../write-auth.js";
import type { WriteTokenOptions } from "../write-token.js";
import { enqueueWrite } from "../write-queue/processor.js";
import { auditFromReq } from "../audit/log.js";
import { currentUser } from "../db/user-context.js";
import { getAppointments } from "@case-pipeline/query";
import type { ClientCaseSummary, ClientUpdate, ProfileSummary } from "@case-pipeline/query";
import type { CreateTimelineItemInput } from "@case-pipeline/monday";
import { FIRM_TIMEZONE } from "../firm.js";
import { loadAttorneyBoards, type AttorneyBoard } from "../attorney-boards.js";
import { startConsultSummary, type SummaryRequest, type SummaryStart } from "../consult-summary.js";
import {
  getReceptionConsults,
  splitDescription,
  apptTypeLabel,
  interpreterLabel,
  CONSULT_NOTE_ACTIVITY_ID,
  type PrepBody,
} from "./reception.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Longest consult note accepted — the same bound as the release note. */
export const CONSULT_NOTE_MAX = 5000;

// =============================================================================
// Which board is "mine"
// =============================================================================

export interface MyBoardUser {
  attorney_board: string | null;
  name: string;
  monday_name: string | null;
}

/**
 * The board P4 opens on for this user: the board an admin linked them to, else
 * the board whose attorneyName is their name (Azure or Monday), else none.
 * Only active boards count — a link to a switched-off board is ignored.
 */
export function resolveMyBoard(user: MyBoardUser | null, boards: AttorneyBoard[]): string | null {
  if (!user) return null;
  const active = boards.filter((b) => b.active);
  const linked = user.attorney_board?.trim();
  if (linked && active.some((b) => b.boardKey === linked)) return linked;
  const names = [user.name, user.monday_name]
    .map((n) => n?.trim().toLowerCase())
    .filter((n): n is string => !!n);
  const byName = active.find((b) => b.attorneyName && names.includes(b.attorneyName.trim().toLowerCase()));
  return byName?.boardKey ?? null;
}

// =============================================================================
// The day
// =============================================================================

export interface MyDayPrep {
  at: string;
  author: string | null;
  pending: boolean;
  /** "1st time", "Detained appt — Chase Co. (KS)", "Other — …". */
  apptType: string;
  method: "Phone" | "Zoom" | "Other";
  /** The number, the Zoom link, or the "specify" text. */
  methodDetail: string | null;
  /** "Spanish — office (…)", "Not needed". */
  interpreter: string;
  interpreterNeeded: boolean;
  /** Reception's description. */
  description: string;
  documents: Array<{ name: string; url: string }>;
}

export interface MyDayEntry {
  localId: string;
  mondayItemId: string | null;
  boardKey: string;
  name: string;
  status: string | null;
  date: string | null;
  time: string | null;
  language: string | null;
  phone: string | null;
  /** A Calendly client's own words (the client's part of the Description). */
  clientWrote: string | null;
  /** The rest of the Description: reception's part, or all of it when not from Calendly. */
  description: string | null;
  detainedAt: string | null;
  /** Other consults for the same client that day (a likely double booking). */
  sameDayCount: number;
  prep: MyDayPrep | null;
  profile: ProfileSummary | null;
  updates: ClientUpdate[];
  caseSummary: ClientCaseSummary | null;
}

export interface MyDayResult {
  date: string;
  today: string;
  boardKey: string | null;
  myBoard: string | null;
  boards: Array<{ boardKey: string; displayName: string; attorneyName: string | null }>;
  entries: MyDayEntry[];
}

function parsePrep(fields: string | null): PrepBody | null {
  if (!fields) return null;
  try {
    const p = JSON.parse(fields) as PrepBody;
    return p && typeof p === "object" && p.apptType && p.method && p.interpreter ? p : null;
  } catch {
    return null;
  }
}

/** The appointments on one board for one day, earliest first. */
export function getMyDay(db: DatabaseInstance, boardKey: string, date: string, badge: string): MyDayEntry[] {
  const consults = getReceptionConsults(db, {
    from: date,
    to: date,
    boardKeys: [boardKey],
    boardBadges: new Map([[boardKey, badge]]),
  });
  if (consults.length === 0) return [];

  const enriched = new Map(
    getAppointments(db, { range: "day", date, boardKeys: [boardKey] }).entries.map((e) => [e.appointment.localId, e]),
  );

  const ids = consults.map((c) => c.localId);
  const prepRows = db
    .prepare(
      `SELECT cp.appointment_local_id AS apptId, cp.fields, cp.created_at AS at, cp.author_name AS author, cp.pending
         FROM consult_preps cp
        WHERE cp.id IN (SELECT MAX(id) FROM consult_preps
                         WHERE appointment_local_id IN (${ids.map(() => "?").join(",")})
                         GROUP BY appointment_local_id)`,
    )
    .all(...ids) as Array<{ apptId: string; fields: string; at: string; author: string | null; pending: number }>;
  const preps = new Map(prepRows.map((r) => [r.apptId, r]));

  return consults.map((c): MyDayEntry => {
    const e = enriched.get(c.localId);
    const row = preps.get(c.localId);
    const body = parsePrep(row?.fields ?? null);
    const desc = splitDescription(c.description);
    const prep: MyDayPrep | null = row && body
      ? {
          at: row.at,
          author: row.author,
          pending: row.pending === 1,
          apptType: apptTypeLabel(body),
          method: body.method,
          methodDetail: body.method === "Phone" ? body.phone : body.method === "Zoom" ? body.zoomLink : body.methodOther,
          interpreter: interpreterLabel(body),
          interpreterNeeded: body.interpreter.need !== "No",
          description: body.description,
          documents: Array.isArray(body.documents) ? body.documents : [],
        }
      : null;
    return {
      localId: c.localId,
      mondayItemId: c.mondayItemId,
      boardKey: c.boardKey,
      name: c.name,
      status: c.status,
      date: c.date,
      time: c.time,
      language: c.language,
      phone: c.phone ?? c.profile?.phone ?? null,
      clientWrote: c.fromCalendly ? desc.client || null : null,
      description: (c.fromCalendly ? desc.reception : desc.client) || null,
      detainedAt: c.detainedAt,
      sameDayCount: c.sameDayCount,
      prep,
      profile: e?.profile ?? null,
      updates: e?.updates ?? [],
      caseSummary: e?.caseSummary ?? null,
    };
  });
}

// =============================================================================
// Consult note
// =============================================================================

/** "Oct 7, 2026" — read as a calendar date, never shifted by a timezone. */
function formatDay(ymd: string): string {
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}

export type ConsultNoteBody = { ok: true; note: string } | { ok: false; error: string };

export function parseConsultNoteBody(raw: unknown): ConsultNoteBody {
  const body = (raw ?? {}) as Record<string, unknown>;
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (!note) return { ok: false, error: "note is required" };
  if (note.length > CONSULT_NOTE_MAX) return { ok: false, error: `note is too long (max ${CONSULT_NOTE_MAX} characters)` };
  return { ok: true, note };
}

/**
 * The E&A entry a consult note logs on the profile, under the firm's existing
 * "Consult note" activity type:
 *
 *   title:   Consult note — Oct 7, 2026
 *   content: <note>
 */
export function consultNoteActivity(note: string, consultDate: string | null): Omit<CreateTimelineItemInput, "itemId"> {
  return {
    title: consultDate && DATE_RE.test(consultDate) ? `Consult note — ${formatDay(consultDate)}` : "Consult note",
    customActivityId: CONSULT_NOTE_ACTIVITY_ID,
    content: note,
  };
}

// =============================================================================
// Routes
// =============================================================================

export interface MyDayDeps {
  db: DatabaseInstance;
  mondayApiToken: string | undefined;
  writeTokenOptions: WriteTokenOptions;
  /** The post-consult step (Consultation Summary); injected in tests. */
  startSummary?: (req: SummaryRequest) => SummaryStart;
}

export function registerMyDayRoutes(app: Express, deps: MyDayDeps): void {
  const { db, mondayApiToken: MONDAY_API_TOKEN, writeTokenOptions } = deps;
  const startSummary = deps.startSummary ?? startConsultSummary;

  // ?board= (defaults to the caller's own board, else the first active one)
  // and ?date= (YYYY-MM-DD, defaults to today in the firm's timezone).
  app.get("/api/my-day", requireAuth, (req, res) => {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: FIRM_TIMEZONE });
    const date = typeof req.query.date === "string" && DATE_RE.test(req.query.date) ? req.query.date : today;
    const active = loadAttorneyBoards().filter((b) => b.active);
    const myBoard = resolveMyBoard(currentUser(req) ?? null, active);
    const asked = typeof req.query.board === "string" ? req.query.board : "";
    const board = active.find((b) => b.boardKey === asked) ?? active.find((b) => b.boardKey === myBoard) ?? active[0] ?? null;
    const result: MyDayResult = {
      date,
      today,
      boardKey: board?.boardKey ?? null,
      myBoard,
      boards: active.map((b) => ({ boardKey: b.boardKey, displayName: b.displayName, attorneyName: b.attorneyName ?? null })),
      entries: board ? getMyDay(db, board.boardKey, date, board.displayName) : [],
    };
    res.json({ data: result });
  });

  app.post("/api/appointments/:localId/consult-note", requireAuth, async (req, res) => {
    if (!MONDAY_API_TOKEN) {
      res.status(503).json({ error: "Monday.com write-back not configured (MONDAY_API_TOKEN missing)" });
      return;
    }
    const parsed = parseConsultNoteBody(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const appt = db
      .prepare(
        `SELECT bi.local_id AS localId, bi.monday_item_id AS mondayItemId, bi.board_key AS boardKey,
                bi.next_date AS date, p.local_id AS profileLocalId, p.monday_item_id AS profileMondayId
           FROM board_items bi
           LEFT JOIN profiles p ON p.local_id = bi.profile_local_id AND p.deleted_at IS NULL
          WHERE bi.local_id = ? AND bi.deleted_at IS NULL`,
      )
      .get(String(req.params.localId)) as
      | { localId: string; mondayItemId: string | null; boardKey: string; date: string | null; profileLocalId: string | null; profileMondayId: string | null }
      | undefined;
    if (!appt || !appt.boardKey.startsWith("appointments_")) {
      res.status(404).json({ error: "Appointment not found" });
      return;
    }
    if (!appt.profileLocalId || !appt.profileMondayId) {
      res.status(409).json({ error: "This appointment isn't linked to a client profile in Monday, so the note has nowhere to go." });
      return;
    }
    const profileMondayId = appt.profileMondayId;

    const input: CreateTimelineItemInput = { ...consultNoteActivity(parsed.note, appt.date), itemId: profileMondayId };
    let pending = false;
    try {
      await withTokenFallback((token) => dataSource.createTimelineItem(input, token), writeTokenOptions(req));
    } catch (err) {
      console.error("[write-back] consult note failed; queueing for retry:", err);
      pending = true;
      enqueueWrite(db, {
        opType: "create_timeline_item", targetTable: "profiles", targetLocalId: appt.profileLocalId,
        mondayItemId: profileMondayId, authorOid: req.user?.oid ?? null, payload: { ...input },
      });
    }

    // The post-consult process: the Consultation Summary, with this note, into
    // the client's CONSULT folder — now rather than at the next sweep. The note
    // is saved either way; a failure to start is logged, never the request's.
    let summary: SummaryStart | "failed" = "failed";
    try {
      summary = startSummary({
        appointmentLocalId: appt.localId,
        note: parsed.note,
        author: req.user?.name ?? null,
        date: new Date().toLocaleDateString("en-CA", { timeZone: FIRM_TIMEZONE }),
      });
    } catch (err) {
      console.error("[consult] Could not start the Consultation Summary:", err);
    }

    auditFromReq(req, "monday.consult_note_posted", {
      targetType: "profile", targetId: appt.profileLocalId, targetMondayId: profileMondayId,
      metadata: { appointment: appt.mondayItemId, boardKey: appt.boardKey, length: parsed.note.length, queued: pending, summary },
    });
    res.status(pending ? 202 : 200).json({ data: { posted: true, pending, summary } });
  });
}
