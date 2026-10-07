// =============================================================================
// Create a jail intake
// =============================================================================
// A detainee enquiry, captured at first contact. The board carries 95 columns —
// the full intake questionnaire — and nobody fills that in on a phone call, so
// this writes the handful that are actually known when the phone rings and
// leaves the rest for monday.
//
// Columns are resolved from config/boards.yaml BY ID, not by title, which
// matters more here than anywhere else: the board has three near-identical
// POC-name columns, including "POC Name and relationship with detained:" and
// "POC Name and relationship with detained: 1". The query layer reads the
// config's `poc_name_and_relationship_with_detained` (text_mkkgcg74), so a
// title-based write would land in a different column and the contact would come
// back blank on the board we just built.
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
import { fetchBoardStructure, fetchItem } from "@case-pipeline/monday";
import type { CreateTimelineItemInput } from "@case-pipeline/monday";
import { getJailIntakeNotes, getBoardColumnsFor } from "@case-pipeline/query";
import { loadBoardsConfig } from "@case-pipeline/config";
import { FIRM_TIMEZONE, mondayDateTime } from "../firm.js";
import { bookableBoards } from "../attorney-boards.js";

const BOARD_KEY = "_fa_jail_intakes";

/** The board stores this one as a real date, so it is validated as one. */
const DATE_RE_ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Where a new lead belongs — the board's non-scheduled group. */
const INTAKE_GROUP_TITLE = "Jail Intakes";

/** A lead starts here unless the caller is already further along. */
const INITIAL_STATUS = "New Detainee";

/**
 * The statuses a NEW intake may be created in (M2 / M8), spelled as the board
 * spells them. A payment link is often sent on the very call that creates the
 * intake, so that one is offered too; everything later in the funnel is set
 * from M9 or the board, not at creation.
 */
export const INTAKE_CREATE_STATUSES = [INITIAL_STATUS, "Payment link sent. Waiting on payment"] as const;

/** Loose on purpose — it only catches a phone number or a name typed in the wrong box. */
/**
 * The language comes from the Call Log, whose Language labels differ from this
 * board's: the Call Log has "Spanish" and "Portugese", Jail Intakes has
 * "Espanol" and "Portuguese". Monday refuses a label the column lacks, so an
 * unmapped "Spanish" failed the whole create (2026-10-07).
 */
