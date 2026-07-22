import type { Request, Response } from "express";
import { usersDb, type UserRow } from "../db/users-db.js";
import { toPublicUser, type AuditLogRow } from "../db/users-types.js";
import { auditFromReq } from "../audit/log.js";

// Role gating happens in the requireAdmin middleware (server.ts) — handlers
// here can assume an admin caller.

export function handleAdminListUsers(_req: Request, res: Response): void {
  const users = usersDb
    .prepare("SELECT * FROM users ORDER BY created_at ASC")
    .all() as UserRow[];
  // Never expose the stored Monday token (even encrypted) to the client.
  res.json({ data: users.map(toPublicUser) });
}

export function handleAdminUpdateRole(req: Request, res: Response): void {
  const { id } = req.params;
  const { role } = req.body as { role?: string };

  if (role !== "admin" && role !== "user") {
    res.status(400).json({ error: 'role must be "admin" or "user"' });
    return;
  }

  // Prevent demoting the last admin — at least one admin must always exist.
  if (role === "user") {
    const target = usersDb.prepare("SELECT role FROM users WHERE id = ?").get(id) as { role: string } | undefined;
    if (target?.role === "admin") {
      const adminCount = (usersDb.prepare("SELECT COUNT(*) AS cnt FROM users WHERE role = 'admin'").get() as { cnt: number }).cnt;
      if (adminCount <= 1) {
        res.status(400).json({ error: "Cannot demote the last admin. Promote another user first." });
        return;
      }
    }
  }

  const result = usersDb.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, id);
  if (result.changes === 0) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const user = usersDb.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow;
  auditFromReq(req, "user.role_changed", {
    targetType: "user",
    targetId: String(id),
    metadata: { role, email: user.email },
  });
  res.json({ data: toPublicUser(user) });
}

// =============================================================================
// PATCH /api/admin/users/:id — profile fields an admin may set
// =============================================================================
export function handleAdminUpdateUser(req: Request, res: Response): void {
  const { id } = req.params;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const target = usersDb.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
  if (!target) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const sets: string[] = [];
  const vals: unknown[] = [];
  const changed: Record<string, unknown> = {};

  const strField = (key: string, col: string) => {
    if (key in body) {
      const v = body[key];
      if (v === null || (typeof v === "string" && v.trim() === "")) {
        sets.push(`${col} = NULL`);
        changed[col] = null;
      } else if (typeof v === "string") {
        sets.push(`${col} = ?`);
        vals.push(v.trim());
        changed[col] = v.trim();
      }
    }
  };
  strField("job_title", "job_title");
  strField("paralegal_link", "paralegal_link");

  if ("active" in body) {
    const active = body.active === true || body.active === 1 ? 1 : 0;
    // Never disable the last active admin — that would lock everyone out of admin.
    if (active === 0 && target.role === "admin") {
      const activeAdmins = (
        usersDb
          .prepare("SELECT COUNT(*) AS cnt FROM users WHERE role = 'admin' AND active = 1")
          .get() as { cnt: number }
      ).cnt;
      if (activeAdmins <= 1) {
        res.status(400).json({ error: "Cannot deactivate the last active admin." });
        return;
      }
    }
    sets.push("active = ?");
    vals.push(active);
    changed.active = active;
  }

  if (sets.length === 0) {
    res.status(400).json({ error: "No valid fields to update" });
    return;
  }

  vals.push(id);
  usersDb.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  const updated = usersDb.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow;
  auditFromReq(req, "user.profile_updated", {
    targetType: "user",
    targetId: String(id),
    metadata: { email: updated.email, changed },
  });
  res.json({ data: toPublicUser(updated) });
}

// =============================================================================
// GET /api/admin/audit — paginated audit trail
// =============================================================================
export function handleAdminAudit(req: Request, res: Response): void {
  const limit = Math.min(Math.max(Number(req.query.limit ?? 100) || 100, 1), 500);
  const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0);
  const rows = usersDb
    .prepare("SELECT * FROM audit_log ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?")
    .all(limit, offset) as AuditLogRow[];
  res.json({
    data: rows.map((r) => ({
      id: r.id,
      actorUserId: r.actor_user_id,
      actorEmail: r.actor_email,
      action: r.action,
      targetType: r.target_type,
      targetId: r.target_id,
      metadata: r.metadata_json ? safeParse(r.metadata_json) : null,
      createdAt: r.created_at,
    })),
  });
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}
