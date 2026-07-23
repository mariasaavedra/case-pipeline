// =============================================================================
// Shared types for the user-customization layer (users.db)
// =============================================================================
// Row shapes for the v4–v8 tables plus the preferences model and its validator.
// Validation is hand-rolled (a strict whitelist) to match the codebase's
// dependency-light style — no zod. The rule is the same as a schema: unknown
// keys and bad values are dropped, never trusted from the client.
// =============================================================================

import type { UserRow } from "./users-db.js";

// ---- Preferences (stored as prefs_json on user_preferences) ----------------

export type ThemePref = "light" | "dark" | "system";
export type DensityPref = "comfortable" | "compact";
export type DateFormatPref = "MM/DD/YYYY" | "DD/MM/YYYY" | "YYYY-MM-DD" | "relative";

/** Router paths a user may pick as their landing page. Keep in sync with router.ts. */
export const ALLOWED_DEFAULT_PAGES = [
  "/",
  "/clients",
  "/appointments",
  "/active-cases",
  "/my-cases",
  "/alerts",
] as const;
export type DefaultPage = (typeof ALLOWED_DEFAULT_PAGES)[number];

export interface Preferences {
  theme: ThemePref;
  defaultPage: DefaultPage;
  sidebarCollapsedDefault: boolean;
  dateFormat: DateFormatPref;
  density: DensityPref;
  /** Ordered list of visible KPI-card ids on the dashboard ([] = default order). */
  dashboardLayout: string[];
  /** Per-table visible column ids, keyed by table id. */
  columns: Record<string, string[]>;
  /**
   * Which board column each dashboard KPI card displays on its rows, keyed by
   * card key (e.g. { open_forms: "status" }). Overrides the firm-wide default in
   * data/kpi-columns.json; an absent key falls back to it.
   */
  kpiColumns: Record<string, string>;
}

export const DEFAULT_PREFERENCES: Preferences = {
  theme: "system",
  defaultPage: "/",
  sidebarCollapsedDefault: false,
  dateFormat: "MM/DD/YYYY",
  density: "comfortable",
  dashboardLayout: [],
  columns: {},
  kpiColumns: {},
};

const THEMES: ThemePref[] = ["light", "dark", "system"];
const DENSITIES: DensityPref[] = ["comfortable", "compact"];
const DATE_FORMATS: DateFormatPref[] = ["MM/DD/YYYY", "DD/MM/YYYY", "YYYY-MM-DD", "relative"];

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/**
 * Monday logical column keys and KPI card keys are both generated from
 * config/boards.yaml / the card registry, so they are always snake_case ASCII.
 * Anything else is a client that made something up.
 */
const KEY_PATTERN = /^[a-z0-9_]{1,64}$/;

/**
 * Validate a { cardKey: columnId } map from an untrusted source, dropping any
 * entry that isn't a plain snake_case pair. Shared by the per-user preference
 * and the firm-wide default in data/kpi-columns.json so both enforce one rule.
 */
export function sanitizeKpiColumns(input: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof input !== "object" || input === null || Array.isArray(input)) return out;
  for (const [cardKey, columnId] of Object.entries(input as Record<string, unknown>)) {
    if (!KEY_PATTERN.test(cardKey)) continue;
    if (typeof columnId !== "string" || !KEY_PATTERN.test(columnId)) continue;
    out[cardKey] = columnId;
  }
  return out;
}

/**
 * Validate an untrusted partial preferences object from the client, keeping only
 * known keys with valid values. Returns a clean patch to merge — never throws.
 */
export function sanitizePreferencesPatch(input: unknown): Partial<Preferences> {
  const out: Partial<Preferences> = {};
  if (typeof input !== "object" || input === null) return out;
  const o = input as Record<string, unknown>;

  if (typeof o.theme === "string" && THEMES.includes(o.theme as ThemePref)) {
    out.theme = o.theme as ThemePref;
  }
  if (typeof o.density === "string" && DENSITIES.includes(o.density as DensityPref)) {
    out.density = o.density as DensityPref;
  }
  if (
    typeof o.defaultPage === "string" &&
    (ALLOWED_DEFAULT_PAGES as readonly string[]).includes(o.defaultPage)
  ) {
    out.defaultPage = o.defaultPage as DefaultPage;
  }
  if (typeof o.sidebarCollapsedDefault === "boolean") {
    out.sidebarCollapsedDefault = o.sidebarCollapsedDefault;
  }
  if (typeof o.dateFormat === "string" && DATE_FORMATS.includes(o.dateFormat as DateFormatPref)) {
    out.dateFormat = o.dateFormat as DateFormatPref;
  }
  if (isStringArray(o.dashboardLayout)) {
    out.dashboardLayout = o.dashboardLayout;
  }
  if (typeof o.columns === "object" && o.columns !== null && !Array.isArray(o.columns)) {
    const cols: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(o.columns as Record<string, unknown>)) {
      if (isStringArray(v)) cols[k] = v;
    }
    out.columns = cols;
  }
  // Sent as a whole map, not per-key: mergePreferences replaces it outright, so
  // dropping a card key from the map is how a user clears their override.
  if (typeof o.kpiColumns === "object" && o.kpiColumns !== null && !Array.isArray(o.kpiColumns)) {
    out.kpiColumns = sanitizeKpiColumns(o.kpiColumns);
  }
  return out;
}

/** Merge a validated patch over current prefs (patch wins per-key). */
export function mergePreferences(current: Preferences, patch: Partial<Preferences>): Preferences {
  return { ...current, ...patch };
}

/** Parse a stored prefs_json blob, filling defaults for anything missing/invalid. */
export function parsePreferences(prefsJson: string | null | undefined): Preferences {
  if (!prefsJson) return { ...DEFAULT_PREFERENCES };
  try {
    return mergePreferences(DEFAULT_PREFERENCES, sanitizePreferencesPatch(JSON.parse(prefsJson)));
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

// ---- Row shapes for the 1:N tables -----------------------------------------

export interface SavedViewRow {
  id: number;
  user_id: number;
  name: string;
  kind: string;
  filters_json: string;
  created_at: string;
}

// NOTE: these key off monday_item_id, never profiles.local_id. local_id is
// regenerated by every full sync, so anything persisted here that referenced it
// would dangle overnight (see users-db.ts migration v9).

export interface WatchlistRow {
  id: number;
  user_id: number;
  monday_item_id: string;
  note: string | null;
  created_at: string;
}

export interface RecentlyViewedRow {
  id: number;
  user_id: number;
  monday_item_id: string;
  viewed_at: string;
}

export interface AuditLogRow {
  id: number;
  actor_user_id: number | null;
  actor_email: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata_json: string | null;
  created_at: string;
}

// ---- Public user shape (never expose the stored token to the client) -------

export type PublicUser = Omit<UserRow, "monday_access_token"> & { mondayConnected: boolean };

export function toPublicUser(row: UserRow): PublicUser {
  const { monday_access_token, ...rest } = row;
  return { ...rest, mondayConnected: !!monday_access_token };
}
