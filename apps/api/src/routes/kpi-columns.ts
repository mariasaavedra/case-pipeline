// =============================================================================
// Dashboard KPI display columns — firm-wide default + per-user override
// =============================================================================
// Which board column each KPI card shows on its rows is a two-layer setting:
//
//   1. a firm-wide default, stored in data/kpi-columns.json (admins write it),
//   2. a per-user override in preferences.kpiColumns (anyone writes their own).
//
// resolveKpiColumns() merges them for a request. The user layer wins per card
// key, so an admin changing the default never overwrites someone's own choice —
// it only moves the floor for everyone who hasn't picked.
// =============================================================================

import fs from "node:fs";
import path from "node:path";
import type { Request } from "express";
import { usersDb } from "../db/users-db.js";
import { currentUserId } from "../db/user-context.js";
import { parsePreferences, sanitizeKpiColumns } from "../db/users-types.js";

export type KpiColumnMap = Record<string, string>;

let configPath: string | null = null;

/** Called once at startup with the resolved data directory. */
export function initKpiColumns(dataDir: string): void {
  configPath = path.join(dataDir, "kpi-columns.json");
}

/** The firm-wide defaults. Missing or malformed file → no defaults, never a throw. */
export function loadGlobalKpiColumns(): KpiColumnMap {
  if (!configPath) return {};
  try {
    return sanitizeKpiColumns(JSON.parse(fs.readFileSync(configPath, "utf-8")));
  } catch {
    return {};
  }
}

export function saveGlobalKpiColumns(map: KpiColumnMap): KpiColumnMap {
  if (!configPath) throw new Error("KPI column config path not initialized");
  const clean = sanitizeKpiColumns(map);
  fs.writeFileSync(configPath, JSON.stringify(clean, null, 2));
  return clean;
}

const selectPrefs = usersDb.prepare("SELECT prefs_json FROM user_preferences WHERE user_id = ?");

/** Just this caller's overrides — empty for an unidentified or preference-less user. */
export function userKpiColumns(req: Request): KpiColumnMap {
  const uid = currentUserId(req);
  if (!uid) return {};
  const row = selectPrefs.get(uid) as { prefs_json: string } | undefined;
  return parsePreferences(row?.prefs_json).kpiColumns;
}

/** The effective per-card column for this request: user choice over firm default. */
export function resolveKpiColumns(req: Request): KpiColumnMap {
  return { ...loadGlobalKpiColumns(), ...userKpiColumns(req) };
}
