// =============================================================================
// Slack queue routes — M18 step 2 + P17's Slack Queue tab
// =============================================================================
//   GET    /api/reception/consults/:localId/slack-draft  the drafted "Ready" message + time, or the one already queued
//   POST   /api/reception/consults/:localId/slack        queue it ({text, sendDate, sendTime}, firm time)
//   GET    /api/reception/slack-queue                    waiting + failed + sent today, with each consult's client / current time
//   PATCH  /api/reception/slack-queue/:id                edit words / time; a failed one goes back in the queue (Retry)
//   DELETE /api/reception/slack-queue/:id                take it out (soft delete)
//
// The draft comes from the latest saved prep (consult_preps.fields: interpreter,
// how to proceed, Zoom link) and the attorney's Slack member id on the staff
// roster: the person whose attorney board this is, else the appointment's
// Attorney by name. Where it posts = Settings → Integrations, "Consult ready".
// Everyone can use these (P17 is visible to everyone); every change is audited.
// The job that posts them is runSlackQueue (notify/slack-queue.ts, server.ts).
// =============================================================================

import type { Express } from "express";
import type BetterSqlite3 from "better-sqlite3";
type DatabaseInstance = BetterSqlite3.Database;
import { requireAuth } from "../auth/middleware.js";
import { auditFromReq } from "../audit/log.js";
import { loadAttorneyBoards } from "../attorney-boards.js";
import { makeStaffResolver } from "../staff/roster.js";
import { FIRM_TIMEZONE } from "../firm.js";
import { slackEventStatus } from "../notify/slack.js";
import { consultReadyText, parseQueueInput, utcToFirmTime, firmTimeToUtc } from "../notify/consult-ready.js";
import {
  deleteQueued, editQueued, getQueued, listQueue, queueConsultReady, queuedForAppointment, type SlackQueueRow,
} from "../notify/slack-queue.js";

export interface SlackQueueDeps {
  db: DatabaseInstance;
  usersDb: DatabaseInstance;
}

interface ApptRow {
  localId: string;
  mondayItemId: string | null;
  boardKey: string;
  name: string;
  date: string | null;
  time: string | null;
  attorney: string | null;
  profileName: string | null;
}

const APPT_SELECT = `
  SELECT bi.local_id AS localId, bi.monday_item_id AS mondayItemId, bi.board_key AS boardKey, bi.name,
         bi.next_date AS date, bi.next_time AS time, bi.attorney, p.name AS profileName
    FROM board_items bi
    LEFT JOIN profiles p ON p.local_id = bi.profile_local_id AND p.deleted_at IS NULL`;

/** The attorney's Slack member id: whoever owns the board on the roster, else the Attorney column by name. */
export function attorneySlackId(usersDb: DatabaseInstance, boardKey: string, attorney: string | null): string | null {
  const byBoard = usersDb
    .prepare("SELECT slack_user_id FROM staff WHERE attorney_board = ? AND active = 1 AND slack_user_id IS NOT NULL LIMIT 1")
    .get(boardKey) as { slack_user_id: string } | undefined;
  if (byBoard) return byBoard.slack_user_id;
  const person = makeStaffResolver(usersDb)(attorney);
  if (!person) return null;
  const row = usersDb.prepare("SELECT slack_user_id FROM staff WHERE id = ?").get(person.id) as { slack_user_id: string | null } | undefined;
  return row?.slack_user_id ?? null;
}

/** A queued row as the screens show it: firm-time fields to edit. */
function present(row: SlackQueueRow) {
  const at = utcToFirmTime(row.sendAt);
  return { ...row, sendDate: at.date, sendTime: at.time };
}

