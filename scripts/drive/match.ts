// =============================================================================
// Matching an upload folder to its Monday appointment
// =============================================================================
// Attorney board + name + nearest consult date. The date and time on the Drive
// side are where the consult was booked when the folder was made; a reschedule
// moves the Monday item but leaves the old Drive branch behind (one client in
// October 2026 had four). So the date only chooses between appointments for
// the same person, it never rules one out on its own.
//
// Never guesses between two people. Two different profiles that both fit, at
// the same distance, is "ambiguous" and goes to a person.
// =============================================================================

import type { UploadContext } from "./folder-names.js";

export interface AppointmentRow {
  localId: string;
  mondayItemId: string | null;
  boardKey: string;
  /** Item name, e.g. "Yemil LOPEZ LEAL" or "Juan M. MACIAS ZAPATA [A206-485-453]". */
  name: string;
  firstName: string | null;
  lastName: string | null;
  consultDate: string | null;
  profileLocalId: string | null;
}

export type MatchResult =
  | { kind: "matched"; appointment: AppointmentRow; detail: string }
  | { kind: "unmatched"; detail: string }
  | { kind: "ambiguous"; detail: string };

/** Within this many days of the folder's date. Reschedules beyond it go to review. */
export const WINDOW_DAYS = 60;

/** Upper-case, accents off, punctuation to spaces: "Muñoz-Lopez" → ["MUNOZ", "LOPEZ"]. */
export function nameTokens(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ") // [A-number], (Det in Chase Co)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter(Boolean);
}

function appointmentTokens(a: AppointmentRow): Set<string> {
  return new Set([...nameTokens(a.name), ...nameTokens(a.firstName), ...nameTokens(a.lastName)]);
}

/** Every surname token and the first given-name token appear on the appointment. */
export function sameName(context: Pick<UploadContext, "surname" | "given">, a: AppointmentRow): boolean {
  const have = appointmentTokens(a);
  const surname = nameTokens(context.surname);
  const given = nameTokens(context.given)[0];
  return surname.length > 0 && !!given && have.has(given) && surname.every((t) => have.has(t));
}

function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}

export function matchUpload(context: UploadContext, appointments: AppointmentRow[]): MatchResult {
  const who = `${context.surname}, ${context.given}`;
  const fits = appointments
    .filter((a) => a.boardKey === context.boardKey && a.consultDate && sameName(context, a))
    .map((a) => ({ a, distance: daysBetween(a.consultDate!, context.date) }))
    .filter((f) => f.distance <= WINDOW_DAYS)
    .sort((x, y) => x.distance - y.distance);

  if (!fits.length) {
    return { kind: "unmatched", detail: `no ${context.boardKey} appointment for ${who} within ${WINDOW_DAYS} days of ${context.date}` };
  }

  const best = fits[0]!;
  const rivals = fits.filter((f) => f.distance === best.distance && f.a.profileLocalId !== best.a.profileLocalId);
  if (rivals.length) {
    return {
      kind: "ambiguous",
      detail: `${who}: ${[best, ...rivals].map((f) => `"${f.a.name}" ${f.a.consultDate}`).join(" | ")}`,
    };
  }
  if (!best.a.profileLocalId) {
    return { kind: "unmatched", detail: `"${best.a.name}" ${best.a.consultDate} is not linked to a profile` };
  }
  return {
    kind: "matched",
    appointment: best.a,
    detail: best.distance === 0 ? "same day" : `consult moved ${best.distance} day(s) from the folder's date`,
  };
}
