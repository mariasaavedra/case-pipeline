// =============================================================================
// Staff offboarding routes — Settings → Staff → person → Offboard (admin-only)
// =============================================================================
// GET   /api/staff/:id/offboarding           open work, checklist, candidates
// POST  /api/staff/:id/offboarding/reassign  {assignments: [{source, localId, column, toStaffId|null}]}
// PATCH /api/staff/:id/offboarding           {step, done} | {deactivate: true} | {complete: true}
// Rules + the order of things = ../staff/offboarding.ts. Writes to Monday only
// with live data and a token (`liveWrites`); otherwise the mirror alone changes.
// =============================================================================

import path from "node:path";
import type { Express, Request, Response } from "express";
import type BetterSqlite3 from "better-sqlite3";
import { loadBoardsConfig } from "@case-pipeline/config";
import { fetchPeopleCells, fetchUsersByIds } from "@case-pipeline/monday";
import {
  getWorkload,
  WORKLOAD_SOURCES,
  type ActiveCasesOptions,
  type WorkloadAssignment,
  type WorkloadColumn,
  type WorkloadSource,
} from "@case-pipeline/query";
import { requireAdmin } from "../auth/middleware.js";
import { auditFromReq } from "../audit/log.js";
import { currentUser } from "../db/user-context.js";
import { usersDb } from "../db/users-db.js";
import { dataSource } from "../data-source/index.js";
import { withTokenFallback } from "../write-auth.js";
import type { WriteTokenOptions } from "../write-token.js";
import { enqueueWrite } from "../write-queue/processor.js";
import { REPO_ROOT } from "../paths.js";
import { getStaff, listStaff, makeStaffResolver } from "../staff/roster.js";
import { OFFBOARDING_MANUAL_STEPS, type OffboardingManualStep } from "../staff/schema.js";
import {
  planReassignments,
  swapPersons,
  applyLocalReassignment,
  getOffboarding,
  startOffboarding,
  setManualStep,
  allStepsDone,
  indexCells,
  cellKey,
  type Reassignment,
  type ItemResult,
} from "../staff/offboarding.js";

const COLUMNS: WorkloadColumn[] = ["paralegal", "attorney", "assistant"];
// Absolute: `npm run dev:api` runs from apps/api, where the loader's relative default misses.
const BOARDS_YAML = path.join(REPO_ROOT, "config/boards.yaml");
const MAX_ASSIGNMENTS = 500;

export interface StaffOffboardingDeps {
  db: BetterSqlite3.Database;
  mondayApiToken: string | undefined;
  writeTokenOptions: WriteTokenOptions;
  /** Live data + a token: changes go to Monday. Seed data never does. */
  liveWrites: boolean;
  /** The firm's urgency settings, so "critical" matches P5. */
  activeCasesOptions: () => ActiveCasesOptions;
}

/** Whitelist the reassign body. A string = what's wrong. */
export function parseAssignments(body: unknown): Reassignment[] | string {
  const list = (body as { assignments?: unknown })?.assignments;
  if (!Array.isArray(list) || list.length === 0) return "assignments must be a non-empty list";
  if (list.length > MAX_ASSIGNMENTS) return `at most ${MAX_ASSIGNMENTS} assignments at once`;
  const out: Reassignment[] = [];
  for (const raw of list) {
    const a = raw as Record<string, unknown>;
    if (!WORKLOAD_SOURCES.includes(a.source as WorkloadSource)) return "unknown source";
    if (typeof a.localId !== "string" || !a.localId) return "localId is required";
    if (!COLUMNS.includes(a.column as WorkloadColumn)) return "column must be paralegal, attorney or assistant";
    if (a.toStaffId !== null && !(typeof a.toStaffId === "number" && Number.isInteger(a.toStaffId))) return "toStaffId must be a staff id or null";
    out.push({ source: a.source as WorkloadSource, localId: a.localId, column: a.column as WorkloadColumn, toStaffId: a.toStaffId as number | null });
  }
  return out;
}

