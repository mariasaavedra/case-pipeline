// =============================================================================
// U Visa Certifications (I-918B) — Alerts groups
// =============================================================================
// A signed I-918B (law-enforcement certification) has to be filed with the
// I-918 within 6 months of signing; after that the agency must sign a new one.
// The [LT] I918B's board records it, and the firm sets Expiration Date itself
// (about 5 months after signing, to leave a margin). Two alert groups:
//   1. I-918B Expiring (critical): signed, expiring within EXPIRY_LOOKAHEAD_DAYS
//      or expired up to EXPIRY_LOOKBACK_DAYS ago, and no U visa / I-918 Open
//      Form sent since it was signed.
//   2. I-918B Requests Pending (warning): asked the agency, still no signature
//      PENDING_DAYS+ after the hire date: follow up, or close it on Monday.
// These replace the board's generic `next_date` (the hire due date) in Overdue
// Deadlines, which kept alerting after the I-918 was filed.

import type BetterSqlite3 from "better-sqlite3";
type Database = BetterSqlite3.Database;
import type { AlertGroup, AlertItem } from "./types";

export const I918B_BOARD = "_lt_i918b_s";
/** The legal limit, used when the board has a signed date but no Expiration Date. */
export const CERTIFICATION_VALID_MONTHS = 6;
export const EXPIRY_LOOKAHEAD_DAYS = 45;
export const EXPIRY_LOOKBACK_DAYS = 60;
export const PENDING_DAYS = 90;

/** Statuses / groups that end the certification's story. */
const CLOSED = /not hiring|expired|agency did not sign|did not hire/i;
const PENDING = /request pending|to be requested/i;
/** An Open Forms row that is the U visa filing. */
const U_VISA_FORM = /u\s*-?\s*visa|i-?\s*918/i;
/** …and that has gone out. */
const FORM_SENT = /sent out/i;

interface Options {
  attorney?: string;
  /** ISO date to measure from (tests). Default today. */
  today?: string;
}

interface Row {
  localId: string;
  name: string;
  boardKey: string;
  status: string | null;
  groupTitle: string | null;
  clientName: string | null;
  clientLocalId: string | null;
  attorney: string | null;
  cv: string;
}

// =============================================================================
// Helpers
// =============================================================================

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function addMonths(iso: string, months: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((new Date(`${toIso}T00:00:00Z`).getTime() - new Date(`${fromIso}T00:00:00Z`).getTime()) / 86_400_000);
}

function dateOf(raw: unknown): string | null {
  const d = raw && typeof raw === "object" ? (raw as { date?: unknown }).date : raw;
  return typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null;
}

function formatShort(iso: string, today: string): string {
  const sameYear = iso.slice(0, 4) === today.slice(0, 4);
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  });
}

