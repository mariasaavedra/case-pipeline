// =============================================================================
// Finding the attorney's note for a consultation
// =============================================================================
// There is no single place a consult note lives, and no firm convention:
//
//   M Consult Note        a column, but only on Appointments M
//   Consultation Notes    a column on the profile
//   "Consult note"        an Emails & Activities entry — what most attorneys use
//   "Casenote"            what some use instead (Lucy and Rekha, among others)
//
// So rather than pretending a convention exists, every source is read in order
// of how explicitly it means "this is the consult note", and the one that was
// actually used is RECORDED on the document. A reader can then see whether they
// are looking at a note filed as a consult note or a general case note that
// happened to land on the right day.
//
// Coverage on live data, for the 1,200 consults that reached an outcome:
//   columns only                       51%
//   + Consult note activity            68%
//   + Casenote within 2 days           88%
//   + any Casenote ever                91%   ← rejected: noisy, +3%
//
// Casenotes carry filings, FedEx tracking and scheduling calls, so an unbounded
// search would put "EAD sent via Fedex, tracking 7723…" under a consult summary.
// =============================================================================

export type NoteSource =
  | "m-consult-note-column"
  | "profile-notes-column"
  | "consult-note-activity"
  | "casenote-activity";

/** One Emails & Activities entry, already narrowed to the relevant types. */
export interface TimelineNote {
  activityType: string;
  text: string;
  author: string | null;
  /** ISO date the entry was created, for the proximity check. */
  date: string | null;
}

export interface ResolvedNote {
  text: string;
  source: NoteSource;
  /** Shown on the document so the note's provenance travels with it. */
  label: string;
}

/**
 * How far from the consult date a timeline entry can be and still belong to it.
 *
 * A "Consult note" is nearly always written the same day — 514 of 574 are, and
 * ±7 days reaches 549. The bound is not about catching more, it is about NOT
 * stapling a 2021 consultation's note into a 2026 document for a client who has
 * consulted twice.
 */
export const CONSULT_NOTE_WINDOW_DAYS = 7;

/** Tighter, because a Casenote is only weak evidence of being about the consult. */
export const CASENOTE_WINDOW_DAYS = 2;

export interface NoteInput {
  /** The "M Consult Note" column, when the appointment is on Appointments M. */
  mConsultNote?: string | null;
  /** The profile's "Consultation Notes" column. */
  profileNotes?: string | null;
  timeline?: TimelineNote[] | null;
  consultDate?: string | null;
}

const clean = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

function daysBetween(a: string, b: string): number | null {
  const x = Date.parse(a);
  const y = Date.parse(b);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return Math.abs(x - y) / 86_400_000;
}

/** "30 Jun 2025" — short, unambiguous, and not locale-dependent. */
function shortDate(iso: string | null): string {
  if (!iso) return "undated";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "undated";
  return `${d.getUTCDate()} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * Pick the timeline entry of a given type that sits closest to the consult
 * date, within `windowDays`. Closest rather than first: a client with two
 * consultations has entries for both, and the nearer one is the right one.
 */
function nearestActivity(
  timeline: TimelineNote[],
  activityType: string,
  consultDate: string,
  windowDays: number,
): TimelineNote | null {
  let best: { note: TimelineNote; distance: number } | null = null;
  for (const note of timeline) {
    if (note.activityType.toLowerCase() !== activityType.toLowerCase()) continue;
    if (!clean(note.text)) continue;
    if (!note.date) continue;
    const distance = daysBetween(note.date, consultDate);
    if (distance === null || distance > windowDays) continue;
    if (!best || distance < best.distance) best = { note, distance };
  }
  return best?.note ?? null;
}

/**
 * Resolve the note for one consultation, or null when there is none to find.
 *
 * Order is by how explicitly each source means "the note for THIS consult".
 */
export function resolveConsultNote(input: NoteInput): ResolvedNote | null {
  const timeline = input.timeline ?? [];
  const consultDate = clean(input.consultDate);

  // 1. The M Consult Note column sits on THIS appointment item, so it can only
  //    be about this consultation.
  const m = clean(input.mConsultNote);
  if (m) {
    return { text: m, source: "m-consult-note-column", label: "M Consult Note column" };
  }

  // 2. A dated Consult note near this consultation beats the profile column,
  //    which is a single undated field on the client. 31 clients have consulted
  //    more than once; for them the column may describe a different visit, and
  //    presenting an old note as this one's is the kind of wrong nobody spots.
  const consultNote = consultDate
    ? nearestActivity(timeline, "Consult note", consultDate, CONSULT_NOTE_WINDOW_DAYS)
    : null;
  if (consultNote) {
    return {
      text: clean(consultNote.text),
      source: "consult-note-activity",
      label: `Consult note activity — ${shortDate(consultNote.date)}${consultNote.author ? `, ${consultNote.author}` : ""}`,
    };
  }

  // 3. The profile column: real, but undated and profile-level.
  const profile = clean(input.profileNotes);
  if (profile) {
    return {
      text: profile,
      source: "profile-notes-column",
      label: "Consultation Notes column on the profile (not dated to a specific consultation)",
    };
  }

  // 4. A Casenote, only if it sits right on the consultation.
  const casenote = consultDate
    ? nearestActivity(timeline, "Casenote", consultDate, CASENOTE_WINDOW_DAYS)
    : null;
  if (casenote) {
    return {
      text: clean(casenote.text),
      source: "casenote-activity",
      // Said plainly: this was not filed as a consult note, and the reader
      // should weigh it accordingly.
      label:
        `Casenote — ${shortDate(casenote.date)}${casenote.author ? `, ${casenote.author}` : ""}` +
        ` (not filed as a Consult note)`,
    };
  }

  return null;
}
