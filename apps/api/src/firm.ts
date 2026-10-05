// =============================================================================
// Firm-wide constants
// =============================================================================

/**
 * The firm operates in Central Time; the API container's own system clock does
 * not (Docker defaults to UTC, and nothing here sets TZ).
 *
 * Anything that stamps a wall-clock "now" onto firm data, or schedules work
 * against the working day, must name this zone explicitly rather than relying
 * on the process's local time. Both mistakes have been made here: a call
 * logged at 2:11pm Central landed on Monday's Date/Hour columns as 7:11pm, and
 * a consult sweep configured for "07:00–19:00" ran 02:30–14:30 Central.
 *
 * Named here rather than set as a container-wide `TZ` on purpose — `TZ` would
 * also move the sync, backup, and WAL-checkpoint jobs, and silently re-date
 * every unzoned `new Date()` in the codebase.
 */
export { FIRM_TIMEZONE } from "@case-pipeline/core";

import { firmToUtc } from "@case-pipeline/core";

/**
 * A Central date + "HH:MM" as the value of a Monday date column. Monday keeps
 * a date column's time in UTC, so a 10:00 AM consult is sent as 15:00 (16:00
 * in winter) — and can land on the next UTC day for a late-evening time.
 * See libs/core/src/firm-time.ts.
 */
export function mondayDateTime(date: string, time: string): { date: string; time: string } {
  const utc = firmToUtc(date, time);
  if (!utc) throw new Error(`Not a date/time: ${date} ${time}`);
  return utc;
}
