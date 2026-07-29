// =============================================================================
// Admin-editable status overrides
// =============================================================================
// Firm-wide overrides for how a Monday status READS in the case views: a display
// label and/or a tone (color), keyed by the raw status. Stored in
// data/status-overrides.json (like attorney-boards.json / kpi-columns.json) and
// merged over the code-seeded base map by the web's translateStatus.
//
// Readable by any authenticated user (the web needs it to render); writable only
// by admins, and audited.
// =============================================================================

import fs from "node:fs";
import path from "node:path";

/** Tones the web's StatusBadge knows how to paint. Keep in sync with config.ts. */
export const STATUS_TONES = ["green", "blue", "yellow", "red", "gray", "purple"] as const;
export type StatusTone = (typeof STATUS_TONES)[number];

export interface StatusRule {
  /** Display name; omitted/empty means keep the raw Monday label. */
  label?: string;
  tone: StatusTone;
}

export type StatusOverrides = Record<string, StatusRule>;

let configPath: string | null = null;

export function initStatusOverrides(dataDir: string): void {
  configPath = path.join(dataDir, "status-overrides.json");
}

export function loadStatusOverrides(): StatusOverrides {
  if (!configPath) return {};
  try {
    return sanitizeStatusOverrides(JSON.parse(fs.readFileSync(configPath, "utf-8")));
  } catch {
    return {};
  }
}

export function saveStatusOverrides(input: unknown): StatusOverrides {
  if (!configPath) throw new Error("status-overrides path not initialized");
  const clean = sanitizeStatusOverrides(input);
  fs.writeFileSync(configPath, JSON.stringify(clean, null, 2));
  return clean;
}

/**
 * Validate an untrusted { status: { label?, tone } } map: drop entries with a
 * non-string key, a bad tone, or a non-string label. A rule with only a raw
 * label (no real change) is kept — the admin may want to whitelist it — but an
 * entry that is neither a valid tone nor a label is dropped.
 */
export function sanitizeStatusOverrides(input: unknown): StatusOverrides {
  const out: StatusOverrides = {};
  if (typeof input !== "object" || input === null || Array.isArray(input)) return out;

  for (const [status, rawRule] of Object.entries(input as Record<string, unknown>)) {
    if (typeof status !== "string" || status.trim() === "") continue;
    if (typeof rawRule !== "object" || rawRule === null) continue;
    const r = rawRule as Record<string, unknown>;

    if (typeof r.tone !== "string" || !(STATUS_TONES as readonly string[]).includes(r.tone)) continue;
    const rule: StatusRule = { tone: r.tone as StatusTone };
    if (typeof r.label === "string" && r.label.trim() !== "") rule.label = r.label.trim();
    out[status] = rule;
  }
  return out;
}
