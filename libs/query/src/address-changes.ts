// =============================================================================
// Address Changes Query (P18)
// =============================================================================
// Open items on the Address Changes board, as a queue. The firm only files a
// change of address once it's paid (the board's status column is literally
// "Status - ONLY COMPLETE IF PAID"), so each item sits in one phase:
//   payment → firm (paid, our turn) → review (client signature / attorney) →
//   submitted (waiting for approval); "ON HOLD" aside.
// Aged from Date Received. When the change goes to the court, the client's next
// hearing is shown: a court that doesn't have the new address mails the hearing
// notice to the old one. See docs/features/address-changes.md.

import type BetterSqlite3 from "better-sqlite3";
type Database = BetterSqlite3.Database;
import type { WaitLevel } from "./prescheduling";

// =============================================================================
// Types
// =============================================================================

export type AddressChangePhase = "firm" | "review" | "submitted" | "payment" | "hold";

export type AddressChangeFlag = "no_with_who" | "no_new_address" | "no_date_received" | "stale_payment" | "no_profile";

export interface AddressChange {
  localId: string;
  itemName: string;
  clientName: string;
  clientLocalId: string | null;
  status: string | null;
  phase: AddressChangePhase;
  /** "COURT" / "USCIS" / "BOTH - COURT & USCIS" ("ADDY CHANGE W WHO?"). */
  withWho: string | null;
  /** Includes the immigration court (COURT or BOTH). */
  court: boolean;
  /** ECAS / Paper / E-service: from the item, else the court case's. */
  method: string | null;
  oldAddress: string | null;
  newAddress: string | null;
  assistant: string | null;
  receivedOn: string | null;
  /** Days since Date Received. */
  ageDays: number | null;
  ageLevel: WaitLevel;
  /** Next hearing on the client's active court case (court changes only). */
  hearingDate: string | null;
  daysToHearing: number | null;
  /** Court change, hearing within HEARING_SOON_DAYS, not submitted yet. */
  hearingSoon: boolean;
  flags: AddressChangeFlag[];
}

export interface AddressChangesResult {
  /** Open address changes, most pressing first. */
  items: AddressChange[];
  /** Every status label the board offers (for the status picker), in board order. */
  statusOptions: string[];
  /** Monday column ids, null when the board schema hasn't synced (writes hidden). */
  statusColumnId: string | null;
  dateSentColumnId: string | null;
  thresholds: typeof THRESHOLDS;
}

export interface AddressChangesOptions {
  /** ISO date to measure from (tests). Default today. */
  today?: string;
}

// =============================================================================
// Constants
// =============================================================================

/** Statuses that close an address change (it leaves the queue). */
export const ADDRESS_CHANGE_DONE = ["Sent Out", "Not Moving Forward", "Refund"];

const PHASE_OF_STATUS: Record<string, AddressChangePhase> = {
  "paid - needs address change": "firm",
  "needs address change": "firm",
  "print and send": "firm",
  court: "firm",
  "attorney approved": "firm",
  "form sent to client for signature": "review",
  "@lm please send to client for sig": "review",
  "sent for atty review": "review",
  "submitted- waiting for approval": "submitted",
  "logged - needs payment - address change": "payment",
  "waiting for payment": "payment",
  "on hold": "hold",
};

/** Days since received before an item turns amber / red, per phase. */
export const THRESHOLDS: Record<AddressChangePhase, { waitingDays: number; lateDays: number }> = {
  // Our turn: the court expects a change of address within 5 working days of a move.
  firm: { waitingDays: 7, lateDays: 14 },
  review: { waitingDays: 7, lateDays: 14 },
  submitted: { waitingDays: 30, lateDays: 60 },
  payment: { waitingDays: 30, lateDays: 60 },
  hold: { waitingDays: 30, lateDays: 60 },
};

/** Waiting for payment this long → a cleanup item, not a live one. */
export const STALE_PAYMENT_DAYS = 180;
export const HEARING_SOON_DAYS = 30;

export const STATUS_COLUMN_ID = "status";
export const DATE_SENT_COLUMN_ID = "date__1";

