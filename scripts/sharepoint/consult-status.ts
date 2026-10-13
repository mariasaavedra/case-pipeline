// =============================================================================
// Did the consultation actually happen?
// =============================================================================
// A folder belongs to a consultation that TOOK PLACE. A cancellation or a
// no-show should leave nothing behind, and an appointment still in the future
// has nothing to file yet.
//
// The signal is the Status column on the Appointments boards (same column id on
// R, LB and M). It is not a proxy: "No Hire" means the consult happened and the
// person did not retain the firm — they still consulted, and that consultation
// has documents. Reading conversion (a contract, a case) as "did it happen"
// gets this exactly backwards and was the first mistake made here.
// =============================================================================

import { firmToUtc } from "../../libs/core/src/firm-time";

export type ConsultOutcome = "proceeded" | "not-yet" | "did-not-happen" | "unknown";

/** Statuses meaning the appointment is still ahead of us. */
const NOT_YET = new Set(["upcoming", "scheduled", "to be rescheduled"]);

/** Statuses meaning it will never happen — nothing to file. */
const DID_NOT_HAPPEN = new Set([
  "cancelled/no show",
  "canceled/no show",
  "tps - canceled",
  "tps - cancelled",
]);

/**
 * Classify an appointment's status.
 *
 * An unrecognised or empty status returns "unknown" rather than being assumed
 * to have happened: a new label somebody adds to the board must not silently
 * start creating folders.
 */
export function consultOutcome(status: string | null | undefined): ConsultOutcome {
  const key = (status ?? "").trim().toLowerCase();
  if (!key) return "unknown";
  if (DID_NOT_HAPPEN.has(key)) return "did-not-happen";
  if (NOT_YET.has(key)) return "not-yet";

  // "Today's consult (1st time)", "(detainee)", "(Follow Up)"… — it is happening
  // today, so the folder is wanted now rather than after the fact.
  if (key.startsWith("today's consult")) return "proceeded";

  return KNOWN_PROCEEDED.has(key) ? "proceeded" : "unknown";
}

/** Every label on the boards that means the consultation took place. */
const KNOWN_PROCEEDED = new Set([
  "past consult",
  "hire",
  "no hire",
  "det hire",
  "det no hire",
  "no hire for now",
  "refund",
  "refund completed",
  "hold for docs",
  "follow up",
  "close file",
  "discuss at attorney meeting",
  "needs update by atty",
  "no action needed",
  "unable to move forward",
  "interview prep",
  "court prep appt",
]);

/**
 * Whether the consultation is over, so its summary can be written.
 *
 * "Today's consult" counts as proceeding for the folder — the attorney needs
 * somewhere to put things during the meeting — but the meeting has not taken
 * place yet when the morning sweep runs. A summary written then is written
 * before the consult. So a today's-consult status waits for its scheduled time,
 * or, with no time, for the end of that day.
 *
 * `date` and `time` are the firm's wall clock (Central): the sync converts
 * Monday's UTC value on the way in (scripts/sync/mapper.ts, firm-time.ts).
 */
export function consultHasTakenPlace(
  status: string | null | undefined,
  date: string | null | undefined,
  time: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (consultOutcome(status) !== "proceeded") return false;
  if (!(status ?? "").trim().toLowerCase().startsWith("today's consult")) return true;
  if (!date) return false;
  const at = firmToUtc(date, time?.trim() || "23:59");
  if (!at) return false;
  return now.getTime() >= Date.parse(`${at.date}T${at.time}Z`);
}
