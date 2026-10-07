// =============================================================================
// P4 My Day — the page's rules, kept out of the component so they can be tested
// =============================================================================

import type { ConsultSummaryStart, MyDayEntry } from "../api";

/**
 * The quick-outcome buttons, in order (attorneys, 2026-10-07). Each board
 * spells a few differently ("Send G-Review Link"); a board without one simply
 * has no button for it. Every other status is in the status picker.
 */
export const OUTCOMES = ["Hire", "No Hire", "No Hire for Now", "Hold for Docs", "No Action Needed", "Send G-review link"] as const;

/** On a detainee consult, Hire / No Hire are recorded as their detained twins. */
const DETAINED_TWIN: Record<string, string> = { "hire": "Det Hire", "no hire": "Det No Hire" };

/**
 * Statuses that mean the attorney has recorded how the consult went. Anything
 * else on a consult that has started (Upcoming, Scheduled, Today's consult…,
 * Needs update by Atty) still needs an outcome.
 */
const DONE = new Set([
  ...OUTCOMES,
  "Det Hire", "Det No Hire", "Follow Up", "Cancelled/No Show", "Close File", "Discuss at Attorney Meeting",
  "Unable to move Forward", "Client Never Followed Up", "Refund", "REFUND COMPLETE", "REFUND COMPLETED",
  "Review Link sent", "Not Needed", "TPs - CANCELED",
].map((s) => s.toLowerCase()));

/**
 * Why this is a detainee consult, or null when it isn't: reception prepped it
 * as "Detained appt", the board marks it "Today's consult (detainee)", or the
 * client's open court case has a detention facility.
 */
export function detaineeReason(entry: Pick<MyDayEntry, "prep" | "status" | "detainedAt">): string | null {
  if (entry.prep?.apptType.startsWith("Detained appt")) {
    const where = entry.prep.apptType.split(" — ")[1];
    return where ? `Detained at ${where}` : "Prepped as a detained appt";
  }
  if (/detainee/i.test(entry.status ?? "")) return "Detainee consult";
  if (entry.detainedAt) return `Detained at ${entry.detainedAt}`;
  return null;
}

export function hasOutcome(status: string | null): boolean {
  return !!status && DONE.has(status.trim().toLowerCase());
}

/** "14:05" → "2:05 PM"; the parts apart for the big time column. */
export function formatTime(time: string | null): { clock: string; ampm: string; full: string } {
  if (!time) return { clock: "—", ampm: "", full: "No time" };
  const [hStr, mStr] = time.split(":");
  const h = parseInt(hStr ?? "0", 10);
  const m = (mStr ?? "00").slice(0, 2);
  const ampm = h >= 12 ? "PM" : "AM";
  const clock = `${h % 12 === 0 ? 12 : h % 12}:${m}`;
  return { clock, ampm, full: `${clock} ${ampm}` };
}

/** "Tuesday, October 7" — a calendar date, never shifted by a timezone. */
export function formatLongDate(ymd: string): string {
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", timeZone: "UTC",
  });
}

export function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Has this appointment started? Days before today: yes; after: no; today: by the clock ("HH:MM"). */
export function hasStarted(entry: Pick<MyDayEntry, "date" | "time">, today: string, now: string): boolean {
  if (!entry.date) return false;
  if (entry.date !== today) return entry.date < today;
  return !!entry.time && entry.time.slice(0, 5) <= now;
}

export type RowState = "done" | "needs-outcome" | "next" | "later";

/** Each row's tag: done, started without an outcome, the next one up, or later. */
export function rowStates(entries: MyDayEntry[], today: string, now: string): RowState[] {
  let nextGiven = false;
  return entries.map((e) => {
    if (hasOutcome(e.status)) return "done";
    if (hasStarted(e, today, now)) return "needs-outcome";
    if (!nextGiven && e.date === today) {
      nextGiven = true;
      return "next";
    }
    return "later";
  });
}

/** Where the "now" line goes: before the first appointment that hasn't started (today only). */
export function nowLineIndex(entries: MyDayEntry[], today: string, now: string): number {
  if (entries.length === 0 || entries[0]!.date !== today) return -1;
  const i = entries.findIndex((e) => !hasStarted(e, today, now));
  return i === -1 ? entries.length : i;
}

/** The appointment to open first: the next one up, else the first still needing an outcome, else the first. */
export function defaultSelection(entries: MyDayEntry[], states: RowState[]): string | null {
  const pick = states.indexOf("next") !== -1 ? states.indexOf("next") : states.indexOf("needs-outcome");
  return entries[pick === -1 ? 0 : pick]?.localId ?? null;
}

/** The outcome buttons as this board spells them; an outcome the board lacks is left out. */
export function outcomeLabels(boardLabels: string[], detained = false): string[] {
  const byLower = new Map(boardLabels.map((l) => [l.trim().toLowerCase(), l]));
  return OUTCOMES.map((o) => {
    const key = o.toLowerCase();
    const twin = detained ? DETAINED_TWIN[key] : undefined;
    return byLower.get((twin ?? o).toLowerCase());
  }).filter((l): l is string => !!l);
}

/**
 * P4's layout for the room the page has (its own width, sidebar excluded):
 *   wide   — day list | client | after the consult        (a laptop)
 *   medium — a narrow column of times | client | after    (a tablet)
 *   narrow — the day, then the client as its own screen  (a phone)
 * Unknown width (first paint, no ResizeObserver) is treated as wide.
 */
export type Layout = "wide" | "medium" | "narrow";
export const WIDE_MIN = 1100;
export const MEDIUM_MIN = 700;
export function layoutFor(width: number | null): Layout {
  if (width == null || width >= WIDE_MIN) return "wide";
  return width >= MEDIUM_MIN ? "medium" : "narrow";
}

/** The name the tablet's time column shows: the first word that isn't a title. */
export function firstName(name: string): string {
  const words = name.trim().split(/\s+/);
  return words.find((w) => !/^(mr|mrs|ms|miss|dr|sr|sra)\.?$/i.test(w)) ?? words[0] ?? "";
}

/** What the attorney is told about the post-consult process their note started. */
export function summaryLine(summary: ConsultSummaryStart | undefined): string | null {
  switch (summary) {
    case "started":
    case "already-running":
      return "The Consultation Summary is being written to the client's CONSULT folder in SharePoint.";
    case "failed":
      return "The Consultation Summary didn't start now; the scheduled consult sweep will write it.";
    default:
      return null; // switched off on this server, or an older API
  }
}

/** The badge on a document reception picked: its extension ("PDF", "DOCX"), else "FILE". */
export function fileKind(name: string): string {
  const m = /\.([a-z0-9]{1,5})$/i.exec(name.trim());
  return m ? m[1]!.toUpperCase() : "FILE";
}

/** "Prepped by Karla · Oct 6, 4:12 PM" — the prep's created_at is UTC from SQLite. */
export function prepStamp(at: string, author: string | null): string {
  const d = new Date(at.includes("T") ? at : `${at.replace(" ", "T")}Z`);
  const when = Number.isNaN(d.getTime())
    ? at
    : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return `Prepped${author ? ` by ${author}` : ""} · ${when}`;
}

export function isHttpUrl(s: string | null): s is string {
  return !!s && /^https?:\/\//i.test(s.trim());
}