const INTAKE_LANGUAGE_LABELS: Record<string, string> = {
  Spanish: "Espanol",
  Portugese: "Portuguese",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** config/boards.yaml keys this route writes. */
export type IntakeColumnKey =
  | "status"
  | "jail"
  | "alien_number"
  | "language"
  | "poc_name_and_relationship_with_detained"
  | "poc_phone"
  | "poc_email"
  | "intake_created_on"
  | "description"
  | "country_of_birth"
  | "date_of_birth"
  // The board spells it "Have you even been removed?" — its typo, not ours, and
  // renaming a live column is not this route's business. See the note in
  // project_call_log about verifying labels before "fixing" them.
  | "have_you_even_been_removed"
  | "what_date_did_you_get_picked_up_by_ice"
  // Book consult (M9): the two fields staff fill before pressing Create Appt.
  | "appt_with"
  | "consult_date";

/** Resolved column ids, keyed by config name. Missing keys are simply not written. */
export type IntakeColumnIds = Partial<Record<IntakeColumnKey | "first_name" | "last_name" | "link_to_call_log", string>>;

export interface JailIntakeInput {
  firstName?: unknown;
  lastName?: unknown;
  jail?: unknown;
  alienNumber?: unknown;
  language?: unknown;
  pocName?: unknown;
  pocPhone?: unknown;
  /** Optional; the board's "POC Email" text column. */
  pocEmail?: unknown;
  /** One of INTAKE_CREATE_STATUSES; New Detainee when absent. */
  status?: unknown;
  /** Goes to the board's own "Description" long-text column. */
  description?: unknown;
  countryOfBirth?: unknown;
  /** Free text, not a date: the board stores "03/07/1980" and "05-27-95" alike. */
  dateOfBirth?: unknown;
  /** "No" | "Yes" | "Unknown" — the board's own options. */
  priorRemoval?: unknown;
  /**
   * YYYY-MM-DD. A real DATE column, unlike dateOfBirth beside it — this one
   * holds proper ISO values on 799 rows, so it takes {date} and a picker.
   */
  pickedUpByIce?: unknown;
  /** The monday item id of the call this intake came out of, when it came from one. */
  callLogItemId?: unknown;
}

export interface JailIntakePlan {
  itemName: string;
  columnValues: Record<string, unknown>;
  linkedCallItemId: string | null;
}

export interface JailIntakeRejection {
  status: number;
  error: string;
}

/**
 * Turn a first-contact capture into the monday mutation, or the reason not to.
 *
 * Only the detainee's name is required. Everything else is whatever the caller
 * happened to know, and a blank field is left unwritten rather than written
 * empty — an intake created with half the story is still worth having, and the
 * board is where the rest gets filled in.
 */
export function planJailIntakeWrite(
  input: JailIntakeInput,
  opts: { columnIds: IntakeColumnIds; today: string },
): { plan: JailIntakePlan } | { rejection: JailIntakeRejection } {
  const str = (v: unknown) => (v ?? "").toString().trim();
  const firstName = str(input.firstName);
  const lastName = str(input.lastName);

  if (!firstName && !lastName) {
    return { rejection: { status: 400, error: "The detainee's name is required" } };
  }

  const { columnIds, today } = opts;
  const columnValues: Record<string, unknown> = {};
  const set = (key: keyof IntakeColumnIds, value: unknown) => {
    const id = columnIds[key];
    if (id && value != null && value !== "") columnValues[id] = value;
  };

  set("first_name", firstName);
  set("last_name", lastName);
  set("jail", str(input.jail));
  set("alien_number", str(input.alienNumber));
  set("poc_name_and_relationship_with_detained", str(input.pocName));
  set("poc_phone", str(input.pocPhone));
  const pocEmail = str(input.pocEmail);
  if (pocEmail && !EMAIL_RE.test(pocEmail)) {
    return { rejection: { status: 400, error: "The POC e-mail doesn't look like an e-mail address" } };
  }
  set("poc_email", pocEmail);
  set("description", str(input.description));
  set("country_of_birth", str(input.countryOfBirth));
  // A text column, deliberately: staff have typed both "03/07/1980" and
  // "05-27-95" into it, so a date picker would impose a format the board does
  // not use and make the new rows the odd ones out.
  set("date_of_birth", str(input.dateOfBirth));

  const priorRemoval = str(input.priorRemoval);
  if (priorRemoval) set("have_you_even_been_removed", { label: priorRemoval });

  const pickedUp = str(input.pickedUpByIce);
  if (pickedUp) {
    if (!DATE_RE_ISO.test(pickedUp)) {
      return { rejection: { status: 400, error: "pickedUpByIce must be YYYY-MM-DD" } };
    }
    set("what_date_did_you_get_picked_up_by_ice", { date: pickedUp });
  }

  const language = str(input.language);
  if (language) set("language", { label: INTAKE_LANGUAGE_LABELS[language] ?? language });

  const status = str(input.status) || INITIAL_STATUS;
  if (!(INTAKE_CREATE_STATUSES as readonly string[]).includes(status)) {
    return { rejection: { status: 400, error: `A new intake can start as: ${INTAKE_CREATE_STATUSES.join(" or ")}` } };
  }
  set("status", { label: status });
  // The board's own "Intake Created" column, in the firm's zone — the list view
  // filters on it, so a date a day out would put a new lead outside the default.
  set("intake_created_on", { date: today });

  const callLogItemId = str(input.callLogItemId);
  if (callLogItemId && columnIds.link_to_call_log) {
    columnValues[columnIds.link_to_call_log] = { item_ids: [Number(callLogItemId)] };
  }

  return {
    plan: {
      // Item names on this board are the detainee's full name.
      itemName: [firstName, lastName].filter(Boolean).join(" "),
      columnValues,
      linkedCallItemId: callLogItemId || null,
    },
  };
}

/**
 * Monday's long-text columns hold 2,000 characters. Not a soft limit: a longer
 * value is rejected outright, so an append-forever field has to be checked
 * rather than hoped about.
 */
export const LONG_TEXT_LIMIT = 2000;

export interface AppendedDescription {
  /** The value to write, or null when there is no room for this note. */
  next: string | null;
  /** True when the note did not fit — the caller must say so, not truncate. */
  full: boolean;
}

/**
 * Append a note to the board's Description, dated and attributed.
 *
 * Refuses rather than truncates when the column is full. A client note is not
 * something to silently cut in half, and the note has already been posted as an
 * update and an activity by this point — so the honest outcome is "it is in
 * Monday, just not in this column", which the UI can then say.
 */
export function appendToDescription(
  existing: string | null,
  note: string,
  opts: { author: string; today: string; limit?: number },
): AppendedDescription {
  const limit = opts.limit ?? LONG_TEXT_LIMIT;
  const entry = `${opts.today} — ${opts.author}: ${note.trim()}`;
  const base = (existing ?? "").trim();
  const next = base ? `${base}\n\n${entry}` : entry;
  if (next.length > limit) return { next: null, full: true };
  return { next, full: false };
}

// =============================================================================
// Book consult — fill Consult Date + Appt with, then Monday's button does the rest
// =============================================================================
// On Monday, booking a paid intake is: set Consult Date, set "Appt with:" to the
// attorney's letter, press the Create Appt button. The button's automations
// create the appointment on that attorney's board, create the profile, link the
// three, and move the intake to Scheduled. Monday's API cannot press a button,
// and redoing that chain here would race the automations (a second profile), so
// this writes the two fields and the UI sends staff to Monday for the press.
// See docs/decisions.md 2026-09-30.
// =============================================================================

/** The only status offered the button: paid, not yet booked. */
export const BOOKABLE_INTAKE_STATUS = "Needs to be scheduled";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface IntakeConsultInput {
  date?: unknown;
  time?: unknown;
  apptWith?: unknown;
}

export interface IntakeConsultPlan {
  date: string;
  time: string | null;
  apptWith: string;
  /** In write order: the date first, so the attorney never shows without one. */
  writes: Array<{ key: "consult_date" | "appt_with"; columnId: string; value: Record<string, unknown> }>;
}

/**
 * Validate a Book consult request against the intake and the board.
 *
 * `apptWithLabels` is the column's own labels; `attorneyBadges` the bookable
 * attorneys (data/attorney-boards.json). A label must be in both: the column
 * also holds workflow labels ("Appt requested. Waiting on date"), which are not
 * attorneys and would make the button create nothing.
 */
export function planIntakeConsult(
  input: IntakeConsultInput,
  opts: {
    status: string | null;
    columnIds: IntakeColumnIds;
    apptWithLabels: string[];
    attorneyBadges: string[];
    today: string;
  },
): { plan: IntakeConsultPlan } | { rejection: JailIntakeRejection & { allowed?: string[] } } {
  if (opts.status !== BOOKABLE_INTAKE_STATUS) {
    return { rejection: { status: 409, error: `Only an intake in "${BOOKABLE_INTAKE_STATUS}" can book a consult` } };
  }
  const dateCol = opts.columnIds.consult_date;
  const apptCol = opts.columnIds.appt_with;
  if (!dateCol || !apptCol) {
    return { rejection: { status: 409, error: "Consult Date / Appt with are not in config/boards.yaml" } };
  }

  const date = (input.date ?? "").toString().trim();
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!DATE_RE_ISO.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    return { rejection: { status: 400, error: "date must be a date (YYYY-MM-DD)" } };
  }
  if (date < opts.today) return { rejection: { status: 400, error: "date cannot be in the past" } };

  const time = (input.time ?? "").toString().trim();
  if (time && !TIME_RE.test(time)) return { rejection: { status: 400, error: "time must be HH:MM" } };

  const allowed = opts.apptWithLabels.filter((l) => opts.attorneyBadges.includes(l));
  const apptWith = (input.apptWith ?? "").toString().trim();
  if (!allowed.includes(apptWith)) {
    return { rejection: { status: 400, error: "Pick an attorney", allowed } };
  }

  return {
    plan: {
      date, time: time || null, apptWith,
      writes: [
        // Same shape M10 writes a Consult Date in (appointment-write.ts).
        { key: "consult_date", columnId: dateCol, value: time ? mondayDateTime(date, time) : { date } },
        { key: "appt_with", columnId: apptCol, value: { label: apptWith } },
      ],
    },
  };
}

