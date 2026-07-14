// =============================================================================
// Request → local user helpers
// =============================================================================
// Resolves the authenticated caller (validated Azure claims on req.user) to
// their row in users.db. Kept out of users-db.ts so the DB bootstrap module
// stays free of express types.
// =============================================================================

import type { Request } from "express";
import { usersDb, type UserRow } from "./users-db.js";

export function currentUser(req: Request): UserRow | null {
  const oid = req.user?.oid ?? "";
  if (!oid) return null;
  return (
    (usersDb.prepare("SELECT * FROM users WHERE azure_oid = ?").get(oid) as UserRow | undefined) ??
    null
  );
}

export function currentUserId(req: Request): number | null {
  return currentUser(req)?.id ?? null;
}
