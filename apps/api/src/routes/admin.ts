import type { Request, Response } from "express";
import { usersDb, type UserRow } from "../db/users-db.js";

function callerRole(oid: string): string {
  const row = usersDb
    .prepare("SELECT role FROM users WHERE azure_oid = ?")
    .get(oid) as { role: string } | undefined;
  return row?.role ?? "user";
}

export function handleAdminListUsers(req: Request, res: Response): void {
  if (callerRole(req.user!.oid) !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const users = usersDb
    .prepare("SELECT * FROM users ORDER BY created_at ASC")
    .all() as UserRow[];
  res.json({ data: users });
}

export function handleAdminUpdateRole(req: Request, res: Response): void {
  if (callerRole(req.user!.oid) !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

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
  res.json({ data: user });
}
