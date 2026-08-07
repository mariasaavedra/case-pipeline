// =============================================================================
// Timeline period → date range
// =============================================================================
// The date arithmetic behind the Overview timeline's period chips, kept out of
// the component so it can be tested without a DOM (the web test environment is
// plain node).
//
// Dates are plain `YYYY-MM-DD` in the user's LOCAL calendar — a chip that says
// "30 days" should mean 30 days as the person reading it counts them. The
// server compares those strings against UTC timestamps, so an entry made late
// at night can land on the neighbouring day. That imprecision is deliberate:
// the alternative is storing a timezone per entry to make a filter chip one
// hour more accurate.
// =============================================================================

/** Named periods, plus `custom`, which defers to an explicit from/to range. */
export type TimelinePeriod = "all" | "30d" | "90d" | "12m" | "custom";

export interface DateRange {
  from?: string; // YYYY-MM-DD
  to?: string;   // YYYY-MM-DD
}

/** Days back for each named period. `null` means unbounded. */
export const PERIOD_DAYS: Record<Exclude<TimelinePeriod, "custom">, number | null> = {
  all: null,
  "30d": 30,
  "90d": 90,
  "12m": 365,
};

/** Local-calendar `YYYY-MM-DD` (not `toISOString`, which shifts to UTC). */
export function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Resolve a period to the range the server should filter on. A named period is
 * an open-ended "since N days ago" — no upper bound, so an entry dated slightly
 * in the future (a scheduled appointment note) is never hidden by the period
 * chip. `custom` passes the explicit range through untouched.
 */
export function resolveRange(
  period: TimelinePeriod,
  custom: DateRange,
  now: Date = new Date(),
): DateRange {
  if (period === "custom") return custom;
  const days = PERIOD_DAYS[period];
  if (days == null) return {};
  const from = new Date(now);
  from.setDate(from.getDate() - days);
  return { from: toYmd(from) };
}

/** "Mar 1 – Mar 31" style label for the custom-range chip. */
export function rangeLabel(r: DateRange): string {
  const fmt = (ymd: string) =>
    // Parsed as local midnight, so the label reads back the date the user
    // picked rather than the day before in western timezones.
    new Date(`${ymd}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (r.from && r.to) return `${fmt(r.from)} – ${fmt(r.to)}`;
  if (r.from) return `Since ${fmt(r.from)}`;
  if (r.to) return `Until ${fmt(r.to)}`;
  return "Range…";
}
