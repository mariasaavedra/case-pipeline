// =============================================================================
// Urgency settings — firm-wide, admin-editable
// =============================================================================
// Controls how the Active Cases board scores urgency:
//   - criticalDays / soonDays: the date thresholds (a target within N days is
//     "critical" / "soon"). Previously hardcoded 3 / 7; now editable.
//   - statusUrgencyAffectsBoard: when true, a status's own urgency (set in the
//     Status Tags editor) combines with the date urgency — most urgent wins —
//     and reorders the board. When false, status urgency is a visual indicator
//     only and the board stays date-driven.
//
// Stored in data/urgency-settings.json. Readable by any authed user; writable
// only by admins.
// =============================================================================

import fs from "node:fs";
import path from "node:path";

export interface UrgencySettings {
  criticalDays: number;
  soonDays: number;
  statusUrgencyAffectsBoard: boolean;
}

export const DEFAULT_URGENCY_SETTINGS: UrgencySettings = {
  criticalDays: 3,
  soonDays: 7,
  statusUrgencyAffectsBoard: true,
};

let configPath: string | null = null;

export function initUrgencySettings(dataDir: string): void {
  configPath = path.join(dataDir, "urgency-settings.json");
}

export function loadUrgencySettings(): UrgencySettings {
  if (!configPath) return { ...DEFAULT_URGENCY_SETTINGS };
  try {
    return sanitizeUrgencySettings(JSON.parse(fs.readFileSync(configPath, "utf-8")));
  } catch {
    return { ...DEFAULT_URGENCY_SETTINGS };
  }
}

export function saveUrgencySettings(input: unknown): UrgencySettings {
  if (!configPath) throw new Error("urgency-settings path not initialized");
  const clean = sanitizeUrgencySettings(input);
  fs.writeFileSync(configPath, JSON.stringify(clean, null, 2));
  return clean;
}

/**
 * Coerce untrusted input into valid settings, falling back to defaults per field.
 * soonDays is clamped to be at least criticalDays so the two thresholds can't
 * cross (a "soon" window narrower than "critical" would be meaningless).
 */
export function sanitizeUrgencySettings(input: unknown): UrgencySettings {
  const o = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const posInt = (v: unknown, fallback: number): number => {
    const n = typeof v === "number" ? Math.floor(v) : NaN;
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  const criticalDays = posInt(o.criticalDays, DEFAULT_URGENCY_SETTINGS.criticalDays);
  const soonDays = Math.max(criticalDays, posInt(o.soonDays, DEFAULT_URGENCY_SETTINGS.soonDays));
  const statusUrgencyAffectsBoard =
    typeof o.statusUrgencyAffectsBoard === "boolean"
      ? o.statusUrgencyAffectsBoard
      : DEFAULT_URGENCY_SETTINGS.statusUrgencyAffectsBoard;
  return { criticalDays, soonDays, statusUrgencyAffectsBoard };
}
