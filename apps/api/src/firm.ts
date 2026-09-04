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
export const FIRM_TIMEZONE = "America/Chicago";