export function registerSlackQueueRoutes(app: Express, deps: SlackQueueDeps): void {
  const { db, usersDb } = deps;

  const findAppt = (localId: string): ApptRow | undefined =>
    db.prepare(`${APPT_SELECT} WHERE bi.local_id = ? AND bi.deleted_at IS NULL`).get(localId) as ApptRow | undefined;
  const badgeFor = (boardKey: string) => loadAttorneyBoards().find((b) => b.boardKey === boardKey)?.displayName ?? boardKey;
  const actor = (req: { user?: { name?: string; preferred_username?: string } }) =>
    req.user?.name ?? req.user?.preferred_username ?? "Staff";
  const slack = () => slackEventStatus("consult_ready");

  app.get("/api/reception/consults/:localId/slack-draft", requireAuth, (req, res) => {
    const appt = findAppt(String(req.params.localId));
    if (!appt || !appt.boardKey.startsWith("appointments") || !appt.mondayItemId) {
      res.status(404).json({ error: "Appointment not found" });
      return;
    }
    const existing = queuedForAppointment(usersDb, appt.mondayItemId);
    const prep = db
      .prepare("SELECT fields FROM consult_preps WHERE appointment_local_id = ? OR appointment_monday_id = ? ORDER BY id DESC LIMIT 1")
      .get(appt.localId, appt.mondayItemId) as { fields: string } | undefined;
    let fields: Record<string, unknown> = {};
    try { fields = prep ? (JSON.parse(prep.fields) as Record<string, unknown>) : {}; } catch { fields = {}; }
    const slackId = attorneySlackId(usersDb, appt.boardKey, appt.attorney);
    const text = consultReadyText({
      badge: badgeFor(appt.boardKey),
      time: appt.time,
      interpreter: (fields.interpreter as { need: string; language?: string | null } | undefined) ?? null,
      method: typeof fields.method === "string" ? fields.method : null,
      zoomLink: typeof fields.zoomLink === "string" ? fields.zoomLink : null,
      methodOther: typeof fields.methodOther === "string" ? fields.methodOther : null,
      attorneyName: appt.attorney,
      attorneySlackId: slackId,
    });
    const today = new Date().toLocaleDateString("en-CA", { timeZone: FIRM_TIMEZONE });
    res.json({
      data: {
        draft: { text, sendDate: appt.date ?? today, sendTime: appt.time ?? "09:00" },
        existing: existing ? present(existing) : null,
        attorney: appt.attorney,
        attorneyHasSlack: !!slackId,
        slack: slack(),
      },
    });
  });

  app.post("/api/reception/consults/:localId/slack", requireAuth, (req, res) => {
    const appt = findAppt(String(req.params.localId));
    if (!appt || !appt.boardKey.startsWith("appointments") || !appt.mondayItemId) {
      res.status(404).json({ error: "Appointment not found" });
      return;
    }
    const parsed = parseQueueInput(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    if (Date.parse(parsed.sendAt!) < Date.now() - 60_000) {
      res.status(400).json({ error: "That time has passed — pick a later one (or now)." });
      return;
    }
    const { row, replaced } = queueConsultReady(usersDb, {
      appointmentMondayId: appt.mondayItemId, boardKey: appt.boardKey,
      text: parsed.text!, sendAt: parsed.sendAt!, by: actor(req),
    });
    auditFromReq(req, replaced ? "slack_queue.edited" : "slack_queue.created", {
      targetType: "board_item", targetId: appt.localId, targetMondayId: appt.mondayItemId,
      metadata: { queueId: row.id, kind: row.kind, sendAt: row.sendAt },
    });
    res.json({ data: { queued: present(row), replaced, slack: slack() } });
  });

  app.get("/api/reception/slack-queue", requireAuth, (_req, res) => {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: FIRM_TIMEZONE });
    const rows = listQueue(usersDb, firmTimeToUtc(today, "00:00"));
    const ids = [...new Set(rows.map((r) => r.appointmentMondayId).filter((v): v is string => !!v))];
    const appts = new Map<string, ApptRow>();
    if (ids.length) {
      const found = db
        .prepare(`${APPT_SELECT} WHERE bi.monday_item_id IN (${ids.map(() => "?").join(",")}) AND bi.deleted_at IS NULL`)
        .all(...ids) as ApptRow[];
      for (const a of found) if (a.mondayItemId) appts.set(a.mondayItemId, a);
    }
    const boards = new Map(loadAttorneyBoards().map((b) => [b.boardKey, b.displayName]));
    res.json({
      data: {
        today,
        slack: slack(),
        messages: rows.map((r) => {
          const a = r.appointmentMondayId ? appts.get(r.appointmentMondayId) : undefined;
          return {
            ...present(r),
            badge: boards.get(a?.boardKey ?? r.boardKey ?? "") ?? r.boardKey,
            // The consult as it is NOW — the tab flags a time that moved after queueing.
            appointment: a
              ? { localId: a.localId, client: a.profileName ?? a.name, date: a.date, time: a.time, attorney: a.attorney }
              : null,
          };
        }),
      },
    });
  });

  app.patch("/api/reception/slack-queue/:id", requireAuth, (req, res) => {
    const id = Number(req.params.id);
    const before = Number.isInteger(id) ? getQueued(usersDb, id) : null;
    if (!before || before.status === "deleted") {
      res.status(404).json({ error: "Message not found" });
      return;
    }
    const parsed = parseQueueInput(req.body, { partial: true });
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const row = editQueued(usersDb, id, { text: parsed.text, sendAt: parsed.sendAt }, actor(req));
    if (!row) {
      res.status(409).json({ error: "Already sent — it can't be changed now." });
      return;
    }
    auditFromReq(req, before.status === "failed" ? "slack_queue.retried" : "slack_queue.edited", {
      targetType: "slack_queue", targetId: String(id), targetMondayId: row.appointmentMondayId ?? undefined,
      metadata: { textChanged: parsed.text !== undefined && parsed.text !== before.text, sendAt: row.sendAt },
    });
    res.json({ data: present(row) });
  });

  app.delete("/api/reception/slack-queue/:id", requireAuth, (req, res) => {
    const id = Number(req.params.id);
    const before = Number.isInteger(id) ? getQueued(usersDb, id) : null;
    if (!before || before.status === "deleted") {
      res.status(404).json({ error: "Message not found" });
      return;
    }
    if (!deleteQueued(usersDb, id, actor(req))) {
      res.status(409).json({ error: "Already sent — it can't be deleted now." });
      return;
    }
    auditFromReq(req, "slack_queue.deleted", {
      targetType: "slack_queue", targetId: String(id), targetMondayId: before.appointmentMondayId ?? undefined,
      metadata: { sendAt: before.sendAt, text: before.text },
    });
    res.json({ data: { deleted: true } });
  });
}
