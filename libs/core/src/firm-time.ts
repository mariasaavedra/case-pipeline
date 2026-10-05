// =============================================================================
// Firm time — Monday stores a date column's time in UTC
// =============================================================================
// A Monday date column with a time keeps `{"date":"2026-10-05","time":"15:00:00"}`
// in UTC. Its display `text` is rendered in the timezone of whoever owns the API
// token — Rafael's account is set to America/Sao_Paulo, so a 10:00 AM Central
// consult read as "12:00". The sync therefore reads the UTC value and converts
// it to the firm's zone, and every write converts the other way.
//
// Central Time on both sides of DST: the conversion is done with Intl for the
// actual instant, never a fixed −5/−6 offset.
// =============================================================================

/** The firm operates in Central Time. Same value as apps/api's FIRM_TIMEZONE. */
export const FIRM_TIMEZONE = "America/Chicago";

export interface DateTime {
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM (24-hour) */
  time: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(\d{1,2}):(\d{2})(?::\d{2})?$/;

/** Wall-clock parts of an instant in a zone. */
function partsIn(instant: Date, timeZone: string): DateTime {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

function parse(date: string, time: string): { y: number; mo: number; d: number; h: number; mi: number } | null {
  const t = TIME_RE.exec(time.trim());
  if (!DATE_RE.test(date) || !t) return null;
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  return { y, mo, d, h: Number(t[1]), mi: Number(t[2]) };
}

/** Monday's stored UTC date + time → the firm's wall clock. Null when unparseable. */
export function utcToFirm(date: string, time: string, timeZone = FIRM_TIMEZONE): DateTime | null {
  const p = parse(date, time);
  if (!p) return null;
  return partsIn(new Date(Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi)), timeZone);
}

/**
 * The firm's wall clock → the UTC date + time Monday wants (time as HH:MM:SS).
 * Guess the instant as if the wall clock were UTC, see how far the zone's
 * reading is off, and correct once — twice when the first correction crosses a
 * DST change.
 */
export function firmToUtc(date: string, time: string, timeZone = FIRM_TIMEZONE): { date: string; time: string } | null {
  const p = parse(date, time);
  if (!p) return null;
  const wanted = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi);
  let instant = wanted;
  for (let i = 0; i < 2; i++) {
    const seen = partsIn(new Date(instant), timeZone);
    const q = parse(seen.date, seen.time)!;
    const diff = Date.UTC(q.y, q.mo - 1, q.d, q.h, q.mi) - wanted;
    if (diff === 0) break;
    instant -= diff;
  }
  const iso = new Date(instant).toISOString();
  return { date: iso.slice(0, 10), time: `${iso.slice(11, 16)}:00` };
}
