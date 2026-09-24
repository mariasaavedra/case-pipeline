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
import { fetchWorkspaceUsers } from "@case-pipeline/monday";
import { bookableBoards, type AttorneyBoard } from "../attorney-boards.js";

/** The client details we already hold and can spare someone retyping. */
export interface AppointmentProfile {
  monday_item_id: string | null;
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
  status?: unknown;
}

export interface AppointmentPlan {
  mondayBoardId: string;
  itemName: string;
  columnValues: Record<string, unknown>;
  boardKey: string;
  date: string;
  time: string | null;
  status: string;
  attorney: string;
}

export interface AppointmentRejection {
  status: number;
  error: string;
  allowed?: string[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

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
    attorneyUserId: number | null;
    today: string;
  },
): { plan: AppointmentPlan } | { rejection: AppointmentRejection } {
  const date = (input.date ?? "").toString().trim();
  const time = (input.time ?? "").toString().trim();
  const description = (input.description ?? "").toString().trim();
  const status = (input.status ?? "Upcoming").toString().trim();

  if (!DATE_RE.test(date)) return { rejection: { status: 400, error: "date is required as YYYY-MM-DD" } };
  if (time && !TIME_RE.test(time)) return { rejection: { status: 400, error: "time must be HH:MM (24-hour)" } };

  const { board, profile, schema, attorneyUserId, today } = opts;
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

  const statusCol = byTitle("status", "status");
  if (statusCol && status) {
    if (statusCol.options.length > 0 && !statusCol.options.some((o) => o.label === status)) {
      return {
        rejection: { status: 400, error: "status is not a valid option", allowed: statusCol.options.map((o) => o.label) },
      };
    }
    columnValues[statusCol.columnId] = { label: status };
  }

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
      boardKey: board.boardKey,
      date,
      time: time || null,
      status,
      attorney: board.attorneyName ?? board.displayName,
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
        "SELECT monday_item_id, name, email, phone, address, date_of_birth, place_of_birth, a_number FROM profiles WHERE local_id = ?",
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
      attorneyUserId: await mondayUserIdFor(board.attorneyName),
      today: new Date().toISOString().slice(0, 10),
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
      attorney: plan.attorney,
      name: plan.itemName,
    };

    try {
      const result = await withTokenFallback(
        (token) => dataSource.createItem(plan.mondayBoardId, plan.itemName, plan.columnValues, token),
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
        payload: { boardId: plan.mondayBoardId, itemName: plan.itemName, columnValues: plan.columnValues },
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
