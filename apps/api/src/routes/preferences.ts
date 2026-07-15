// =============================================================================
// User preferences — GET / PUT
// =============================================================================
// A single JSON blob per user (theme, density, default page, dashboard layout,
// column choices). PUT merges a validated patch, never clobbering fields the
// client didn't send.
// =============================================================================

import type { Request, Response } from "express";
import { usersDb } from "../db/users-db.js";
import { currentUserId } from "../db/user-context.js";
import {
  parsePreferences,
  sanitizePreferencesPatch,
  mergePreferences,
} from "../db/users-types.js";

const selectPrefs = usersDb.prepare("SELECT prefs_json FROM user_preferences WHERE user_id = ?");
const upsertPrefs = usersDb.prepare(`
  INSERT INTO user_preferences (user_id, prefs_json, updated_at)
  VALUES (?, ?, datetime('now'))
  ON CONFLICT(user_id) DO UPDATE SET prefs_json = excluded.prefs_json, updated_at = datetime('now')
`);

export function handleGetPreferences(req: Request, res: Response): void {
  const uid = currentUserId(req);
  if (!uid) {
    res.status(401).json({ error: "Unknown user" });
    return;
  }
  const row = selectPrefs.get(uid) as { prefs_json: string } | undefined;
  res.json({ data: parsePreferences(row?.prefs_json) });
}

export function handleUpdatePreferences(req: Request, res: Response): void {
  const uid = currentUserId(req);
  if (!uid) {
    res.status(401).json({ error: "Unknown user" });
    return;
  }
  const patch = sanitizePreferencesPatch(req.body);
  const row = selectPrefs.get(uid) as { prefs_json: string } | undefined;
  const merged = mergePreferences(parsePreferences(row?.prefs_json), patch);
  upsertPrefs.run(uid, JSON.stringify(merged));
  res.json({ data: merged });
}
