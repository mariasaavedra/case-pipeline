import type { Request, Response } from "express";
import { usersDb, type UserRow } from "../db/users-db.js";
import { toPublicUser } from "../db/users-types.js";

/**
 * A row needs a name and Azure does not always send one — a shared or resource
 * mailbox (importantdocuments@, info@, a booking account) commonly has no
 * `name` claim at all. Trusting the claim put `undefined` into a NOT NULL
 * column, which threw, which the browser saw as a bare HTTP 500 and turned
 * into a sign-in screen that kept reappearing.
 *
 * The mailbox part of the address is what a person would call that account
 * anyway, so it is the fallback rather than a placeholder like "Unknown".
 */
export function displayName(claimName: string | undefined, email: string): string {
  const fromClaim = claimName?.trim();
  if (fromClaim) return fromClaim;
  const local = email.split("@")[0]?.trim();
  return local || email || "Unnamed account";
}

export function handleAuthMe(req: Request, res: Response): void {
  const claims = req.user!;
  const email = claims.preferred_username || claims.email || "";
  const name = displayName(claims.name, email);

  try {
    // Upsert the user and stamp last_login. The first user ever becomes admin
    // (bootstrap for the project owner). Wrapped in a transaction so the COUNT →
    // INSERT bootstrap can't race two simultaneous first-logins into two admins.
    const upsert = usersDb.transaction((oid: string, mail: string, who: string) => {
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
        .run(oid, mail, who, role);
    });
    upsert(claims.oid, email, name);

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
  } catch (err) {
    // The one route where a generic 500 is actively harmful: it is the gate to
    // the whole app, and the browser can only respond by showing the sign-in
    // screen again. Whoever is locked out is already authenticated by Azure, so
    // telling them WHY costs nothing and saves a trip into the server logs.
    console.error("[auth/me] failed for", email, err);
    res.status(500).json({
      error: `Your account could not be saved: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}
