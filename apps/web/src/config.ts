// =============================================================================
// Dashboard Display Configuration
// =============================================================================
// Edit this file to control which boards appear, in what order, and how
// statuses are colored. No React code changes needed.

export interface BoardDisplayConfig {
  key: string;
  label: string;
  section: "cases" | "mail" | "admin";
}

export const BOARD_CONFIG: BoardDisplayConfig[] = [
  // Active cases
  { key: "court_cases",                 label: "Court Cases",              section: "cases" },
  { key: "_cd_open_forms",              label: "Open Forms",               section: "cases" },
  { key: "motions",                     label: "Motions",                  section: "cases" },
  { key: "appeals",                     label: "Appeals",                  section: "cases" },
  { key: "foias",                       label: "FOIAs",                    section: "cases" },
  { key: "litigation",                  label: "Litigation",               section: "cases" },
  { key: "_lt_i918b_s",                 label: "I-918B",                   section: "cases" },
  // Mail & documents
  { key: "rfes_all",                    label: "RFEs",                     section: "mail" },
  { key: "_na_originals_cards_notices",  label: "Originals/Cards/Notices",  section: "mail" },
  { key: "nvc_notices",                  label: "NVC Notices",              section: "mail" },
  { key: "address_changes",             label: "Address Changes",          section: "mail" },
  // Admin
  { key: "_fa_jail_intakes",            label: "Jail Intakes",             section: "admin" },
];

export const SECTION_LABELS: Record<string, string> = {
  cases: "Active Cases",
  mail: "Mail & Documents",
  admin: "Administrative",
};

export const SECTIONS = ["cases", "mail", "admin"] as const;

// =============================================================================
// Status translation — case-oriented labels + tone
// =============================================================================
// Monday statuses serve the daily workflow; this maps them into how a case READS.
// Two layers:
//   1. STATUS_OVERRIDES — curated per-status rules: rename and/or recolor. This
//      is the map a future admin editor manages (Phase 2); keeping it a plain
//      constant now means that phase just swaps the source, not the mechanism —
//      translateStatus() already takes the map as an argument.
//   2. inferTone — a keyword fallback for the long tail (100+ firm-specific
//      statuses). It reads obvious English meaning only, never invents workflow
//      semantics, and replaces the old "everything unknown = blue" default.

export type StatusTone = "green" | "blue" | "yellow" | "red" | "gray" | "purple";

/** All tones, for the admin editor's color picker. */
export const STATUS_TONES: StatusTone[] = ["green", "blue", "yellow", "red", "gray", "purple"];

export interface StatusRule {
  /** Display name; omit to keep the raw Monday label. */
  label?: string;
  tone: StatusTone;
}

export const STATUS_OVERRIDES: Record<string, StatusRule> = {
  // ---- Firm relabels (case-oriented) ----
  "Sent Out": { label: "Filed", tone: "green" },
  "918b Request pending": { label: "Pending", tone: "yellow" },
  "Create Project": { label: "Completed", tone: "green" }, // matches the contracts tab
  "Send to North Pole": { tone: "gray" }, // parked; keep the name
  "Interview done": { tone: "green" }, // keep the name
  // ---- Typo cleanups (display only) ----
  "Inverview going alone": { label: "Interview going alone", tone: "blue" },
  // ---- Explicit tones that keyword inference would otherwise get wrong ----
  Filed: { tone: "green" },
  "RFE Received": { tone: "red" },
  Received: { tone: "blue" },
  Completed: { tone: "green" },
  "Set for Hearing": { tone: "blue" },
};

/** Keyword → tone for statuses without an explicit override. Obvious meaning only. */
function inferTone(status: string): StatusTone {
  const s = status.toLowerCase();
  if (/(denied|reject|expired|removed|refus)/.test(s)) return "red";
  if (/(refund|not going forward|not proceeding|not hiring|withdrawn|cancel|to close|closed|declined)/.test(s)) return "gray";
  // Word boundaries on the short, false-positive-prone stems: \bsign avoids
  // "assigned"; \bpaid avoids "unpaid".
  if (/(sent out|filed|\bdone\b|approv|grant|\bsigned\b|submitted|complet|hired|\bpaid\b)/.test(s)) return "green";
  if (/(pending|waiting|scheduled|payment link|signature|needs|hold|to be|prep|review|follow up|request)/.test(s)) return "yellow";
  return "blue";
}

/** Case/whitespace-insensitive index of an override map, so "SENT OUT",
 *  "Sent out" and "Sent Out" all resolve to the same rule. */
function indexByKey(map: Record<string, StatusRule>): Record<string, StatusRule> {
  const out: Record<string, StatusRule> = {};
  for (const [k, v] of Object.entries(map)) out[k.toLowerCase().trim()] = v;
  return out;
}
const DEFAULT_INDEX = indexByKey(STATUS_OVERRIDES);

/**
 * Translate a raw Monday status into a case-oriented { label, tone }. Pass a
 * merged override map (base + admin config) once Phase 2 exists; defaults to the
 * code-seeded map today. Matching is case/whitespace-insensitive so the firm's
 * casing variants of the same status resolve identically.
 */
export function translateStatus(
  status: string | null,
  overrides: Record<string, StatusRule> = STATUS_OVERRIDES,
): { label: string; tone: StatusTone } {
  if (!status) return { label: "—", tone: "gray" };
  const index = overrides === STATUS_OVERRIDES ? DEFAULT_INDEX : indexByKey(overrides);
  const rule = index[status.toLowerCase().trim()];
  return { label: rule?.label ?? status, tone: rule?.tone ?? inferTone(status) };
}

export function getStatusColor(status: string | null): string {
  return translateStatus(status).tone;
}

const PRIORITY_COLORS: Record<string, string> = {
  High: "red",
  Medium: "yellow",
  Low: "green",
};

export function getPriorityColor(priority: string | null): string {
  if (!priority) return "gray";
  return PRIORITY_COLORS[priority] ?? "gray";
}

/** Board keys shown in the Documents & Notices tab */
export const DOCUMENT_BOARD_KEYS = new Set([
  "rfes_all",
  "_na_originals_cards_notices",
  "nvc_notices",
  "address_changes",
]);

// =============================================================================
// Monday.com deep links
// =============================================================================
// The account has its own subdomain — app.monday.com does NOT resolve to this
// account's context, which is why item links used to land nowhere useful.
// Confirmed from URLs Monday itself returns in the synced data
// (e.g. https://scaltheclinic.monday.com/users/32109226-michael-sharma-crawford).
export const MONDAY_ACCOUNT_URL = "https://scaltheclinic.monday.com";

/** Mirrors `profiles.id` in config/boards.yaml — keep the two in sync. */
export const MONDAY_PROFILES_BOARD_ID = "8025265377";

/** Canonical deep link to a Monday item ("pulse") on a board. */
export function mondayItemUrl(boardId: string, itemId: string): string {
  return `${MONDAY_ACCOUNT_URL}/boards/${boardId}/pulses/${itemId}`;
}
