import type { Request, Response } from "express";
import { usersDb, type UserRow } from "../db/users-db.js";
import { toPublicUser } from "../db/users-types.js";

export function handleAuthMe(req: Request, res: Response): void {
  const claims = req.user!;
  const email = claims.preferred_username || claims.email || "";

  // Upsert the user and stamp last_login. The first user ever becomes admin
  // (bootstrap for the project owner). Wrapped in a transaction so the COUNT →
  // INSERT bootstrap can't race two simultaneous first-logins into two admins.
  const upsert = usersDb.transaction((oid: string, mail: string, name: string) => {
    const { n } = usersDb.prepare("SELECT COUNT(*) as n FROM users").get() as { n: number };
    const role = n === 0 ? "admin" : "user";
    usersDb
      .prepare(
        `INSERT INTO users (azure_oid, email, name, role, last_login)
         VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT(azure_oid) DO UPDATE SET
           email = excluded.email,
           name = excluded.name,
           last_login = datetime('now')`
      )
      .run(oid, mail, name, role);
  });
  upsert(claims.oid, email, claims.name);

  // Track engagement: bump login count + presence timestamp on each session start.
  usersDb
    .prepare(
      "UPDATE users SET login_count = login_count + 1, last_active_at = datetime('now') WHERE azure_oid = ?",
    )
    .run(claims.oid);

  const user = usersDb
    .prepare("SELECT * FROM users WHERE azure_oid = ?")
    .get(claims.oid) as UserRow;

  // Strip the stored Monday token before returning the profile to the client.
  res.json({ data: toPublicUser(user) });
}