export function registerStaffOffboardingRoutes(app: Express, deps: StaffOffboardingDeps): void {
  const { db, mondayApiToken, writeTokenOptions, liveWrites, activeCasesOptions } = deps;

  const openItems = (staffId: number): WorkloadAssignment[] =>
    getWorkload(db, makeStaffResolver(usersDb), { activeCases: activeCasesOptions() }).people.find((p) => p.staffId === staffId)?.items ?? [];

  const staffParam = (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const staff = Number.isInteger(id) ? getStaff(usersDb, id) : null;
    if (!staff) res.status(404).json({ error: "Staff record not found" });
    return staff;
  };

  const payload = (staffId: number) => {
    const staff = getStaff(usersDb, staffId)!;
    const items = openItems(staffId);
    const record = getOffboarding(usersDb, staffId);
    return {
      staff,
      items,
      record,
      steps: OFFBOARDING_MANUAL_STEPS,
      liveWrites,
      // Who can take the work: active, not this person. The picker filters by role.
      candidates: listStaff(usersDb)
        .filter((s) => s.active && s.id !== staffId)
        .map((s) => ({ id: s.id, name: s.name, roles: s.roles, hasMonday: !!s.mondayUserId })),
      done: !!record?.completedAt,
      canComplete: items.length === 0 && allStepsDone(record) && !staff.active,
    };
  };

  const ensureStarted = (req: Request, staffId: number) => {
    if (startOffboarding(usersDb, staffId, currentUser(req)?.id ?? null)) {
      auditFromReq(req, "staff.offboard_started", { targetType: "staff", targetId: String(staffId) });
    }
  };

  app.get("/api/staff/:id/offboarding", requireAdmin, (req, res) => {
    const staff = staffParam(req, res);
    if (!staff) return;
    res.json({ data: payload(staff.id) });
  });

  app.post("/api/staff/:id/offboarding/reassign", requireAdmin, async (req, res) => {
    const staff = staffParam(req, res);
    if (!staff) return;
    const choices = parseAssignments(req.body);
    if (typeof choices === "string") {
      res.status(400).json({ error: choices });
      return;
    }
    ensureStarted(req, staff.id);

    const resolve = makeStaffResolver(usersDb);
    const { writes, localOnly, skipped } = planReassignments(
      openItems(staff.id),
      choices,
      await loadBoardsConfig(BOARDS_YAML),
      (id) => {
        const s = getStaff(usersDb, id);
        return s ? { name: s.name, mondayUserId: s.mondayUserId, active: s.active } : null;
      },
      { liveWrites },
    );
    const isDepartingName = (n: string) => resolve(n)?.id === staff.id;
    const results: ItemResult[] = [...skipped];

    for (const w of localOnly) {
      applyLocalReassignment(db, w, isDepartingName);
      results.push({ source: w.source, localId: w.localId, column: w.column, outcome: "local_only" });
    }
    if (writes.length > 0) {
      // Who is in each cell right now, by id. Nothing is written if this fails.
      let cells;
      try {
        cells = indexCells(await fetchPeopleCells(writes.map((w) => w.mondayItemId), writes.map((w) => w.columnId), mondayApiToken));
      } catch (err) {
        console.error("[offboarding] could not read the people columns from Monday:", err);
        res.status(502).json({ error: "Monday.com couldn't be reached — nothing was changed. Try again in a minute." });
        return;
      }
      // Ids in those cells we can't place: look up their names (deactivated users included).
      const known = new Set(listStaff(usersDb).map((s) => s.mondayUserId).filter(Boolean) as string[]);
      const unknownIds = [...cells.values()].flatMap((c) => c.persons.filter((p) => p.kind === "person" && !known.has(p.id)).map((p) => p.id));
      const departingIds = new Set<string>(staff.mondayUserId ? [staff.mondayUserId] : []);
      try {
        for (const u of await fetchUsersByIds(unknownIds, mondayApiToken)) if (isDepartingName(u.name)) departingIds.add(u.id);
      } catch (err) {
        console.warn("[offboarding] could not look up unknown people ids; matching by known id only:", err);
      }

      for (const w of writes) {
        const cell = cells.get(cellKey(w.mondayItemId, w.columnId));
        const base = { source: w.source, localId: w.localId, column: w.column };
        if (!cell) {
          results.push({ ...base, outcome: "skipped", reason: "Item not found on Monday" });
          continue;
        }
        const next = swapPersons(cell.persons, (id) => departingIds.has(id), w.to?.mondayUserId ?? null);
        if (next.removed === 0) {
          results.push({ ...base, outcome: "skipped", reason: "Already changed on Monday" });
          continue;
        }
        const value = { personsAndTeams: next.personsAndTeams };
        try {
          await withTokenFallback(
            (token) => dataSource.setColumnValueJson(w.mondayBoardId, w.mondayItemId, w.columnId, value, token),
            writeTokenOptions(req),
          );
          applyLocalReassignment(db, w, isDepartingName);
          results.push({ ...base, outcome: "written" });
        } catch (err) {
          console.error("[offboarding] reassignment failed; queueing for retry:", err);
          enqueueWrite(db, {
            opType: "change_column_json", targetTable: w.table, targetLocalId: w.localId,
            mondayItemId: w.mondayItemId, authorOid: req.user?.oid ?? null,
            payload: { boardId: w.mondayBoardId, columnId: w.columnId, value },
          });
          applyLocalReassignment(db, w, isDepartingName);
          results.push({ ...base, outcome: "queued" });
        }
      }
    }

    const count = (o: ItemResult["outcome"]) => results.filter((r) => r.outcome === o).length;
    auditFromReq(req, "staff.reassigned", {
      targetType: "staff",
      targetId: String(staff.id),
      // Counts only — no client names in the audit trail.
      metadata: {
        written: count("written"), queued: count("queued"), localOnly: count("local_only"), skipped: count("skipped"),
        bySource: Object.fromEntries(WORKLOAD_SOURCES.map((s) => [s, results.filter((r) => r.source === s && r.outcome !== "skipped").length])),
        toStaffIds: [...new Set(choices.map((c) => c.toStaffId))],
      },
    });
    res.json({ data: { results, ...payload(staff.id) } });
  });

  app.patch("/api/staff/:id/offboarding", requireAdmin, (req, res) => {
    const staff = staffParam(req, res);
    if (!staff) return;
    const body = (req.body ?? {}) as { step?: unknown; done?: unknown; deactivate?: unknown; complete?: unknown };
    const me = currentUser(req);
    ensureStarted(req, staff.id);

    if (body.step !== undefined) {
      if (!OFFBOARDING_MANUAL_STEPS.includes(body.step as OffboardingManualStep) || typeof body.done !== "boolean") {
        res.status(400).json({ error: `step must be one of ${OFFBOARDING_MANUAL_STEPS.join(", ")}, with done true/false` });
        return;
      }
      setManualStep(usersDb, staff.id, body.step as OffboardingManualStep, body.done, me?.email ?? null);
      auditFromReq(req, "staff.offboarding_step", { targetType: "staff", targetId: String(staff.id), metadata: { step: body.step, done: body.done } });
    }

    if (body.deactivate === true) {
      if (staff.login && staff.login.userId === me?.id) {
        res.status(400).json({ error: "You can't offboard yourself." });
        return;
      }
      const login = staff.login
        ? (usersDb.prepare("SELECT role, active FROM users WHERE id = ?").get(staff.login.userId) as { role: string; active: number })
        : null;
      if (login?.role === "admin" && login.active === 1) {
        const admins = (usersDb.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1").get() as { n: number }).n;
        if (admins <= 1) {
          res.status(400).json({ error: "This is the last active admin. Promote someone else first." });
          return;
        }
      }
      const today = new Date().toISOString().slice(0, 10);
      usersDb.transaction(() => {
        usersDb.prepare("UPDATE staff SET active = 0, end_date = COALESCE(end_date, ?), updated_at = datetime('now') WHERE id = ?").run(today, staff.id);
        usersDb.prepare("UPDATE users SET active = 0 WHERE staff_id = ?").run(staff.id);
      })();
      auditFromReq(req, "staff.deactivated", { targetType: "staff", targetId: String(staff.id), metadata: { loginDisabled: !!staff.login } });
    }

    if (body.complete === true) {
      const p = payload(staff.id);
      if (!p.canComplete) {
        const missing = [
          p.items.length > 0 && `${p.items.length} open item(s) still assigned`,
          p.staff.active && "access not turned off",
          !allStepsDone(p.record) && "manual steps not all ticked",
        ].filter(Boolean);
        res.status(409).json({ error: `Not finished: ${missing.join("; ")}.` });
        return;
      }
      usersDb.prepare("UPDATE staff_offboarding SET completed_at = datetime('now') WHERE staff_id = ?").run(staff.id);
      auditFromReq(req, "staff.offboarded", { targetType: "staff", targetId: String(staff.id) });
    }

    res.json({ data: payload(staff.id) });
  });
}