const PHASE_ORDER: Record<AddressChangePhase, number> = { firm: 0, review: 1, submitted: 2, payment: 3, hold: 4 };
const AGE_ORDER: Record<WaitLevel, number> = { late: 0, waiting: 1, fresh: 2, unknown: 3 };

// =============================================================================
// Helpers
// =============================================================================

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 86_400_000);
}

function label(raw: unknown): string | null {
  if (raw && typeof raw === "object" && "label" in raw) {
    const l = (raw as { label?: unknown }).label;
    return typeof l === "string" && l.trim() !== "" ? l.trim() : null;
  }
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;
}

function text(raw: unknown): string | null {
  if (typeof raw === "string") return raw.trim() || null;
  if (raw && typeof raw === "object" && "display_value" in raw) return text((raw as { display_value?: unknown }).display_value);
  return null;
}

function dateOf(raw: unknown): string | null {
  const d = raw && typeof raw === "object" ? (raw as { date?: unknown }).date : raw;
  return typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null;
}

/** First hearing on or after today, from Calendaring's "YYYY-MM-DD HH:MM, …" mirror or a date. */
export function nextHearing(raw: unknown, fallback: string | null, today: string): string | null {
  const found: string[] = [];
  if (typeof raw === "string") {
    for (const part of raw.split(",")) {
      const d = part.trim().slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) found.push(d);
    }
  } else {
    const d = dateOf(raw);
    if (d) found.push(d);
  }
  if (fallback && /^\d{4}-\d{2}-\d{2}/.test(fallback)) found.push(fallback.slice(0, 10));
  return found.filter((d) => d >= today).sort()[0] ?? null;
}

export function phaseOf(status: string | null): AddressChangePhase {
  // No status yet: logged but nothing decided, which is waiting on payment.
  return PHASE_OF_STATUS[(status ?? "").trim().toLowerCase()] ?? (status ? "firm" : "payment");
}

function ageLevelOf(phase: AddressChangePhase, ageDays: number | null): WaitLevel {
  if (ageDays === null) return "unknown";
  const t = THRESHOLDS[phase];
  return ageDays >= t.lateDays ? "late" : ageDays >= t.waitingDays ? "waiting" : "fresh";
}

// =============================================================================
// Query
// =============================================================================

interface RawRow {
  localId: string;
  name: string;
  status: string | null;
  clientLocalId: string | null;
  clientName: string | null;
  cv: string;
}

interface CaseRow {
  profileLocalId: string;
  nextDate: string | null;
  cv: string;
}

