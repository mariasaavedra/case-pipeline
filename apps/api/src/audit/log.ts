// =============================================================================
// Audit log — append-only record of sensitive actions
// =============================================================================
// In a legal context, "who did what" is not optional. recordAudit writes one
// row to users.db's audit_log for actions like role changes, Monday.com writes,
// admin profile edits, and board-config changes. It never throws — a failed
// audit write must not break the action, but it is logged loudly.
// =============================================================================

import type { Request } from "express";
import { usersDb } from "../db/users-db.js";
import { currentUser } from "../db/user-context.js";

export interface AuditActor {
  userId: number | null;
  email: string | null;
}

export interface AuditEntry {
  actor: AuditActor;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: unknown;
}

/** Build an actor descriptor from the authenticated request. */
export function actorFromReq(req: Request): AuditActor {
  const user = currentUser(req);
  return {
    userId: user?.id ?? null,
    email: user?.email ?? req.user?.preferred_username ?? req.user?.email ?? null,
  };
}

const insertAudit = usersDb.prepare(`
  INSERT INTO audit_log (actor_user_id, actor_email, action, target_type, target_id, metadata_json)
  VALUES (?, ?, ?, ?, ?, ?)
`);

export function recordAudit(entry: AuditEntry): void {
  try {
    insertAudit.run(
      entry.actor.userId,
      entry.actor.email,
      entry.action,
      entry.targetType ?? null,
      entry.targetId ?? null,
      entry.metadata != null ? JSON.stringify(entry.metadata) : null,
    );
  } catch (err) {
    console.error("[audit] failed to record entry:", entry.action, err);
  }
}

/** Convenience: record an action attributed to the request's caller. */
export function auditFromReq(
  req: Request,
  action: string,
  opts: { targetType?: string | null; targetId?: string | null; metadata?: unknown } = {},
): void {
  recordAudit({ actor: actorFromReq(req), action, ...opts });
}