export interface JailIntakeWriteDeps {
  db: DatabaseInstance;
  mondayApiToken: string | undefined;
  writeTokenOptions: WriteTokenOptions;
}

export function registerJailIntakeWriteRoutes(app: Express, deps: JailIntakeWriteDeps): void {
  const { db, mondayApiToken: MONDAY_API_TOKEN, writeTokenOptions } = deps;

  /** Board id + column ids from config, and the group id from monday. Cached. */
  let boardCache: { boardId: string; columnIds: IntakeColumnIds; groupId: string | null; at: number } | null = null;
  const BOARD_TTL_MS = 30 * 60 * 1000;

  async function intakeBoard(): Promise<{ boardId: string; columnIds: IntakeColumnIds; groupId: string | null } | null> {
    if (boardCache && Date.now() - boardCache.at < BOARD_TTL_MS) return boardCache;
    const boards = await loadBoardsConfig();
    const board = boards[BOARD_KEY];
    if (!board) return null;

    const columnIds: IntakeColumnIds = {};
    for (const [key, resolution] of Object.entries(board.columns)) {
      // Only `by_id` entries are safe to write blind; anything else would need
      // monday's live schema to disambiguate, and this board's titles collide.
      if (resolution.resolve === "by_id" && resolution.id) {
        columnIds[key as keyof IntakeColumnIds] = resolution.id;
      }
    }
    // Not in boards.yaml (nothing reads it yet), so take it from the live board.
    let groupId: string | null = null;
    try {
      const structure = await fetchBoardStructure(board.id);
      groupId = structure.groups?.find((g) => g.title.trim().toLowerCase() === INTAKE_GROUP_TITLE.toLowerCase())?.id ?? null;
      if (!columnIds.link_to_call_log) {
        columnIds.link_to_call_log = structure.columns.find(
          (c) => c.title.trim().toLowerCase() === "link to call log",
        )?.id;
      }
    } catch (err) {
      // A missing group means the item lands in the board's default one, and a
      // missing relation means the call simply is not linked. Neither is worth
      // failing an intake over.
      console.error("[jail-intakes] could not read the board structure:", err);
    }

    boardCache = { boardId: board.id, columnIds, groupId, at: Date.now() };
    return boardCache;
  }

  /**
   * "Casenote" — the firm's existing E&A activity type, queried from the account
   * rather than invented. See docs/decisions.md 2026-08-25 for why creating a
   * new type has a cost (staff get two identically named picker entries).
   */
  const CASENOTE_ACTIVITY_ID = "70e734ee-0261-4489-9047-35966b929ca3";

  /**
   * Post a note on an intake: a monday update AND an E&A activity.
   *
   * Write-only, and deliberately so. `client_updates.profile_local_id` is NOT
   * NULL, and an intake has no profile until it books a consult — so there is
   * nowhere local to put this, and the sync's pass 4 skips profile-less items,
   * meaning it could not be read back either. The note lives in monday. The UI
   * says so rather than pretending a local history exists.
   */
  app.get("/api/jail-intakes/:localId/notes", requireAuth, (req, res) => {
    res.json({ data: getJailIntakeNotes(db, String(req.params.localId)) });
  });

  app.post("/api/jail-intakes/:localId/notes", requireAuth, async (req, res) => {
    if (!MONDAY_API_TOKEN) {
      res.status(503).json({ error: "Monday.com write-back not configured" });
      return;
    }
    const localId = String(req.params.localId);
    const text = ((req.body as { text?: unknown })?.text ?? "").toString().trim();
    if (!text) {
      res.status(400).json({ error: "text is required" });
      return;
    }

    const board = await intakeBoard();
    if (!board) {
      res.status(409).json({ error: `Board "${BOARD_KEY}" is not in config/boards.yaml` });
      return;
    }

    const intake = db
      .prepare("SELECT monday_item_id, name FROM board_items WHERE local_id = ? AND board_key = ?")
      .get(localId, BOARD_KEY) as { monday_item_id: string | null; name: string } | null;
    if (!intake) {
      res.status(404).json({ error: "Jail intake not found" });
      return;
    }
    if (!intake.monday_item_id) {
      res.status(400).json({ error: "This intake has not synced to Monday yet — try again after the next sync" });
      return;
    }
    const mondayItemId = intake.monday_item_id;

    const activity: CreateTimelineItemInput = {
      itemId: mondayItemId,
      title: `Intake note — ${intake.name}`,
      customActivityId: CASENOTE_ACTIVITY_ID,
      content: text,
    };

    let pending = false;
    try {
      await withTokenFallback((token) => dataSource.postUpdate(mondayItemId, text, token), writeTokenOptions(req));
    } catch (err) {
      console.error("[write-back] intake note update failed; queueing for retry:", err);
      enqueueWrite(db, {
        opType: "create_update", targetTable: "board_items", targetLocalId: localId,
        mondayItemId, authorOid: req.user?.oid ?? null, payload: { body: text },
      });
      pending = true;
    }

    try {
      await withTokenFallback((token) => dataSource.createTimelineItem(activity, token), writeTokenOptions(req));
    } catch (err) {
      console.error("[write-back] intake note activity failed; queueing for retry:", err);
      enqueueWrite(db, {
        opType: "create_timeline_item", targetTable: "board_items", targetLocalId: localId,
        mondayItemId, authorOid: req.user?.oid ?? null, payload: { ...activity },
      });
      pending = true;
    }

    // Also append to the board's own Description column, which is where staff
    // read an intake's story. Read-modify-write, because setting a long-text
    // column REPLACES it — and read from monday rather than our mirror, which is
    // as stale as the last sync and would drop anything typed on the board since.
    let descriptionUpdated = false;
    let descriptionFull = false;
    const descColumnId = board.columnIds.description;
    if (descColumnId) {
      try {
        const live = await fetchItem(mondayItemId);
        const current = live.column_values?.find((c) => c.id === descColumnId)?.text ?? null;
        const appended = appendToDescription(current, text, {
          author: req.user?.name ?? req.user?.preferred_username ?? "Staff",
          today: new Date().toLocaleDateString("en-CA", { timeZone: FIRM_TIMEZONE }),
        });
        if (appended.full) {
          descriptionFull = true;
          console.warn(`[jail-intakes] Description is full for item ${mondayItemId} — note left as update + activity only.`);
        } else if (appended.next) {
          await withTokenFallback(
            (token) => dataSource.setColumnValue(board.boardId, mondayItemId, descColumnId, appended.next!, token),
            writeTokenOptions(req),
          );
          descriptionUpdated = true;
        }
      } catch (err) {
        // The update and the activity already landed; losing the Description
        // append is a partial success worth reporting, not a failed request.
        console.error("[write-back] intake Description append failed:", err);
      }
    }

    auditFromReq(req, "monday.jail_intake_note_added", {
      targetType: "board_item", targetId: localId, targetMondayId: mondayItemId,
      metadata: { name: intake.name, queued: pending, descriptionUpdated, descriptionFull },
    });
    res.status(pending ? 202 : 200).json({ data: { pending, descriptionUpdated, descriptionFull } });
  });

  /** Book consult (M9): write Consult Date + Appt with. See planIntakeConsult. */
  app.post("/api/jail-intakes/:localId/consult", requireAuth, async (req, res) => {
    if (!MONDAY_API_TOKEN) {
      res.status(503).json({ error: "Monday.com write-back not configured" });
      return;
    }
    const localId = String(req.params.localId);
    const board = await intakeBoard();
    if (!board) {
      res.status(409).json({ error: `Board "${BOARD_KEY}" is not in config/boards.yaml` });
      return;
    }
    const intake = db
      .prepare("SELECT monday_item_id, name, status FROM board_items WHERE local_id = ? AND board_key = ?")
      .get(localId, BOARD_KEY) as { monday_item_id: string | null; name: string; status: string | null } | undefined;
    if (!intake) {
      res.status(404).json({ error: "Jail intake not found" });
      return;
    }
    if (!intake.monday_item_id) {
      res.status(400).json({ error: "This intake has not synced to Monday yet — try again after the next sync" });
      return;
    }
    const mondayItemId = intake.monday_item_id;

    const apptWithLabels =
      getBoardColumnsFor(db, BOARD_KEY)?.columns.find((c) => c.columnId === board.columnIds.appt_with)?.options.map((o) => o.label) ?? [];
    const planned = planIntakeConsult(req.body as IntakeConsultInput, {
      status: intake.status,
      columnIds: board.columnIds,
      apptWithLabels,
      attorneyBadges: bookableBoards().map((b) => b.displayName),
      today: new Date().toLocaleDateString("en-CA", { timeZone: FIRM_TIMEZONE }),
    });
    if ("rejection" in planned) {
      const { status, ...rest } = planned.rejection;
      res.status(status).json(rest);
      return;
    }
    const { plan } = planned;

    let pending = false;
    const authorOid = req.user?.oid ?? null;
    for (const w of plan.writes) {
      try {
        await withTokenFallback(
          (token) => dataSource.setColumnValueJson(board.boardId, mondayItemId, w.columnId, w.value, token),
          writeTokenOptions(req),
        );
      } catch (err) {
        console.error(`[write-back] intake ${w.key} failed; queueing for retry:`, err);
        pending = true;
        enqueueWrite(db, {
          opType: "change_column_json", targetTable: "board_items", targetLocalId: localId,
          mondayItemId, authorOid, payload: { boardId: board.boardId, columnId: w.columnId, value: w.value },
        });
      }
    }

    // Optimistic mirror, in the shape the sync stores (date/time, {label}).
    db.prepare(
      `UPDATE board_items SET column_values = json_set(COALESCE(column_values, '{}'),
         '$.consult_date', json(?), '$.appt_with', json(?)) WHERE local_id = ?`,
    ).run(
      JSON.stringify(plan.time ? { date: plan.date, time: plan.time } : { date: plan.date }),
      JSON.stringify({ label: plan.apptWith }),
      localId,
    );

    auditFromReq(req, "monday.jail_intake_consult_set", {
      targetType: "board_item", targetId: localId, targetMondayId: mondayItemId,
      metadata: { name: intake.name, date: plan.date, time: plan.time, apptWith: plan.apptWith, queued: pending },
    });
    res.status(pending ? 202 : 200).json({ data: { pending, date: plan.date, time: plan.time, apptWith: plan.apptWith } });
  });

  app.post("/api/jail-intakes", requireAuth, async (req, res) => {
    if (!MONDAY_API_TOKEN) {
      res.status(503).json({ error: "Monday.com write-back not configured" });
      return;
    }

    const board = await intakeBoard();
    if (!board) {
      res.status(409).json({ error: `Board "${BOARD_KEY}" is not in config/boards.yaml` });
      return;
    }

    const outcome = planJailIntakeWrite(req.body as JailIntakeInput, {
      columnIds: board.columnIds,
      today: new Date().toLocaleDateString("en-CA", { timeZone: FIRM_TIMEZONE }),
    });
    if ("rejection" in outcome) {
      res.status(outcome.rejection.status).json({ error: outcome.rejection.error });
      return;
    }
    const plan = outcome.plan;

    const auditMeta = {
      boardKey: BOARD_KEY,
      mondayBoardId: board.boardId,
      name: plan.itemName,
      linkedCallItemId: plan.linkedCallItemId,
    };

    try {
      const result = await withTokenFallback(
        (token) =>
          dataSource.createItem(board.boardId, plan.itemName, plan.columnValues, token, board.groupId ?? undefined),
        writeTokenOptions(req),
      );
      auditFromReq(req, "monday.jail_intake_created", {
        targetType: "board_item",
        targetId: plan.itemName,
        targetMondayId: result.result,
        metadata: {
          ...auditMeta,
          intakeItemId: result.result,
          usedPersonalToken: result.usedPersonalToken,
          fellBackToSharedToken: result.fellBackToSharedToken,
        },
      });
      res.json({ data: { intakeItemId: result.result, name: plan.itemName, pending: false } });
    } catch (err) {
      // Same rail as a note, a contract or a consult: an outage must not lose
      // the intake — especially this one, taken while someone is on the phone.
      console.error("[write-back] jail intake createItem failed; queueing for retry:", err);
      enqueueWrite(db, {
        opType: "create_item",
        targetTable: "board_items",
        targetLocalId: plan.itemName,
        mondayItemId: null,
        authorOid: req.user?.oid ?? null,
        payload: {
          boardId: board.boardId,
          itemName: plan.itemName,
          columnValues: plan.columnValues,
          groupId: board.groupId ?? undefined,
        },
      });
      auditFromReq(req, "monday.jail_intake_created", {
        targetType: "board_item",
        targetId: plan.itemName,
        metadata: { ...auditMeta, queued: true },
      });
      res.status(202).json({ data: { name: plan.itemName, pending: true } });
    }
  });
}
