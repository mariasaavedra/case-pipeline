// =============================================================================
// Staff roster routes — Settings → Staff (admin-only, audited)
// =============================================================================
// GET    /api/staff                 roster + role list
// GET    /api/staff/unmatched       board names that resolve to no one
// POST   /api/staff                 add a person by hand
// PATCH  /api/staff/:id             edit fields (name, email, ext., Slack ID, board, active, dates)
// PUT    /api/staff/:id/roles       replace roles (marks them reviewed)
// POST   /api/staff/:id/aliases     {alias, move?} — 409 when another person holds it
// DELETE /api/staff/:id/aliases?alias=
// POST   /api/staff/sync            refresh from Monday + the boards
// Rules live in ../staff/roster.ts.
// =============================================================================

import type { Express, Request, Response } from "express";
import type BetterSqlite3 from "better-sqlite3";
import { requireAdmin } from "../auth/middleware.js";
import { auditFromReq } from "../audit/log.js";
import { usersDb } from "../db/users-db.js";
import { STAFF_ROLES, SLACK_USER_ID_RE, isStaffRole } from "../staff/schema.js";
import {
  listStaff,
  getStaff,
  createStaff,
  updateStaff,
  setRoles,
  addAlias,
  reassignAlias,
  removeAlias,
  readBoardNames,
  unmatchedBoardNames,
  AliasTakenError,
  type StaffPatch,
} from "../staff/roster.js";
import { runStaffRefresh } from "../staff/refresh.js";

export interface StaffRouteDeps {
  db: BetterSqlite3.Database;
  mondayApiToken: string | undefined;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Whitelist a PATCH body. Returns an error string for a bad value. */
export function parseStaffPatch(body: Record<string, unknown>): StaffPatch | string {
  const out: StaffPatch = {};
  const text = (key: "name" | "email" | "phoneExt" | "slackUserId" | "attorneyBoard") => {
    if (!(key in body)) return null;
    const v = body[key];
    if (v !== null && typeof v !== "string") return `${key} must be text`;
    (out as Record<string, unknown>)[key] = v === null ? null : v.trim() || null;
    return null;
  };
  for (const k of ["name", "email", "phoneExt", "slackUserId", "attorneyBoard"] as const) {
    const err = text(k);
    if (err) return err;
  }
  if (out.slackUserId) {
    out.slackUserId = out.slackUserId.toUpperCase();
    if (!SLACK_USER_ID_RE.test(out.slackUserId)) {
      return "Slack ID must be a member id starting with U (Slack profile → ⋮ → Copy member ID)";
    }
  }
  if ("name" in out && !out.name) return "name can't be empty";
  if ("active" in body) {
    if (typeof body.active !== "boolean") return "active must be true or false";
    out.active = body.active;
  }
  for (const k of ["startDate", "endDate"] as const) {
    if (!(k in body)) continue;
    const v = body[k];
    if (v !== null && (typeof v !== "string" || !DATE_RE.test(v))) return `${k} must be YYYY-MM-DD`;
    out[k] = v as string | null;
  }
  return out;
}

export function registerStaffRoutes(app: Express, deps: StaffRouteDeps): void {
  const { db, mondayApiToken } = deps;

  const idParam = (req: Request, res: Response): number | null => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || !getStaff(usersDb, id)) {
      res.status(404).json({ error: "Staff record not found" });
      return null;
    }
    return id;
  };

  app.get("/api/staff", requireAdmin, (_req, res) => {
    res.json({ data: { staff: listStaff(usersDb), roles: STAFF_ROLES } });
  });

  app.get("/api/staff/unmatched", requireAdmin, (_req, res) => {
    res.json({ data: unmatchedBoardNames(usersDb, readBoardNames(db)) });
  });

  app.post("/api/staff", requireAdmin, (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch = parseStaffPatch(body);
    if (typeof patch === "string") {
      res.status(400).json({ error: patch });
      return;
    }
    if (!patch.name) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    const roles = Array.isArray(body.roles) ? body.roles.filter(isStaffRole) : [];
    const id = usersDb.transaction(() => {
      const newId = createStaff(usersDb, { ...patch, name: patch.name!, source: "manual" });
      if (roles.length) setRoles(usersDb, newId, roles);
      return newId;
    })();
    auditFromReq(req, "staff.created", { targetType: "staff", targetId: String(id), metadata: { name: patch.name, roles } });
    res.status(201).json({ data: getStaff(usersDb, id) });
  });

  app.patch("/api/staff/:id", requireAdmin, (req, res) => {
    const id = idParam(req, res);
    if (id === null) return;
    const patch = parseStaffPatch((req.body ?? {}) as Record<string, unknown>);
    if (typeof patch === "string") {
      res.status(400).json({ error: patch });
      return;
    }
    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: "No valid fields to update" });
      return;
    }
    updateStaff(usersDb, id, patch);
    auditFromReq(req, "staff.updated", { targetType: "staff", targetId: String(id), metadata: { changed: Object.keys(patch) } });
    res.json({ data: getStaff(usersDb, id) });
  });

  app.put("/api/staff/:id/roles", requireAdmin, (req, res) => {
    const id = idParam(req, res);
    if (id === null) return;
    const roles = (req.body as { roles?: unknown })?.roles;
    if (!Array.isArray(roles) || !roles.every(isStaffRole)) {
      res.status(400).json({ error: `roles must be a list of: ${STAFF_ROLES.join(", ")}` });
      return;
    }
    setRoles(usersDb, id, roles);
    auditFromReq(req, "staff.roles_changed", { targetType: "staff", targetId: String(id), metadata: { roles } });
    res.json({ data: getStaff(usersDb, id) });
  });

  app.post("/api/staff/:id/aliases", requireAdmin, (req, res) => {
    const id = idParam(req, res);
    if (id === null) return;
    const { alias, move } = (req.body ?? {}) as { alias?: unknown; move?: unknown };
    if (typeof alias !== "string" || !alias.trim()) {
      res.status(400).json({ error: "alias is required" });
      return;
    }
    try {
      if (move === true) reassignAlias(usersDb, id, alias);
      else addAlias(usersDb, id, alias);
    } catch (err) {
      if (err instanceof AliasTakenError) {
        const owner = getStaff(usersDb, err.ownerId);
        res.status(409).json({ error: `"${err.alias}" is already ${owner?.name ?? "someone else"}'s name`, ownerId: err.ownerId });
        return;
      }
      throw err;
    }
    auditFromReq(req, "staff.alias_added", { targetType: "staff", targetId: String(id), metadata: { alias: alias.trim(), moved: move === true } });
    res.json({ data: getStaff(usersDb, id) });
  });

  app.delete("/api/staff/:id/aliases", requireAdmin, (req, res) => {
    const id = idParam(req, res);
    if (id === null) return;
    const alias = typeof req.query.alias === "string" ? req.query.alias : "";
    if (!alias.trim()) {
      res.status(400).json({ error: "alias is required" });
      return;
    }
    removeAlias(usersDb, id, alias);
    auditFromReq(req, "staff.alias_removed", { targetType: "staff", targetId: String(id), metadata: { alias: alias.trim() } });
    res.json({ data: getStaff(usersDb, id) });
  });

  app.post("/api/staff/sync", requireAdmin, async (req, res) => {
    const result = await runStaffRefresh(db, mondayApiToken);
    auditFromReq(req, "staff.synced", { targetType: "staff", metadata: { ...result, missingFromMonday: result.missingFromMonday.length } });
    res.json({ data: result });
  });
}
