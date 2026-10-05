// =============================================================================
// Consult schedule — change a consult's date, time and attorney (P17.2 → M20)
// =============================================================================
// Reception moves consults around: a new day or hour, or another attorney. In
// Monday each attorney has their own appointment board, so "change the
// attorney" means MOVING the item to that attorney's board. One submit:
//
//   1. if the attorney changed: move_item_to_board into the same-named group on
//      the new board (else Upcoming / Today's consults by date). The item keeps
//      its id, updates and Emails & Activities. Columns are carried over by
//      title + type, since every board has its own column ids;
//   2. Consult Date (date + time, sent in UTC — firm-time.ts) and, after a
//      move, the Attorney people column, on whichever board it now sits.
//
// A move that fails is refused outright (nothing changed, try again) — it is
// not queued, because a half-applied move is worse than none. A date write
// that fails on an outage is queued like every other column write.
//
// Calendly is NOT updated: a client who booked through Calendly still has the
// old slot there. The modal says so.
//
// `planConsultSchedule` and `mapColumnsByTitle` are pure (consult-schedule.test.ts).
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
import type { BoardColumn } from "@case-pipeline/query";
import { fetchBoardStructure, fetchWorkspaceUsers } from "@case-pipeline/monday";
import type { ColumnMapping } from "@case-pipeline/monday";
import { loadAttorneyBoards } from "../attorney-boards.js";
import { FIRM_TIMEZONE, mondayDateTime } from "../firm.js";
import { TODAY_GROUP_RE, UPCOMING_GROUP_RE, type BoardGroup } from "./appointment-write.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

/**
 * Columns whose values Monday computes (or that can't be carried): mapped to
 * null. Mirrors re-fill themselves from the carried relations.
 */
const UNCARRIED_TYPES = new Set([
  "mirror", "lookup", "formula", "creation_log", "last_updated", "item_id",
  "auto_number", "subtasks", "direct_doc", "name",
]);

/**
 * Every source column → the target column with the same title and type, or
 * null. Monday needs the WHOLE source list once a mapping is given; a target
 * is used at most once.
 */
export function mapColumnsByTitle(source: BoardColumn[], target: BoardColumn[]): ColumnMapping[] {
  const key = (c: BoardColumn) => `${c.title.trim().toLowerCase()}|${c.type}`;
  const used = new Set<string>();
  return source
    .filter((c) => c.type !== "name")
    .map((c) => {
      if (UNCARRIED_TYPES.has(c.type)) return { source: c.columnId, target: null };
      // Same id first (the shared columns: Consult Date, Status, Profiles…), then same title + type.
      const t =
        target.find((x) => x.columnId === c.columnId && x.type === c.type && !used.has(x.columnId)) ??
        target.find((x) => key(x) === key(c) && !used.has(x.columnId));
      if (!t) return { source: c.columnId, target: null };
      used.add(t.columnId);
      return { source: c.columnId, target: t.columnId };
    });
}

export interface ScheduleInput {
  date?: unknown;
  time?: unknown;
  boardKey?: unknown;
}

export interface ScheduleCurrent {
  boardKey: string;
  date: string | null;
  time: string | null;
}

export interface SchedulePlan {
  date: string;
  /** HH:MM, or null to leave the consult without a time. */
  time: string | null;
  boardKey: string;
  moved: boolean;
  dateChanged: boolean;
}

/** Validate the change. Every refusal is a sentence reception can act on. */
export function planConsultSchedule(
  input: ScheduleInput,
  current: ScheduleCurrent,
  boardKeys: string[],
): { plan: SchedulePlan } | { error: string } {
  const date = String(input.date ?? "").trim();
  const time = String(input.time ?? "").trim();
  const boardKey = String(input.boardKey ?? "").trim() || current.boardKey;
  if (!DATE_RE.test(date)) return { error: "Pick a date" };
  if (time && !TIME_RE.test(time)) return { error: "Time must be HH:MM" };
  if (!boardKeys.includes(boardKey)) return { error: "Pick an attorney who is taking consults" };
  const moved = boardKey !== current.boardKey;
  const dateChanged = date !== current.date || (time || null) !== (current.time ?? null);
  if (!moved && !dateChanged) return { error: "Nothing changed" };
  return { plan: { date, time: time || null, boardKey, moved, dateChanged } };
}

