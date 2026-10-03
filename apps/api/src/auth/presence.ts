// =============================================================================
// Presence — "who's connected" for admins (Settings → Users)
// =============================================================================
// requireAuth stamps users.last_active_at on authenticated requests, at most
// once a minute per user (an in-memory throttle, so steady browsing doesn't
// turn every API call into a write). Status is derived from that timestamp:
// it means "made a request recently", not "has a tab open".
// =============================================================================

import type BetterSqlite3 from "better-sqlite3";

/** Minimum gap between two last_active_at writes for the same user. */
export const TOUCH_INTERVAL_MS = 60_000;
/** Active within this window → online. */
export const ONLINE_WINDOW_S = 5 * 60;
/** Active within this window (but not online) → idle. */
export const IDLE_WINDOW_S = 60 * 60;

export type PresenceStatus = "online" | "idle" | "offline";

export interface PresenceRow {
  id: number;
  name: string;
  email: string;
  lastActiveAt: string | null;
  /** Seconds since last activity, measured on the server clock. null = never. */
  secondsAgo: number | null;
  status: PresenceStatus;
}

const lastTouched = new Map<string, number>();

/** Stamp last_active_at for this user unless it was stamped in the last minute. */
export function touchPresence(db: BetterSqlite3.Database, oid: string, now = Date.now()): boolean {
  const prev = lastTouched.get(oid);
  if (prev !== undefined && now - prev < TOUCH_INTERVAL_MS) return false;
  lastTouched.set(oid, now);
  db.prepare("UPDATE users SET last_active_at = datetime('now') WHERE azure_oid = ?").run(oid);
  return true;
}

/** Test hook: forget the throttle state. */
export function resetPresenceThrottle(): void {
  lastTouched.clear();
}

export function presenceStatus(secondsAgo: number | null): PresenceStatus {
  if (secondsAgo === null) return "offline";
  if (secondsAgo <= ONLINE_WINDOW_S) return "online";
  if (secondsAgo <= IDLE_WINDOW_S) return "idle";
  return "offline";
}

/** Every active user with their presence, most recently active first. */
export function listPresence(db: BetterSqlite3.Database): PresenceRow[] {
  // Age is computed in SQLite so it uses the same clock that wrote the stamp
  // (browser clocks drift; the server's doesn't disagree with itself).
  const rows = db
    .prepare(
      `SELECT id, name, email, last_active_at,
              CAST(strftime('%s','now') - strftime('%s', last_active_at) AS INTEGER) AS seconds_ago
         FROM users
        WHERE active = 1
        ORDER BY last_active_at IS NULL, last_active_at DESC, name ASC`,
    )
    .all() as { id: number; name: string; email: string; last_active_at: string | null; seconds_ago: number | null }[];
  return rows.map((r) => {
    const secondsAgo = r.seconds_ago === null ? null : Math.max(0, r.seconds_ago);
    return {
      id: r.id,
      name: r.name,
      email: r.email,
      lastActiveAt: r.last_active_at,
      secondsAgo,
      status: presenceStatus(secondsAgo),
    };
  });
}
