// =============================================================================
// "Me" routes — self-service profile, recently viewed, watchlist, saved views
// =============================================================================
// All operate on the authenticated caller's own rows in users.db. Handlers that
// need client display names also take the case DB (seed/live) to enrich by
// profile_local_id — those are wired in server.ts where that handle lives.
// =============================================================================

import type { Request, Response } from "express";
import type BetterSqlite3 from "better-sqlite3";
import { usersDb, type UserRow } from "../db/users-db.js";
import { currentUser, currentUserId } from "../db/user-context.js";
import { toPublicUser, type SavedViewRow } from "../db/users-types.js";

type Database = BetterSqlite3.Database;

const RECENT_LIMIT = 20;
const ALLOWED_LOCALES = new Set(["es", "en"]);

// ---- Enrichment: profile_local_id → display name (from the case DB) ---------
function profileNames(caseDb: Database, ids: string[]): Map<string, string> {
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => "?").join(",");
  const rows = caseDb
    .prepare(`SELECT local_id, name FROM profiles WHERE local_id IN (${placeholders})`)
    .all(...ids) as { local_id: string; name: string }[];
  return new Map(rows.map((r) => [r.local_id, r.name]));
}

// ---- Profile (self-service) -------------------------------------------------
export function handleUpdateMyProfile(req: Request, res: Response): void {
  const user = currentUser(req);
  if (!user) {
    res.status(401).json({ error: "Unknown user" });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const sets: string[] = [];
  const vals: unknown[] = [];

  // Trim strings; an explicit empty string clears the field (→ null).
  const strField = (key: string, col: string) => {
    if (key in body) {
      const v = body[key];
      if (v === null || (typeof v === "string" && v.trim() === "")) {
        sets.push(`${col} = NULL`);
      } else if (typeof v === "string") {
        sets.push(`${col} = ?`);
        vals.push(v.trim());
      }
    }
  };

  if ("locale" in body) {
    const v = body.locale;
    if (typeof v === "string" && ALLOWED_LOCALES.has(v)) {
      sets.push("locale = ?");
      vals.push(v);
    }
  }
  strField("timezone", "timezone");
  strField("phone_ext", "phone_ext");
  strField("paralegal_link", "paralegal_link"); // self-service link to a board name

  if (sets.length === 0) {
    res.status(400).json({ error: "No valid profile fields to update" });
    return;
  }

  vals.push(user.id);
  usersDb.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  const updated = usersDb.prepare("SELECT * FROM users WHERE id = ?").get(user.id) as UserRow;
  res.json({ data: toPublicUser(updated) });
}

// ---- Recently viewed --------------------------------------------------------
const upsertRecent = usersDb.prepare(`
  INSERT INTO recently_viewed (user_id, profile_local_id, viewed_at)
  VALUES (?, ?, datetime('now'))
  ON CONFLICT(user_id, profile_local_id) DO UPDATE SET viewed_at = datetime('now')
`);
const rotateRecent = usersDb.prepare(`
  DELETE FROM recently_viewed
  WHERE user_id = ?
    AND id NOT IN (
      SELECT id FROM recently_viewed WHERE user_id = ? ORDER BY viewed_at DESC LIMIT ?
    )
`);

/** Record a client view for a user, keeping only the newest RECENT_LIMIT. Best-effort. */
export function recordRecentlyViewed(userId: number, profileLocalId: string): void {
  try {
    upsertRecent.run(userId, profileLocalId);
    rotateRecent.run(userId, userId, RECENT_LIMIT);
  } catch (err) {
    console.error("[recently-viewed] failed:", err);
  }
}

export function handleGetRecentlyViewed(req: Request, res: Response, caseDb: Database): void {
  const uid = currentUserId(req);
  if (!uid) {
    res.status(401).json({ error: "Unknown user" });
    return;
  }
  const rows = usersDb
    .prepare(
      "SELECT profile_local_id, viewed_at FROM recently_viewed WHERE user_id = ? ORDER BY viewed_at DESC LIMIT ?",
    )
    .all(uid, RECENT_LIMIT) as { profile_local_id: string; viewed_at: string }[];
  const names = profileNames(caseDb, rows.map((r) => r.profile_local_id));
  res.json({
    data: rows.map((r) => ({
      profileLocalId: r.profile_local_id,
      name: names.get(r.profile_local_id) ?? null,
      viewedAt: r.viewed_at,
    })),
  });
}

// ---- Watchlist --------------------------------------------------------------
export function handleGetWatchlist(req: Request, res: Response, caseDb: Database): void {
  const uid = currentUserId(req);
  if (!uid) {
    res.status(401).json({ error: "Unknown user" });
    return;
  }
  const rows = usersDb
    .prepare(
      "SELECT profile_local_id, note, created_at FROM user_watchlist WHERE user_id = ? ORDER BY created_at DESC",
    )
    .all(uid) as { profile_local_id: string; note: string | null; created_at: string }[];
  const names = profileNames(caseDb, rows.map((r) => r.profile_local_id));
  res.json({
    data: rows.map((r) => ({
      profileLocalId: r.profile_local_id,
      name: names.get(r.profile_local_id) ?? null,
      note: r.note,
      createdAt: r.created_at,
    })),
  });
}

export function handleAddWatchlist(req: Request, res: Response): void {
  const uid = currentUserId(req);
  if (!uid) {
    res.status(401).json({ error: "Unknown user" });
    return;
  }
  const { profileLocalId, note } = (req.body ?? {}) as { profileLocalId?: string; note?: string };
  if (!profileLocalId || typeof profileLocalId !== "string") {
    res.status(400).json({ error: "profileLocalId is required" });
    return;
  }
  usersDb
    .prepare(
      `INSERT INTO user_watchlist (user_id, profile_local_id, note)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id, profile_local_id) DO UPDATE SET note = excluded.note`,
    )
    .run(uid, profileLocalId, typeof note === "string" ? note : null);
  res.json({ data: { profileLocalId, note: note ?? null } });
}

export function handleRemoveWatchlist(req: Request, res: Response): void {
  const uid = currentUserId(req);
  if (!uid) {
    res.status(401).json({ error: "Unknown user" });
    return;
  }
  usersDb
    .prepare("DELETE FROM user_watchlist WHERE user_id = ? AND profile_local_id = ?")
    .run(uid, req.params.profileLocalId);
  res.json({ data: { removed: true } });
}

// ---- Saved views ------------------------------------------------------------
export function handleGetSavedViews(req: Request, res: Response): void {
  const uid = currentUserId(req);
  if (!uid) {
    res.status(401).json({ error: "Unknown user" });
    return;
  }
  const kind = typeof req.query.kind === "string" ? req.query.kind : null;
  const rows = (
    kind
      ? usersDb
          .prepare("SELECT * FROM user_saved_views WHERE user_id = ? AND kind = ? ORDER BY name")
          .all(uid, kind)
      : usersDb.prepare("SELECT * FROM user_saved_views WHERE user_id = ? ORDER BY name").all(uid)
  ) as SavedViewRow[];
  res.json({
    data: rows.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      filters: safeParse(r.filters_json),
      createdAt: r.created_at,
    })),
  });
}