/** The group a moved consult lands in: same title as now, else by date, else the first. */
export function targetGroup(groups: BoardGroup[], currentTitle: string | null, isToday: boolean): BoardGroup | null {
  const norm = (s: string) => s.trim().toLowerCase();
  const same = currentTitle ? groups.find((g) => norm(g.title) === norm(currentTitle)) : undefined;
  if (same) return same;
  const re = isToday ? TODAY_GROUP_RE : UPCOMING_GROUP_RE;
  return groups.find((g) => re.test(g.title.trim())) ?? groups[0] ?? null;
}

export interface ConsultScheduleDeps {
  db: DatabaseInstance;
  mondayApiToken: string | undefined;
  writeTokenOptions: WriteTokenOptions;
}

export function registerConsultScheduleRoutes(app: Express, deps: ConsultScheduleDeps): void {
  const { db, mondayApiToken: MONDAY_API_TOKEN, writeTokenOptions } = deps;

  let staffCache: { users: Awaited<ReturnType<typeof fetchWorkspaceUsers>>; at: number } | null = null;
  async function mondayUserIdFor(name: string | null): Promise<number | null> {
    if (!name) return null;
    try {
      if (!staffCache || Date.now() - staffCache.at > 10 * 60 * 1000) {
        staffCache = { users: await fetchWorkspaceUsers(MONDAY_API_TOKEN), at: Date.now() };
      }
      const hit = staffCache.users.find((u) => u.name.trim().toLowerCase() === name.trim().toLowerCase());
      const id = hit ? Number(hit.id) : NaN;
      return Number.isFinite(id) ? id : null;
    } catch (err) {
      console.error("[consult-schedule] could not resolve the attorney to a Monday user:", err);
      return null;
    }
  }

  /**
   * The attorney a board belongs to: the configured name, else whoever the
   * board's own consults name most often (attorney-boards.json has no names today).
   */
  function attorneyOf(boardKey: string): string | null {
    const configured = loadAttorneyBoards().find((b) => b.boardKey === boardKey)?.attorneyName;
    if (configured) return configured;
    const row = db
      .prepare(
        `SELECT attorney FROM board_items WHERE board_key = ? AND deleted_at IS NULL AND COALESCE(attorney, '') <> ''
          GROUP BY attorney ORDER BY COUNT(*) DESC LIMIT 1`,
      )
      .get(boardKey) as { attorney: string } | undefined;
    return row?.attorney ?? null;
  }

  // The attorneys M20 offers: every active attorney board, by attorney name.
  app.get("/api/reception/attorneys", requireAuth, (_req, res) => {
    res.json({
      data: loadAttorneyBoards()
        .filter((b) => b.active)
        .map((b) => ({ boardKey: b.boardKey, badge: b.displayName, attorney: attorneyOf(b.boardKey) })),
    });
  });

  app.patch("/api/reception/consults/:localId/schedule", requireAuth, async (req, res) => {
    if (!MONDAY_API_TOKEN) {
      res.status(503).json({ error: "Monday.com write-back not configured (MONDAY_API_TOKEN missing)" });
      return;
    }
    const localId = String(req.params.localId);
    const appt = db
      .prepare(
        `SELECT local_id AS localId, monday_item_id AS mondayItemId, board_key AS boardKey, group_title AS groupTitle,
                next_date AS date, next_time AS time, attorney
           FROM board_items WHERE local_id = ? AND deleted_at IS NULL`,
      )
      .get(localId) as
      | { localId: string; mondayItemId: string | null; boardKey: string; groupTitle: string | null;
          date: string | null; time: string | null; attorney: string | null }
      | undefined;
    if (!appt || !appt.boardKey.startsWith("appointments")) {
      res.status(404).json({ error: "Appointment not found" });
      return;
    }
    if (!appt.mondayItemId) {
      res.status(400).json({ error: "This appointment has no Monday.com item ID" });
      return;
    }
    const itemId = appt.mondayItemId;

    const boards = loadAttorneyBoards().filter((b) => b.active);
    const planned = planConsultSchedule(req.body as ScheduleInput, appt, boards.map((b) => b.boardKey));
    if ("error" in planned) {
      res.status(400).json({ error: planned.error });
      return;
    }
    const plan = planned.plan;

    const target = getBoardColumnsFor(db, plan.boardKey);
    const dateCol = target?.columns.find((c) => c.title.trim().toLowerCase() === "consult date" && c.type === "date");
    if (!target || !dateCol) {
      res.status(409).json({ error: `Could not resolve the 'Consult Date' column on ${plan.boardKey} — run a sync first` });
      return;
    }
    const newAttorney = plan.moved ? attorneyOf(plan.boardKey) : appt.attorney;

    // 1. The move. Refused outright on failure: nothing has changed yet.
    let movedTo: string | null = null;
    if (plan.moved) {
      const source = getBoardColumnsFor(db, appt.boardKey);
      if (!source) {
        res.status(409).json({ error: `Column schema for ${appt.boardKey} not synced yet — run a sync first` });
        return;
      }
      let groups: BoardGroup[] = [];
      try {
        groups = (await fetchBoardStructure(target.mondayBoardId)).groups ?? [];
      } catch (err) {
        console.error("[consult-schedule] could not read the target board's groups:", err);
      }
      const today = new Date().toLocaleDateString("en-CA", { timeZone: FIRM_TIMEZONE });
      const group = targetGroup(groups, appt.groupTitle, plan.date === today);
      if (!group) {
        res.status(502).json({ error: "Could not read the new attorney's board from Monday — try again" });
        return;
      }
      const mapping = mapColumnsByTitle(source.columns, target.columns);
      try {
        await withTokenFallback(
          (token) => dataSource.moveItem(target.mondayBoardId, group.id, itemId, mapping, token),
          writeTokenOptions(req),
        );
        movedTo = group.title;
      } catch (err) {
        console.error("[consult-schedule] move_item_to_board failed:", err);
        res.status(502).json({ error: "Monday did not move the consult — nothing was changed. Try again in a minute." });
        return;
      }
    }

    // 2. Date/time and (after a move) the Attorney column, on the board it now sits on.
    const values: Record<string, unknown> = {};
    values[dateCol.columnId] = plan.time ? mondayDateTime(plan.date, plan.time) : { date: plan.date };
    if (plan.moved) {
      const peopleCol = target.columns.find((c) => c.title.trim().toLowerCase() === "attorney" && c.type === "people");
      const userId = await mondayUserIdFor(newAttorney);
      if (peopleCol && userId != null) values[peopleCol.columnId] = { personsAndTeams: [{ id: userId, kind: "person" }] };
    }
    let pending = false;
    if (plan.dateChanged || plan.moved) {
      try {
        await withTokenFallback(
          (token) => dataSource.setColumnValues(target.mondayBoardId, itemId, values, token),
          writeTokenOptions(req),
        );
      } catch (err) {
        console.error("[consult-schedule] date/attorney write failed; queueing:", err);
        pending = true;
        for (const [columnId, value] of Object.entries(values)) {
          enqueueWrite(db, {
            opType: "change_column_json", targetTable: "board_items", targetLocalId: appt.localId,
            mondayItemId: itemId, authorOid: req.user?.oid ?? null,
            payload: { boardId: target.mondayBoardId, columnId, value },
          });
        }
      }
    }

    // Optimistic local mirror; the next sync replaces it with Monday's own shape.
    db.prepare(
      `UPDATE board_items
          SET board_key = ?, next_date = ?, next_time = ?, attorney = ?,
              group_title = COALESCE(?, group_title),
              column_values = json_set(COALESCE(column_values, '{}'), '$.consult_date', json(?))
        WHERE local_id = ?`,
    ).run(
      plan.boardKey, plan.date, plan.time, newAttorney, movedTo,
      JSON.stringify(plan.time ? { date: plan.date, time: plan.time } : { date: plan.date }),
      appt.localId,
    );

    auditFromReq(req, "monday.consult_rescheduled", {
      targetType: "board_item", targetId: appt.localId, targetMondayId: itemId,
      metadata: {
        from: { boardKey: appt.boardKey, date: appt.date, time: appt.time, attorney: appt.attorney },
        to: { boardKey: plan.boardKey, date: plan.date, time: plan.time, attorney: newAttorney },
        moved: plan.moved, queued: pending,
      },
    });
    res.status(pending ? 202 : 200).json({
      data: { boardKey: plan.boardKey, date: plan.date, time: plan.time, attorney: newAttorney, moved: plan.moved, pending },
    });
  });
}
