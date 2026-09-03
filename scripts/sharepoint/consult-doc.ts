// =============================================================================
// The Consultation Summary document
// =============================================================================
// Basic details of the consultee plus the note the attorney left, written into
// a CONSULT subfolder of their consult folder. The note is the point: it is the
// evidence the consultation actually took place and what was said.
//
// Roughly half of consultations that proceeded have no note recorded. Those
// still get a document — with the absence stated in place of the note, rather
// than a blank space that reads like an oversight or, worse, like nothing
// happened. See MISSING_NOTE below.
// =============================================================================

import { resolveConsultNote, type TimelineNote } from "./consult-note.js";

/** Monday stores status/dropdown values as { label } once synced. */
function label(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object" && "label" in value) {
    const inner = (value as { label?: unknown }).label;
    return typeof inner === "string" ? inner.trim() : "";
  }
  return "";
}

/** Shown where a value the firm does not hold would otherwise be blank. */
const UNKNOWN = "—";

/**
 * Stated plainly rather than left blank. A blank note section cannot be told
 * apart from a document that failed to render, and the two want very different
 * responses from whoever opens it.
 */
export const MISSING_NOTE =
  "No consultation note was recorded on the Monday.com profile for this consultation.";

export interface ConsultDocSources {
  profileName: string;
  /** profiles.raw_column_values, already parsed. */
  profile: Record<string, unknown>;
  /** The appointment item's column_values, already parsed. */
  appointment: Record<string, unknown>;
  /** Emails & Activities entries for this client, for the note fallbacks. */
  timeline?: TimelineNote[] | null;
  /** The appointment's status — the firm's own record of how the consult went. */
  apptStatus: string | null;
  consultDate: string | null;
  /** Injected so the output is deterministic in tests. */
  now?: Date;
}

/**
 * Build the {{tag}} values for templates/consult-summary.docx.
 *
 * Every tag is always present: docxtemplater renders a missing key as an empty
 * string, which would silently produce a document with unlabelled blanks.
 */
export function buildConsultDocVars(src: ConsultDocSources): Record<string, string> {
  const p = src.profile;
  const a = src.appointment;

  const text = (key: string): string => {
    const raw = p[key];
    return typeof raw === "string" && raw.trim() ? raw.trim() : "";
  };

  // No single place holds the note and there is no firm convention, so every
  // source is tried in order and the one used is recorded on the document.
  const resolved = resolveConsultNote({
    mConsultNote: label(a.m_consult_note),
    profileNotes: text("consultation_notes"),
    timeline: src.timeline,
    consultDate: src.consultDate,
  });

  // What the client wrote when booking through Calendly — the question the
  // attorney's note answers.
  const reason = label(a.description);

  return {
    client_name: src.profileName.trim() || UNKNOWN,
    date_of_birth: text("date_of_birth") || UNKNOWN,
    a_number: text("a_number") || UNKNOWN,
    country_of_birth: text("country_of_birth") || UNKNOWN,
    language: label(p.preferred_language) || UNKNOWN,
    email: text("email") || UNKNOWN,
    phone: text("phone") || UNKNOWN,
    address: text("physical_address") || text("mailing_address") || UNKNOWN,
    consult_date: src.consultDate ?? UNKNOWN,
    attorney: label(p.attorney) || UNKNOWN,
    consult_outcome: (src.apptStatus ?? "").trim() || UNKNOWN,
    reason_for_consult: reason || UNKNOWN,
    consult_note: resolved?.text ?? MISSING_NOTE,
    note_source: resolved?.label ?? "none found",
    generated_at: (src.now ?? new Date()).toISOString().slice(0, 16).replace("T", " ") + " UTC",
  };
}

/** True when the document is standing in for a note that does not exist yet. */
export function isAwaitingNote(vars: Record<string, string>): boolean {
  return vars.consult_note === MISSING_NOTE;
}

/**
 * File name for the summary. Deterministic, so a regeneration replaces the same
 * file rather than accumulating copies beside it.
 */
export function consultDocName(consultDate: string | null): string {
  return consultDate ? `Consultation Summary ${consultDate}.docx` : "Consultation Summary.docx";
}