function parse(cv: string): Record<string, unknown> {
  try {
    return JSON.parse(cv) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function rows(db: Database, opts: Options): Row[] {
  return db
    .prepare(
      `SELECT bi.local_id AS localId, bi.name, bi.board_key AS boardKey, bi.status, bi.group_title AS groupTitle,
              p.name AS clientName, p.local_id AS clientLocalId, bi.attorney, bi.column_values AS cv
       FROM board_items bi
       LEFT JOIN profiles p ON p.local_id = bi.profile_local_id
       WHERE bi.board_key = ? AND bi.deleted_at IS NULL ${opts.attorney ? "AND bi.attorney = ?" : ""}`,
    )
    .all(I918B_BOARD, ...(opts.attorney ? [opts.attorney] : [])) as Row[];
}

/** Profiles whose U visa / I-918 Open Form went out on or after `since`, by profile. */
function uVisaSentOn(db: Database, profileIds: string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (profileIds.length === 0) return out;
  const forms = db
    .prepare(
      `SELECT profile_local_id AS profileLocalId, status, column_values AS cv
       FROM board_items
       WHERE board_key = '_cd_open_forms' AND deleted_at IS NULL
         AND profile_local_id IN (${profileIds.map(() => "?").join(",")})`,
    )
    .all(...profileIds) as { profileLocalId: string; status: string | null; cv: string }[];
  for (const f of forms) {
    const cv = parse(f.cv);
    const labels = (cv.forms && typeof cv.forms === "object" ? (cv.forms as { labels?: unknown }).labels : null) ?? [];
    const isUVisa = Array.isArray(labels) && labels.some((l) => typeof l === "string" && U_VISA_FORM.test(l));
    if (!isUVisa || !FORM_SENT.test(f.status ?? "")) continue;
    // No sent date: count it as sent (the status says so), dated far back.
    const sent = dateOf(cv.forms_sent_date) ?? "0000-00-00";
    out.set(f.profileLocalId, [...(out.get(f.profileLocalId) ?? []), sent]);
  }
  return out;
}

// =============================================================================
// Items
// =============================================================================

export function getI918bExpiringItems(db: Database, opts: Options = {}): AlertItem[] {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const from = addDays(today, -EXPIRY_LOOKBACK_DAYS);
  const to = addDays(today, EXPIRY_LOOKAHEAD_DAYS);

  const candidates = rows(db, opts).flatMap((r) => {
    if (CLOSED.test(r.status ?? "") || CLOSED.test(r.groupTitle ?? "")) return [];
    const cv = parse(r.cv);
    const signed = dateOf(cv.signed_date);
    const expires = dateOf(cv.expiration_date) ?? (signed ? addMonths(signed, CERTIFICATION_VALID_MONTHS) : null);
    if (!signed || !expires || expires < from || expires > to) return [];
    return [{ r, cv, signed, expires }];
  });

  const sent = uVisaSentOn(db, [...new Set(candidates.map((c) => c.r.clientLocalId).filter((id): id is string => !!id))]);

  const items: AlertItem[] = [];
  for (const { r, cv, signed, expires } of candidates) {
    // Filed: a U visa Open Form sent out since the certification was signed
    // (or with no sent date recorded).
    const filed = r.clientLocalId && (sent.get(r.clientLocalId) ?? []).some((d) => d === "0000-00-00" || d >= signed);
    if (filed) continue;

    const left = daysBetween(today, expires);
    const hireDue = dateOf(cv.due_date_for_u_visa_hire);
    const parts = [
      left < 0
        ? `I-918B expired ${formatShort(expires, today)} (signed ${formatShort(signed, today)}); a new one is needed`
        : `I-918B expires ${formatShort(expires, today)} (signed ${formatShort(signed, today)}); no I-918 sent yet`,
    ];
    if (hireDue && left >= 0) parts.push(hireDue < today ? `hire due ${formatShort(hireDue, today)} passed` : `hire due ${formatShort(hireDue, today)}`);
    if (/prescheduling/i.test(r.status ?? "")) parts.push("client hired (on Prescheduling)");

    const item: AlertItem = {
      localId: r.localId,
      name: r.name,
      boardKey: r.boardKey,
      status: r.status,
      clientName: r.clientName,
      clientLocalId: r.clientLocalId,
      attorney: r.attorney,
      date: expires,
      detail: parts.join(" · "),
    };
    if (left < 0) item.daysOverdue = -left;
    else item.daysLeft = left;
    items.push(item);
  }
  return items.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "") || a.name.localeCompare(b.name));
}

const nameKey = (name: string) => name.replace(/\(copy\)/i, "").replace(/\s+/g, " ").trim().toLowerCase();

export function getI918bPendingItems(db: Database, opts: Options = {}): AlertItem[] {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const all = rows(db, { today });
  // The board keeps a second row per client when the agency refused ("Agency
  // did not sign"), often without a profile, so match those by name.
  const refused = new Set(all.filter((r) => /agency did not sign/i.test(`${r.status ?? ""} ${r.groupTitle ?? ""}`)).map((r) => nameKey(r.name)));
  const items: AlertItem[] = [];
  for (const r of opts.attorney ? all.filter((x) => x.attorney === opts.attorney) : all) {
    if (!PENDING.test(r.status ?? "") && !PENDING.test(r.groupTitle ?? "")) continue;
    if (CLOSED.test(r.status ?? "")) continue;
    const cv = parse(r.cv);
    if (dateOf(cv.signed_date)) continue;
    const hired = dateOf(cv.hire_date_for_i918b_request);
    if (!hired) continue;
    const waiting = daysBetween(hired, today);
    if (waiting < PENDING_DAYS) continue;
    items.push({
      localId: r.localId,
      name: r.name,
      boardKey: r.boardKey,
      status: r.status,
      clientName: r.clientName,
      clientLocalId: r.clientLocalId,
      attorney: r.attorney,
      date: hired,
      detail: refused.has(nameKey(r.name))
        ? `Requested ${formatShort(hired, today)}; also listed under "Agency did not sign": close this one on Monday`
        : `Requested ${formatShort(hired, today)}, ${waiting} days without a signature: follow up with the agency, or close it on Monday`,
    });
  }
  // Oldest request first.
  return items.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "") || a.name.localeCompare(b.name));
}

// =============================================================================
// Groups
// =============================================================================

export function getI918bAlertGroups(db: Database, opts: Options = {}): AlertGroup[] {
  const expiring = getI918bExpiringItems(db, opts);
  const pending = getI918bPendingItems(db, opts);
  return [
    {
      severity: "critical",
      label: "I-918B Expiring",
      description: `Signed U visa certifications expiring within ${EXPIRY_LOOKAHEAD_DAYS} days (or expired in the last ${EXPIRY_LOOKBACK_DAYS}) with no I-918 sent`,
      count: expiring.length,
      items: expiring,
    },
    {
      severity: "warning",
      label: "I-918B Requests Pending",
      description: `Certification requested ${PENDING_DAYS}+ days ago, not signed yet`,
      count: pending.length,
      items: pending,
    },
  ];
}

export function countI918bAlerts(db: Database): number {
  return getI918bExpiringItems(db).length + getI918bPendingItems(db).length;
}
