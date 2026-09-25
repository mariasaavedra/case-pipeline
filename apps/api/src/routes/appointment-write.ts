// =============================================================================
// Book a consult (appointment) for a client
// =============================================================================
// Unlike a Fee K, appointments have no single board: each attorney has their
// own, so choosing the attorney chooses the BOARD. The boards on offer are
// data/attorney-boards.json filtered by `acceptingConsults`, which is what makes
// onboarding an attorney a settings change rather than a release.
//
// All four appointment boards expose the same columns by title, so one title
// resolution serves every one of them — including a board duplicated in Monday
// for a new attorney, with no config entry beyond the JSON file.
//
// `planAppointmentWrite` is pure and holds every refusal, so the rules can be
// tested without a database, a network, or an Express app (see status-write.ts
// for the same shape).
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
import { getBoardColumnsFor } from "@case-pipeline/query";
import { fetchWorkspaceUsers, fetchBoardStructure } from "@case-pipeline/monday";
import type { CreateTimelineItemInput } from "@case-pipeline/monday";
import { FIRM_TIMEZONE } from "../firm.js";
import { randomUUID } from "node:crypto";
import { bookableBoards, type AttorneyBoard } from "../attorney-boards.js";

/** The client details we already hold and can spare someone retyping. */
export interface AppointmentProfile {
  monday_item_id: string | null;
  batch_id?: number;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  date_of_birth: string | null;
  place_of_birth: string | null;
  a_number: string | null;
}

/** Just the shape of a board's column schema that the planner reads. */
export interface AppointmentBoardSchema {
  mondayBoardId: string;
  columns: Array<{ columnId: string; title: string; type: string; options: Array<{ label: string }> }>;
}

export interface AppointmentInput {
  boardKey?: unknown;
  date?: unknown;
  time?: unknown;
  description?: unknown;
}

/** A board's groups, as Monday reports them. */
export interface BoardGroup {
  id: string;
  title: string;
}

/**
 * Where a consult belongs, derived from its date rather than asked for.
 *
 * Every appointment board carries the same three groups — Past Consults,
 * Upcoming, Today's consults — and every existing row carries BOTH a group and
 * a matching status. They are maintained in parallel, so booking sets both from
 * one rule instead of leaving half the board's conventions unfilled.
 *
 * Matching is case-insensitive on purpose. The same label is spelled
 * "Today's consult (1st Time)" on appointments_r and "(1st time)" on the other
 * three, so an exact-match lookup would silently fail for one attorney. The
 * board's own spelling is what gets written back.
 */
const TODAY_STATUS_RE = /^today's consult \(1st/i;
const UPCOMING_STATUS_RE = /^upcoming$/i;
const TODAY_GROUP_RE = /^today's consults?$/i;
const UPCOMING_GROUP_RE = /^upcoming$/i;

export interface AppointmentPlan {
  mondayBoardId: string;
  itemName: string;
  columnValues: Record<string, unknown>;
  /** The group to drop the item into, or null when the board has no matching one. */
  groupId: string | null;
  boardKey: string;
  date: string;
  time: string | null;
  /** The status actually written, or null when the board offers no match. */
  status: string | null;
  isToday: boolean;
  attorney: string;
  /** The line posted to the client's timeline as both a comment and an activity. */
  noteText: string;
}

