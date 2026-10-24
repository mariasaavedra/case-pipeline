// =============================================================================
// Buzón settings — Settings → Firm → Buzón (docs/features/buzon.md)
// =============================================================================
// Firm-wide: whether the first text with the link goes out on its own when a
// Fee K reaches "Paid needs action", whether reminders run and on which days,
// the hours texts may go out, and the "we received your documents" text.
// Each client can be switched off or given their own reminder days in M30
// (buzon_client_settings, client.ts).
//
// Stored in data/buzon-settings.json (same pattern as notify-settings.json).
// Reminders are OFF until an admin turns them on (decided 2026-10-23: staff set
// whether they run and how many days).
// =============================================================================

import fs from "node:fs";
import path from "node:path";

export interface BuzonSettings {
  /** Text the link on its own when a Fee K reaches Paid needs action (also needs BUZON_AUTO=on). */
  autoText: boolean;
  reminders: {
    on: boolean;
    /** Days after the first text, one reminder each: [3, 7, 14]. */
    days: number[];
    /** Firm time, whole hours: texts only go out from `fromHour` to before `toHour`. */
    fromHour: number;
    toHour: number;
    weekdaysOnly: boolean;
  };
  /** "We received your documents" after each batch (Phase 4). */
  receivedText: boolean;
}

export const DEFAULT_BUZON_SETTINGS: BuzonSettings = {
  autoText: true,
  reminders: { on: false, days: [3, 7, 14], fromHour: 9, toHour: 18, weekdaysOnly: true },
  receivedText: false,
};

export const MAX_REMINDERS = 6;
export const MAX_REMINDER_DAY = 90;

let configPath: string | null = null;

export function initBuzonSettings(dataDir: string): void {
  configPath = path.join(dataDir, "buzon-settings.json");
}

export function loadBuzonSettings(): BuzonSettings {
  if (!configPath) return structuredClone(DEFAULT_BUZON_SETTINGS);
  try {
    return sanitizeBuzonSettings(JSON.parse(fs.readFileSync(configPath, "utf-8")));
  } catch {
    return structuredClone(DEFAULT_BUZON_SETTINGS);
  }
}

export function saveBuzonSettings(input: unknown): BuzonSettings {
  if (!configPath) throw new Error("buzon-settings path not initialized");
  const clean = sanitizeBuzonSettings(input);
  fs.writeFileSync(configPath, JSON.stringify(clean, null, 2));
  return clean;
}

/** Reminder days: whole days 1–90, rising, no repeats, at most MAX_REMINDERS. */
export function sanitizeDays(input: unknown): number[] | null {
  if (!Array.isArray(input)) return null;
  const days = [...new Set(input.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= MAX_REMINDER_DAY))].sort((a, b) => a - b);
  return days.slice(0, MAX_REMINDERS);
}

const hour = (v: unknown, fallback: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 24 ? n : fallback;
};

export function sanitizeBuzonSettings(input: unknown): BuzonSettings {
  const d = DEFAULT_BUZON_SETTINGS;
  const o = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const r = (typeof o.reminders === "object" && o.reminders !== null ? o.reminders : {}) as Record<string, unknown>;
  let fromHour = hour(r.fromHour, d.reminders.fromHour);
  let toHour = hour(r.toHour, d.reminders.toHour);
  if (toHour <= fromHour) [fromHour, toHour] = [d.reminders.fromHour, d.reminders.toHour];
  const days = sanitizeDays(r.days);
  return {
    autoText: typeof o.autoText === "boolean" ? o.autoText : d.autoText,
    reminders: {
      on: r.on === true,
      days: days?.length ? days : [...d.reminders.days],
      fromHour,
      toHour,
      weekdaysOnly: typeof r.weekdaysOnly === "boolean" ? r.weekdaysOnly : d.reminders.weekdaysOnly,
    },
    receivedText: o.receivedText === true,
  };
}

/** BUZON_AUTO=on (+ BUZON_AUTO_SINCE) turns the automatic start on, like FEE_K_AUTOFILL. */
export function buzonAutoConfig(env: NodeJS.ProcessEnv = process.env): { since: string } | null {
  if (env.BUZON_AUTO?.trim().toLowerCase() !== "on") return null;
  const since = env.BUZON_AUTO_SINCE?.trim() ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(since) ? { since } : null;
}