export function getAddressChanges(db: Database, options: AddressChangesOptions = {}): AddressChangesResult {
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const done = ADDRESS_CHANGE_DONE.map((s) => s.toLowerCase());

  const rows = db.prepare(`
    SELECT b.local_id AS localId, b.name, b.status,
           p.local_id AS clientLocalId, p.name AS clientName,
           b.column_values AS cv
    FROM board_items b
    LEFT JOIN profiles p ON p.local_id = b.profile_local_id
    WHERE b.board_key = 'address_changes' AND b.deleted_at IS NULL
      AND lower(coalesce(b.status, '')) NOT IN (${done.map(() => "?").join(",")})
  `).all(...done) as RawRow[];

  // The client's active court case, through the profile: the board's own Court
  // Cases link isn't reliably resolved, the profile link is.
  const profileIds = [...new Set(rows.map((r) => r.clientLocalId).filter((id): id is string => !!id))];
  const hearingByProfile = new Map<string, string>();
  const methodByProfile = new Map<string, string>();
  if (profileIds.length > 0) {
    const cases = db.prepare(`
      SELECT profile_local_id AS profileLocalId, next_date AS nextDate, column_values AS cv
      FROM board_items
      WHERE board_key = 'court_cases' AND group_title = 'Court Case' AND deleted_at IS NULL
        AND profile_local_id IN (${profileIds.map(() => "?").join(",")})
    `).all(...profileIds) as CaseRow[];
    for (const c of cases) {
      let cv: Record<string, unknown> = {};
      try {
        cv = JSON.parse(c.cv) as Record<string, unknown>;
      } catch {
        /* skip unreadable */
      }
      const h = nextHearing(cv.hearing_date_calendaring ?? cv.x_next_hearing_date, c.nextDate, today);
      const prev = hearingByProfile.get(c.profileLocalId);
      if (h && (!prev || h < prev)) hearingByProfile.set(c.profileLocalId, h);
      const m = label(cv.ecas_or_eservice);
      if (m && !methodByProfile.has(c.profileLocalId)) methodByProfile.set(c.profileLocalId, m);
    }
  }

  const items = rows.map((r): AddressChange => {
    let cv: Record<string, unknown> = {};
    try {
      cv = JSON.parse(r.cv) as Record<string, unknown>;
    } catch {
      /* unreadable row: show it with what the columns table has */
    }
    const status = r.status?.trim() || label(cv.status);
    const phase = phaseOf(status);
    const withWho = label(cv.court_or_uscis);
    const court = !withWho || /court/i.test(withWho);
    const receivedOn = dateOf(cv.date_received);
    const ageDays = receivedOn ? Math.max(0, daysBetween(receivedOn, today)) : null;
    const hearingDate = court && r.clientLocalId ? hearingByProfile.get(r.clientLocalId) ?? null : null;
    const daysToHearing = hearingDate ? daysBetween(today, hearingDate) : null;
    const newAddress = text(cv.new_addy);

    const flags: AddressChangeFlag[] = [];
    if (!withWho) flags.push("no_with_who");
    if (!newAddress && (phase === "firm" || phase === "review")) flags.push("no_new_address");
    if (!receivedOn) flags.push("no_date_received");
    if (phase === "payment" && ageDays !== null && ageDays >= STALE_PAYMENT_DAYS) flags.push("stale_payment");
    if (!r.clientLocalId) flags.push("no_profile");

    return {
      localId: r.localId,
      itemName: r.name,
      clientName: r.clientName ?? r.name,
      clientLocalId: r.clientLocalId,
      status,
      phase,
      withWho,
      court,
      method: label(cv.ecas_or_paper) ?? text(cv.ecas_or_paper_court_cases) ?? (r.clientLocalId ? methodByProfile.get(r.clientLocalId) ?? null : null),
      oldAddress: text(cv.old_addy),
      newAddress,
      assistant: label(cv.assistant),
      receivedOn,
      ageDays,
      ageLevel: ageLevelOf(phase, ageDays),
      hearingDate,
      daysToHearing,
      hearingSoon: phase !== "submitted" && daysToHearing !== null && daysToHearing <= HEARING_SOON_DAYS,
      flags,
    };
  });

  items.sort(
    (a, b) =>
      PHASE_ORDER[a.phase] - PHASE_ORDER[b.phase] ||
      Number(b.hearingSoon) - Number(a.hearingSoon) ||
      AGE_ORDER[a.ageLevel] - AGE_ORDER[b.ageLevel] ||
      (b.ageDays ?? -1) - (a.ageDays ?? -1) ||
      a.clientName.localeCompare(b.clientName),
  );

  const cols = db
    .prepare("SELECT column_id, options FROM board_columns WHERE board_key = 'address_changes' AND column_id IN (?, ?)")
    .all(STATUS_COLUMN_ID, DATE_SENT_COLUMN_ID) as { column_id: string; options: string | null }[];
  const statusCol = cols.find((c) => c.column_id === STATUS_COLUMN_ID);
  let statusOptions: string[] = [];
  try {
    statusOptions = (statusCol?.options ? (JSON.parse(statusCol.options) as { label?: unknown }[]) : [])
      .map((o) => (typeof o.label === "string" ? o.label.trim() : ""))
      .filter(Boolean);
  } catch {
    statusOptions = [];
  }

  return {
    items,
    statusOptions,
    statusColumnId: statusCol ? STATUS_COLUMN_ID : null,
    dateSentColumnId: cols.some((c) => c.column_id === DATE_SENT_COLUMN_ID) ? DATE_SENT_COLUMN_ID : null,
    thresholds: THRESHOLDS,
  };
}
