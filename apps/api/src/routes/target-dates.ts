// =============================================================================
// P24 Target Dates — GET /api/target-dates (admin only)
// =============================================================================
// Every open Open Form by how close its Target date is (libs/query/src/
// target-dates.ts), with the last change to the date named from the staff
// roster and flagged when it wasn't an admin who made it — the target date is
// the admin's to set, but Monday lets anyone change it there.
//
// Moving a date goes through PATCH /api/open-forms/:localId/case-field
// (routes/case-card-write.ts, admin-only for target_date), with `extension`
// so the Open Form gets an update saying who granted it.
// =============================================================================

import type { Express } from "express";
import type BetterSqlite3 from "better-sqlite3";
type DatabaseInstance = BetterSqlite3.Database;
import { requireAdmin } from "../auth/middleware.js";
import { getTargetDates, isAutomationUser } from "@case-pipeline/query";
import type { TargetDatesResult, TargetDateCase } from "@case-pipeline/query";
import { FIRM_TIMEZONE } from "../firm.js";
import { staffNames } from "./case-timeline.js";

export interface TargetDateCaseView extends Omit<TargetDateCase, "lastChange"> {
  lastChange: (NonNullable<TargetDateCase["lastChange"]> & {
    /** Who, from the staff roster ("a Monday automation" for one). */
    by: string | null;
    /** An admin made it. Null = we can't tell (no Monday id, or no admin linked to the roster). */
    byAdmin: boolean | null;
  }) | null;
}

export interface TargetDatesView extends Omit<TargetDatesResult, "cases"> {
  cases: TargetDateCaseView[];
}

export function firmToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: FIRM_TIMEZONE });
}

/** Monday user ids of the active admins, through their staff roster link. */
export function adminMondayIds(usersDb: DatabaseInstance | undefined): Set<string> {
  if (!usersDb) return new Set();
  try {
    const rows = usersDb
      .prepare(`SELECT s.monday_user_id AS id FROM users u JOIN staff s ON s.id = u.staff_id
                 WHERE u.role = 'admin' AND u.active = 1 AND s.monday_user_id IS NOT NULL`)
      .all() as { id: string | number }[];
    return new Set(rows.map((r) => String(r.id)));
  } catch {
    return new Set(); // no roster yet
  }
}

export function getTargetDatesView(db: DatabaseInstance, usersDb: DatabaseInstance | undefined, today = firmToday()): TargetDatesView {
  const data = getTargetDates(db, { today, timeZone: FIRM_TIMEZONE });
  const name = staffNames(usersDb);
  const admins = adminMondayIds(usersDb);
  return {
    ...data,
    cases: data.cases.map((c) => {
      const l = c.lastChange;
      if (!l) return { ...c, lastChange: null };
      const automation = isAutomationUser(l.userId);
      return {
        ...c,
        lastChange: {
          ...l,
          by: !l.userId ? null : automation ? "a Monday automation" : name(l.userId),
          byAdmin: !l.userId || admins.size === 0 ? null : admins.has(l.userId),
        },
      };
    }),
  };
}

export function registerTargetDatesRoutes(app: Express, deps: { db: DatabaseInstance; usersDb?: DatabaseInstance }): void {
  app.get("/api/target-dates", requireAdmin, (_req, res) => {
    res.json({ data: getTargetDatesView(deps.db, deps.usersDb) });
  });
}