export interface AppointmentRejection {
  status: number;
  error: string;
  allowed?: string[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

/**
 * "Oct 1, 2026" from a plain YYYY-MM-DD, without letting a timezone move it.
 *
 * The date is a calendar day off a date input, not an instant. Parsing it bare
 * and formatting in local time is how a consult on the 1st gets announced as
 * the 30th, so this pins noon UTC and formats in UTC — far from either edge.
 */
function formatConsultDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}

/** "14:30" → "2:30 PM". A wall-clock time on the board; no zone involved. */
function formatConsultTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const hour = h ?? 0;
  const suffix = hour < 12 ? "AM" : "PM";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${String(m ?? 0).padStart(2, "0")} ${suffix}`;
}

/**
 * What lands on the client's timeline when a consult is booked. One string,
 * used verbatim as both the monday comment and the E&A activity body, so the
 * two never drift apart.
 */
export function consultNoteText(opts: {
  date: string; time: string | null; attorney: string; description: string;
}): string {
  const when = opts.time ? `${formatConsultDate(opts.date)} at ${formatConsultTime(opts.time)}` : formatConsultDate(opts.date);
  const head = `Consult scheduled: ${when} with ${opts.attorney}`;
  return opts.description ? `${head}\nPurpose: ${opts.description}` : head;
}

/**
 * Turn a booking request into the exact Monday mutation, or the reason not to.
 *
 * `attorneyUserId` is resolved by the caller because it needs the network; null
 * simply leaves the people column unset, which is not a reason to refuse — the
 * board already identifies the attorney.
 */
export function planAppointmentWrite(
  input: AppointmentInput,
  opts: {
    board: AttorneyBoard;
    profile: AppointmentProfile;
    schema: AppointmentBoardSchema;
    groups: BoardGroup[];
    attorneyUserId: number | null;
    /** Today in FIRM_TIMEZONE as YYYY-MM-DD — never the container's UTC date. */
    today: string;
  },
): { plan: AppointmentPlan } | { rejection: AppointmentRejection } {
  const date = (input.date ?? "").toString().trim();
  const time = (input.time ?? "").toString().trim();
  const description = (input.description ?? "").toString().trim();

  if (!DATE_RE.test(date)) return { rejection: { status: 400, error: "date is required as YYYY-MM-DD" } };
  if (time && !TIME_RE.test(time)) return { rejection: { status: 400, error: "time must be HH:MM (24-hour)" } };

  const { board, profile, schema, groups, attorneyUserId, today } = opts;
  const isToday = date === today;
  const byTitle = (want: string, type?: string) =>
    schema.columns.find((c) => c.title.trim().toLowerCase() === want && (!type || c.type === type));

  const dateCol = byTitle("consult date", "date");
  if (!dateCol) {
    return { rejection: { status: 409, error: `Could not resolve the 'Consult Date' column on ${board.boardKey}` } };
  }

  // Monday takes date and time as separate keys; omitting time leaves it unset.
  const columnValues: Record<string, unknown> = {
    [dateCol.columnId]: time ? { date, time: `${time}:00` } : { date },
  };

  const descCol = byTitle("description", "long_text");
  if (descCol && description) columnValues[descCol.columnId] = description;

  // Status is derived, not asked for: a consult booked for today is today's
  // consult, anything later is upcoming. A board that offers neither label gets
  // no status rather than a refusal — the booking is what matters.
  const statusCol = byTitle("status", "status");
  const wantStatus = isToday ? TODAY_STATUS_RE : UPCOMING_STATUS_RE;
  const status = statusCol?.options.find((o) => wantStatus.test(o.label.trim()))?.label ?? null;
  if (statusCol && status) columnValues[statusCol.columnId] = { label: status };

  const wantGroup = isToday ? TODAY_GROUP_RE : UPCOMING_GROUP_RE;
  const groupId = groups.find((g) => wantGroup.test(g.title.trim()))?.id ?? null;

  // The relation the sync reads to attach an appointment to its client. Without
  // it the consult never reaches the 360 view — and since monday fixed timeline
  // links at creation time, a note logged on it later would not reach the
  // profile either (docs/monday-api-and-ea-reference.md §9).
  const profileCol = byTitle("profiles", "board_relation");
  if (profileCol && profile.monday_item_id) {
    columnValues[profileCol.columnId] = { item_ids: [Number(profile.monday_item_id)] };
  }

  const peopleCol = byTitle("attorney", "people");
  if (peopleCol && attorneyUserId != null) {
    columnValues[peopleCol.columnId] = { personsAndTeams: [{ id: attorneyUserId, kind: "person" }] };
  }

  const createdOnCol = byTitle("consult created on", "date");
  if (createdOnCol) columnValues[createdOnCol.columnId] = { date: today };

  // Details we already hold. These columns are otherwise typed by hand or filled
  // by Calendly, so booking from the 360 view is the one moment they come free —
  // and it keeps the consult from disagreeing with the profile it came from.
  const prefill: Array<[string, string | null]> = [
    ["phone", profile.phone],
    ["email", profile.email],
    ["address", profile.address],
    ["alien number", profile.a_number],
    ["date of birth", profile.date_of_birth],
    ["country of birth", profile.place_of_birth],
  ];
  for (const [title, value] of prefill) {
    const col = byTitle(title, "text");
    if (col && value) columnValues[col.columnId] = value;
  }

  return {
    plan: {
      mondayBoardId: schema.mondayBoardId,
      itemName: profile.name,
      columnValues,
      groupId,
      boardKey: board.boardKey,
      date,
      time: time || null,
      status,
      isToday,
      attorney: board.attorneyName ?? board.displayName,
      noteText: consultNoteText({
        date, time: time || null, attorney: board.attorneyName ?? board.displayName, description,
      }),
    },
  };
}

export interface AppointmentWriteDeps {
  db: DatabaseInstance;
  mondayApiToken: string | undefined;
  writeTokenOptions: WriteTokenOptions;
}

export function registerAppointmentWriteRoutes(app: Express, deps: AppointmentWriteDeps): void {
  const { db, mondayApiToken: MONDAY_API_TOKEN, writeTokenOptions } = deps;

  /**
   * "Consult note" — the firm's existing E&A activity type (queried from the
   * account, not invented). Reusing it avoids the trap of create_custom_activity
   * leaving staff with two identically-named entries in monday's picker, which
   * is what happened with Call Summary — see docs/decisions.md, 2026-08-25.
   */
  const CONSULT_NOTE_ACTIVITY_ID = "34b09f1c-3572-4590-85af-9635a09eddb8";

  /** Board groups by board id, cached — they change about never. */
  const groupCache = new Map<string, { groups: BoardGroup[]; at: number }>();
  const GROUPS_TTL_MS = 30 * 60 * 1000;
  async function groupsFor(mondayBoardId: string): Promise<BoardGroup[]> {
    const hit = groupCache.get(mondayBoardId);
    if (hit && Date.now() - hit.at < GROUPS_TTL_MS) return hit.groups;
    try {
      const board = await fetchBoardStructure(mondayBoardId);
      const groups = board.groups ?? [];
      groupCache.set(mondayBoardId, { groups, at: Date.now() });
      return groups;
    } catch (err) {
      // No groups means the item lands in the board's default group, which is
      // untidy but not wrong. Never worth failing a booking over.
      console.error("[appointments] could not read board groups:", err);
      return [];
    }
  }

  /** The staff directory, cached — filling a people column should not cost a round trip each time. */
  let staffCache: { users: Awaited<ReturnType<typeof fetchWorkspaceUsers>>; at: number } | null = null;
  const STAFF_TTL_MS = 10 * 60 * 1000;

  async function mondayUserIdFor(name: string | undefined): Promise<number | null> {
    if (!name) return null;
    try {
      const now = Date.now();
      if (!staffCache || now - staffCache.at > STAFF_TTL_MS) {
        staffCache = { users: await fetchWorkspaceUsers(MONDAY_API_TOKEN), at: now };
      }
      const wanted = name.trim().toLowerCase();
      const hit = staffCache.users.find((u) => u.name.trim().toLowerCase() === wanted);
      const id = hit ? Number(hit.id) : NaN;
      return Number.isFinite(id) ? id : null;
    } catch (err) {
      // A people column we cannot fill is not a reason to lose the consult —
      // the board already identifies the attorney.
      console.error("[appointments] could not resolve the attorney to a Monday user:", err);
      return null;
    }
  }

  // Who is currently taking consults. Read by the booking modal; deliberately
  // not admin-gated, since anyone who can book needs to see the list.
  app.get("/api/settings/bookable-boards", requireAuth, (_req, res) => {
    res.json({
      data: bookableBoards().map((b) => ({
        boardKey: b.boardKey,
        label: b.attorneyName ?? b.displayName,
        badge: b.displayName,
      })),
    });
  });

  app.post("/api/profiles/:localId/appointments", requireAuth, async (req, res) => {
    if (!MONDAY_API_TOKEN) {
      res.status(503).json({ error: "Monday.com write-back not configured" });
      return;
    }
    const localId = String(req.params.localId);
    const input = req.body as AppointmentInput;
    const boardKey = (input.boardKey ?? "").toString().trim();

    if (!boardKey) {
      res.status(400).json({ error: "boardKey is required (which attorney's board to book on)" });
      return;
    }
    const offered = bookableBoards();
    const board = offered.find((b) => b.boardKey === boardKey);
    if (!board) {
      res.status(400).json({ error: "That board is not accepting consults", allowed: offered.map((b) => b.boardKey) });
      return;
    }

    const profile = db
      .prepare(
        "SELECT monday_item_id, batch_id, name, email, phone, address, date_of_birth, place_of_birth, a_number FROM profiles WHERE local_id = ?",
      )
      .get(localId) as AppointmentProfile | null;
    if (!profile) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }

    const schema = getBoardColumnsFor(db, boardKey);
    if (!schema) {
      res.status(409).json({ error: `Column schema for ${boardKey} not synced yet — run a sync first` });
      return;
    }

    const outcomePlan = planAppointmentWrite(input, {
      board,
      profile,
      schema,
      groups: await groupsFor(schema.mondayBoardId),
      attorneyUserId: await mondayUserIdFor(board.attorneyName),
      // FIRM_TIMEZONE, not the container's UTC clock: after ~7pm Central the UTC
      // date is already tomorrow, which would mark a next-day consult as today's.
      today: new Date().toLocaleDateString("en-CA", { timeZone: FIRM_TIMEZONE }),
    });
    if ("rejection" in outcomePlan) {
      const { status, error, allowed } = outcomePlan.rejection;
      res.status(status).json(allowed ? { error, allowed } : { error });
      return;
    }
    const plan = outcomePlan.plan;

    const auditMeta = {
      boardKey: plan.boardKey,
      mondayBoardId: plan.mondayBoardId,
      date: plan.date,
      time: plan.time,
      status: plan.status,
      group: plan.groupId,
      isToday: plan.isToday,
      attorney: plan.attorney,
      name: plan.itemName,
    };

    /**
     * Announce the booking on the CLIENT'S timeline, as both a monday comment
     * and an E&A activity — the two places staff actually read.
     *
     * On the profile rather than the new consult item, deliberately. Since
     * monday fixed timeline links at creation time, a note written on the
     * consult would only reach whatever was connected at that instant, and the
     * 360 view reads the profile. Putting it there is the one placement that is
     * certain to be seen.
     *
     * Both are best-effort: the consult is already booked by the time these
     * run, so a monday hiccup queues them rather than failing the request.
     */
    const announce = async (): Promise<void> => {
      const mondayItemId = profile.monday_item_id;
      if (!mondayItemId) return;
      const author = req.user?.name ?? req.user?.preferred_username ?? "Staff";
      const now = new Date().toISOString();

      try {
        const posted = await withTokenFallback(
          (token) => dataSource.postUpdate(mondayItemId, plan.noteText, token),
          writeTokenOptions(req),
        );
        // Store it locally too, so the timeline shows it without waiting for a sync.
        db.prepare(`
          INSERT OR IGNORE INTO client_updates
            (batch_id, local_id, monday_update_id, profile_local_id, board_item_local_id,
             board_key, author_name, author_email, text_body, body_html, source_type,
             reply_to_update_id, created_at_source, sync_status)
          VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, NULL, 'update', NULL, ?, 'synced')
        `).run(
          profile.batch_id ?? null, randomUUID(), posted.result, localId,
          author, req.user?.email ?? null, plan.noteText, now,
        );
      } catch (err) {
        console.error("[write-back] consult update failed; queueing for retry:", err);
        enqueueWrite(db, {
          opType: "create_update", targetTable: "profiles", targetLocalId: localId,
          mondayItemId, authorOid: req.user?.oid ?? null,
          payload: { body: plan.noteText },
        });
      }

      const activity: CreateTimelineItemInput = {
        itemId: mondayItemId,
        title: `Consult scheduled — ${plan.date}`,
        customActivityId: CONSULT_NOTE_ACTIVITY_ID,
        content: plan.noteText,
      };
      try {
        await withTokenFallback((token) => dataSource.createTimelineItem(activity, token), writeTokenOptions(req));
      } catch (err) {
        console.error("[write-back] consult activity failed; queueing for retry:", err);
        enqueueWrite(db, {
          opType: "create_timeline_item", targetTable: "profiles", targetLocalId: localId,
          mondayItemId, authorOid: req.user?.oid ?? null, payload: { ...activity },
        });
      }
    };

    try {
      const result = await withTokenFallback(
        (token) =>
          dataSource.createItem(plan.mondayBoardId, plan.itemName, plan.columnValues, token, plan.groupId ?? undefined),
        writeTokenOptions(req),
      );
      auditFromReq(req, "monday.appointment_created", {
        targetType: "profile",
        targetId: localId,
        targetMondayId: profile.monday_item_id,
        metadata: {
          ...auditMeta,
          appointmentItemId: result.result,
          usedPersonalToken: result.usedPersonalToken,
          fellBackToSharedToken: result.fellBackToSharedToken,
        },
      });
      await announce();
      res.json({ data: { appointmentItemId: result.result, name: plan.itemName, pending: false } });
    } catch (err) {
      // Same rail as a note or a contract: an outage must not lose the booking.
      console.error("[write-back] appointment createItem failed; queueing for retry:", err);
      enqueueWrite(db, {
        opType: "create_item",
        targetTable: "profiles",
        targetLocalId: localId,
        mondayItemId: profile.monday_item_id,
        authorOid: req.user?.oid ?? null,
        payload: {
          boardId: plan.mondayBoardId, itemName: plan.itemName,
          columnValues: plan.columnValues, groupId: plan.groupId ?? undefined,
        },
      });
      auditFromReq(req, "monday.appointment_created", {
        targetType: "profile",
        targetId: localId,
        targetMondayId: profile.monday_item_id,
        metadata: { ...auditMeta, queued: true },
      });
      res.status(202).json({ data: { name: plan.itemName, pending: true } });
    }
  });
}
