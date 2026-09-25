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
import { fetchBoardStructure } from "@case-pipeline/monday";
import { loadBoardsConfig } from "@case-pipeline/config";
import { FIRM_TIMEZONE } from "../firm.js";

const BOARD_KEY = "_fa_jail_intakes";

/** Where a new lead belongs — the board's non-scheduled group. */
const INTAKE_GROUP_TITLE = "Jail Intakes";

/** Every lead starts here; the board's own funnel moves it on. */
const INITIAL_STATUS = "New Detainee";

/** config/boards.yaml keys this route writes. */
export type IntakeColumnKey =
  | "status"
  | "jail"
  | "alien_number"
  | "language"
  | "poc_name_and_relationship_with_detained"
  | "poc_phone"
  | "intake_created_on";

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

  const language = str(input.language);
  if (language) set("language", { label: language });

  set("status", { label: INITIAL_STATUS });
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
