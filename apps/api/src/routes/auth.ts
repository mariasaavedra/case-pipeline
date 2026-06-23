import type { Request, Response } from "express";
import { usersDb, type UserRow } from "../db/users-db.js";

export function handleAuthMe(req: Request, res: Response): void {
  const claims = req.user!;
  const email = claims.preferred_username || claims.email || "";

  // First user ever becomes admin — bootstrap for the project owner.
  const { n } = usersDb.prepare("SELECT COUNT(*) as n FROM users").get() as { n: number };
  const role = n === 0 ? "admin" : "user";

  usersDb
    .prepare(
      `INSERT INTO users (azure_oid, email, name, role)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(azure_oid) DO UPDATE SET
         email = excluded.email,
         name = excluded.name,
         last_login = datetime('now')`
    )
    .run(claims.oid, email, claims.name, role);

  const user = usersDb
    .prepare("SELECT * FROM users WHERE azure_oid = ?")
    .get(claims.oid) as UserRow;

  res.json({ data: user });
}