export function handleAddSavedView(req: Request, res: Response): void {
  const uid = currentUserId(req);
  if (!uid) {
    res.status(401).json({ error: "Unknown user" });
    return;
  }
  const { name, kind, filters } = (req.body ?? {}) as {
    name?: string;
    kind?: string;
    filters?: unknown;
  };
  if (!name || typeof name !== "string" || !kind || typeof kind !== "string") {
    res.status(400).json({ error: "name and kind are required" });
    return;
  }
  const info = usersDb
    .prepare(
      "INSERT INTO user_saved_views (user_id, name, kind, filters_json) VALUES (?, ?, ?, ?)",
    )
    .run(uid, name.trim(), kind, JSON.stringify(filters ?? {}));
  res.json({ data: { id: Number(info.lastInsertRowid), name: name.trim(), kind, filters: filters ?? {} } });
}

export function handleDeleteSavedView(req: Request, res: Response): void {
  const uid = currentUserId(req);
  if (!uid) {
    res.status(401).json({ error: "Unknown user" });
    return;
  }
  // Scope the delete to the caller so one user can't delete another's view.
  const info = usersDb
    .prepare("DELETE FROM user_saved_views WHERE id = ? AND user_id = ?")
    .run(req.params.id, uid);
  if (info.changes === 0) {
    res.status(404).json({ error: "Saved view not found" });
    return;
  }
  res.json({ data: { removed: true } });
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}
