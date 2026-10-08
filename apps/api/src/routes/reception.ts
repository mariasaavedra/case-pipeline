// =============================================================================
// Reception — consult prep for the Receptionists page (P17 → M18)
// =============================================================================
// Receptionists prepare each consult before the attorney sees the client. The
// appointment already exists (Calendly or booked by staff); prepping it records
// the type of appointment, how it will happen (phone / Zoom / other), the
// documents the attorney should look at, and a description. One submit:
//
//   1. posts the prep note as an Update on the client's PROFILE,
//   2. posts the same note as an Update on the APPOINTMENT, pinned to the top,
//   3. logs it in the profile's Emails & Activities as a "Consult Prep Note"
//      (falls back to the existing "Consult note" type until that one exists),
//   4. writes edited fields back where they came from: the phone to the
//      profile's Phone column, the description to the appointment's
//      Description column — and a folder link typed in for a client that had
//      none to the profile's E-File / Consult File (empty columns only).
//      A DMS link (old CRM, "Has DMS?") goes to an empty profile DMS URL.
//
// Same rails as every other write: personal Monday token first, durable queue
// on outage, audit entry. A consult_preps row (schema v29) is what lets P17
// show "Prepped" without parsing notes.
//
// Documents are links (SharePoint files picked or uploaded in M19, plus the
// client's e-file folder). On save, each picked or uploaded file is also copied
// into the APPOINTMENT's Files column through POST …/files (reception,
// 2026-10-05: the attorney opens the appointment) — a separate call per file,
// because express.json() caps bodies at 100 KB.
//
// `parsePrepBody`, `prepNote` and `planPrepWriteBack` are pure, so the rules
// are tested without a database or a network (reception.test.ts).
// =============================================================================

import express from "express";
import type { Express } from "express";
import type BetterSqlite3 from "better-sqlite3";
type DatabaseInstance = BetterSqlite3.Database;
import { randomUUID } from "node:crypto";
import { requireAuth } from "../auth/middleware.js";
import { dataSource } from "../data-source/index.js";
import { withTokenFallback } from "../write-auth.js";
import type { WriteTokenOptions } from "../write-token.js";
import { enqueueWrite } from "../write-queue/processor.js";
import { auditFromReq } from "../audit/log.js";
import { getBoardColumnsFor } from "@case-pipeline/query";
import { fetchCustomActivities, MondayApiError } from "@case-pipeline/monday";
import type { CreateTimelineItemInput } from "@case-pipeline/monday";
import { activeBoardKeys, loadAttorneyBoards } from "../attorney-boards.js";
import { consultFolderName } from "@case-pipeline/core";
import { FIRM_TIMEZONE } from "../firm.js";

// -----------------------------------------------------------------------------
// The form
// -----------------------------------------------------------------------------

/** Type of appointment, in the order reception asked for them. */
export const APPT_TYPES = [
  "1st time",
  "Trial Prep",
  "Standard Follow up",
  "Initial Court follow up",
  "Detained appt",
  "Emergency consultation",
  "Other",
] as const;
export type ApptType = (typeof APPT_TYPES)[number];

/** How the consult will happen. */
export const PREP_METHODS = ["Phone", "Zoom", "Other"] as const;
export type PrepMethod = (typeof PREP_METHODS)[number];

/**
 * "Needs interpreter?" The office interprets Spanish (reception arranges it)
 * and Portuguese (Rafael, the only Portuguese speaker); for any other language
 * the client brings their own interpreter, whose language and contact are
 * noted when reception has them (optional, reception 2026-10-05).
 */
export const INTERPRETER_NEEDS = ["No", "Spanish", "Portuguese", "Other language"] as const;
export type InterpreterNeed = (typeof INTERPRETER_NEEDS)[number];
/** Who interprets, per office language — what the note says. */
export const OFFICE_INTERPRETERS: Record<"Spanish" | "Portuguese", string> = {
  Spanish: "office (reception arranges)",
  Portuguese: "office (Rafael)",
};

export interface PrepInterpreter {
  need: InterpreterNeed;
  /** The language, for "Other language" when given, else null. */
  language: string | null;
  /** The client's interpreter's name / phone / e-mail, for "Other language", else null. */
  contact: string | null;
}

export const PREP_DESCRIPTION_MAX = 5000;
export const PREP_OTHER_MAX = 200;
export const PREP_DOCUMENTS_MAX = 30;

export interface PrepDocument {
  name: string;
  url: string;
}

/** The two profile columns that hold a client's SharePoint folder. */
export const FOLDER_KINDS = ["e_file", "consult_file"] as const;
export type FolderKind = (typeof FOLDER_KINDS)[number];
export const FOLDER_LABELS: Record<FolderKind, string> = { e_file: "E-File folder", consult_file: "Consult folder" };
/** The profile column titles they live under on the Profiles board. */
const FOLDER_COLUMN_TITLES: Record<FolderKind, string> = { e_file: "e-file", consult_file: "consult file" };

export interface PrepFolderLink {
  kind: FolderKind;
  url: string;
  /**
   * The link reception saw on the profile and chose to change (M18 ⋯ menu),
   * else null. The column is overwritten only while it still holds this —
   * a link changed in Monday meanwhile is never clobbered.
   */
  replaces: string | null;
}

/**
 * DMS — the firm's old CRM, used for cases until 2024. A record's page is
 * `<base><case no. digits>` (case 21-164 → …/records/21164), which is also
 * what the profile's DMS URL column holds when set.
 */
export const DMS_RECORD_BASE = "https://sharmacrawford-cdb.innovationlawlab.org/records/";
export const DMS_URL_MAX = 500;

/** The DMS record link for a case number ("21-164", "DMS 24144" → digits), else null. */
export function dmsUrlFor(caseNo: string | null | undefined): string | null {
  const digits = (caseNo ?? "").replace(/\D/g, "");
  return digits ? `${DMS_RECORD_BASE}${digits}` : null;
}

/** A DMS link that points at a record (some profiles hold ".../records/" with no number). */
export function isDmsRecordUrl(u: string | null | undefined): boolean {
  return /\/records\/\d+/.test(u ?? "");
}

export interface PrepBody {
  apptType: ApptType;
  /** The "specify" text when apptType is Other, else null. */
  apptTypeOther: string | null;
  /** Where the client is detained when apptType is "Detained appt", else null. */
  detainedAt: string | null;
  method: PrepMethod;
  /** The number to call when method is Phone, else null. */
  phone: string | null;
  /** The meeting link when method is Zoom, else null. */
  zoomLink: string | null;
  /** The "specify" text when method is Other, else null. */
  methodOther: string | null;
  interpreter: PrepInterpreter;
  description: string;
  /**
   * A Calendly client's own words as corrected by reception, else null (left
   * as they were). Replaces the client's part of the Description; reception's
   * part stays below it.
   */
  clientWrote: string | null;
  documents: PrepDocument[];
  /** Folder links found, created or pasted in M18 — filling an empty column, or replacing one. */
  folderLinks: PrepFolderLink[];
  /** The client's DMS record when reception ticked "Has DMS?", else null. */
  dmsUrl: string | null;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const isHttpUrl = (v: string): boolean => {
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
};

/** Validate M18's body. Every refusal is a sentence a receptionist can act on. */
export function parsePrepBody(raw: unknown): { ok: true; body: PrepBody } | { ok: false; error: string } {
  const b = (raw ?? {}) as Record<string, unknown>;

  const apptType = APPT_TYPES.find((t) => t === str(b.apptType));
  if (!apptType) return { ok: false, error: "Pick the type of appointment" };
  const apptTypeOther = apptType === "Other" ? str(b.apptTypeOther) : "";
  if (apptType === "Other" && !apptTypeOther) return { ok: false, error: "Specify the type of appointment" };
  if (apptTypeOther.length > PREP_OTHER_MAX) return { ok: false, error: "The appointment type is too long" };
  const detainedAt = apptType === "Detained appt" ? str(b.detainedAt) : "";
  if (apptType === "Detained appt" && !detainedAt) return { ok: false, error: "Add where the client is detained" };
  if (detainedAt.length > PREP_OTHER_MAX) return { ok: false, error: "The detention place is too long" };

  const method = PREP_METHODS.find((m) => m === str(b.method));
  if (!method) return { ok: false, error: "Pick how the consult will happen" };
  const phone = method === "Phone" ? str(b.phone) : "";
  if (method === "Phone" && !/\d{3}/.test(phone)) return { ok: false, error: "Add the phone number to call" };
  if (phone.length > 50) return { ok: false, error: "The phone number is too long" };
  const zoomLink = method === "Zoom" ? str(b.zoomLink) : "";
  if (method === "Zoom" && !isHttpUrl(zoomLink)) return { ok: false, error: "Add the Zoom link (starting with https://)" };
  const methodOther = method === "Other" ? str(b.methodOther) : "";
  if (method === "Other" && !methodOther) return { ok: false, error: "Specify how the consult will happen" };
  if (methodOther.length > PREP_OTHER_MAX) return { ok: false, error: "The 'other' method is too long" };

  const rawInterp = (b.interpreter ?? {}) as Record<string, unknown>;
  const need = INTERPRETER_NEEDS.find((n) => n === str(rawInterp.need));
  if (!need) return { ok: false, error: "Pick whether the client needs an interpreter" };
  const interpLanguage = need === "Other language" ? str(rawInterp.language) : "";
  const interpContact = need === "Other language" ? str(rawInterp.contact) : "";
  if (interpLanguage.length > PREP_OTHER_MAX) return { ok: false, error: "The interpreter's language is too long" };
  if (interpContact.length > PREP_OTHER_MAX) return { ok: false, error: "The interpreter's contact is too long" };
  const interpreter: PrepInterpreter = { need, language: interpLanguage || null, contact: interpContact || null };

  const description = str(b.description);
  if (description.length > PREP_DESCRIPTION_MAX) {
    return { ok: false, error: `The description is too long (max ${PREP_DESCRIPTION_MAX} characters)` };
  }
  const clientWrote = str(b.clientWrote);
  if (clientWrote.length > PREP_DESCRIPTION_MAX) {
    return { ok: false, error: `What the client wrote is too long (max ${PREP_DESCRIPTION_MAX} characters)` };
  }

  const rawDocs = Array.isArray(b.documents) ? b.documents : [];
  if (rawDocs.length > PREP_DOCUMENTS_MAX) return { ok: false, error: `At most ${PREP_DOCUMENTS_MAX} documents` };
  const documents: PrepDocument[] = [];
  const seen = new Set<string>();
  for (const d of rawDocs) {
    const doc = (d ?? {}) as Record<string, unknown>;
    const url = str(doc.url);
    const name = str(doc.name) || url;
    if (!isHttpUrl(url)) return { ok: false, error: `"${name.slice(0, 60)}" is not a link` };
    if (seen.has(url)) continue;
    seen.add(url);
    documents.push({ name: name.slice(0, 200), url });
  }

  const rawFolders = Array.isArray(b.folderLinks) ? b.folderLinks : [];
  const folderLinks: PrepFolderLink[] = [];
  for (const f of rawFolders) {
    const link = (f ?? {}) as Record<string, unknown>;
    const kind = FOLDER_KINDS.find((k) => k === str(link.kind));
    const url = str(link.url);
    if (!kind) return { ok: false, error: "Unknown folder type" };
    if (folderLinks.some((x) => x.kind === kind)) continue;
    if (!isHttpUrl(url) || !/\.sharepoint\.com/i.test(new URL(url).hostname)) {
      return { ok: false, error: `The ${FOLDER_LABELS[kind]} must be a SharePoint link` };
    }
    const replaces = str(link.replaces);
    folderLinks.push({ kind, url, replaces: replaces || null });
    // It is also a document the attorney should open, listed first.
    if (!seen.has(url)) {
      seen.add(url);
      documents.unshift({ name: FOLDER_LABELS[kind], url });
    }
  }

  const dmsUrl = str(b.dmsUrl);
  if (dmsUrl && !isHttpUrl(dmsUrl)) return { ok: false, error: "The DMS link must start with https://" };
  if (dmsUrl.length > DMS_URL_MAX) return { ok: false, error: "The DMS link is too long" };

  return {
    ok: true,
    body: {
      apptType,
      apptTypeOther: apptTypeOther || null,
      detainedAt: detainedAt || null,
      method,
      phone: phone || null,
      zoomLink: zoomLink || null,
      methodOther: methodOther || null,
      interpreter,
      description,
      clientWrote: clientWrote || null,
      documents,
      folderLinks,
      dmsUrl: dmsUrl || null,
    },
  };
}

// -----------------------------------------------------------------------------
// The note
// -----------------------------------------------------------------------------

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function apptTypeLabel(b: PrepBody): string {
  if (b.apptType === "Other") return `Other — ${b.apptTypeOther}`;
  if (b.apptType === "Detained appt") return `Detained appt — ${b.detainedAt}`;
  return b.apptType;
}

/** "Spanish — office (reception arranges)", "Vietnamese — client brings their own (contact: …)". */
export function interpreterLabel(b: PrepBody): string {
  const i = b.interpreter;
  if (i.need === "No") return "Not needed";
  if (i.need === "Spanish" || i.need === "Portuguese") return `${i.need} — ${OFFICE_INTERPRETERS[i.need]}`;
  const lang = i.language ?? "Other language";
  return `${lang} — client brings their own${i.contact ? ` (contact: ${i.contact})` : ""}`;
}

export function methodLabel(b: PrepBody): string {
  if (b.method === "Phone") return `Phone — ${b.phone}`;
  if (b.method === "Zoom") return `Zoom — ${b.zoomLink}`;
  return `Other — ${b.methodOther}`;
}

/**
 * The prep note, from one source so its copies never drift:
 *
 *   Type of appt: 1st time
 *   How to proceed: Zoom — https://zoom.us/j/…
 *   Interpreter: Portuguese — office (Rafael)
 *   DMS: https://sharmacrawford-cdb.innovationlawlab.org/records/21164   (when ticked)
 *   Documents:
 *   • Consult folder                      (a link named after the document)
 *   Description: <description>
 *
 * No headline and no "Prepared by" (reception, 2026-10-02): Monday already
 * shows who posted it and when, and the consult's own date is on the
 * appointment. `html` is what goes to Monday — the Updates AND the E&A entry,
 * whose content Monday stores and renders as HTML (staff's own entries carry
 * `<a href>` links), so documents read as their name in blue. `text` is the
 * local timeline copy.
 */
/**
 * A Calendly booking's Description is the client's own words, and prep keeps
 * them (reception, 2026-10-05): reception's text goes below, after this mark,
 * and a second prep replaces only that part.
 */
export const RECEPTION_MARK = "\n\nReception: ";

/** Split a Description into the client's words and reception's part (after RECEPTION_MARK). */
export function splitDescription(d: string | null): { client: string; reception: string } {
  const s = (d ?? "").trim();
  const i = s.indexOf(RECEPTION_MARK);
  if (i === -1) return { client: s, reception: "" };
  return { client: s.slice(0, i).trim(), reception: s.slice(i + RECEPTION_MARK.length).trim() };
}

/** Booked through Calendly: its Calendly? column says yes, or its Consult UUID is a Calendly link. */
export function isFromCalendly(cv: Record<string, unknown>): boolean {
  return textOf(cv.calendly)?.toLowerCase() === "yes" || /calendly\.com/i.test(textOf(cv.consult_uuid) ?? "");
}

/**
 * The prep note. `clientWrote` is a Calendly client's own description, shown
 * above reception's so the attorney reads both.
 */
export function prepNote(b: PrepBody, opts: { clientWrote?: string | null } = {}): { text: string; html: string } {
  const text: string[] = [
    `Type of appt: ${apptTypeLabel(b)}`,
    `How to proceed: ${methodLabel(b)}`,
    `Interpreter: ${interpreterLabel(b)}`,
  ];
  if (b.dmsUrl) text.push(`DMS: ${b.dmsUrl}`);
  if (b.documents.length > 0) {
    text.push("Documents:", ...b.documents.map((d) => `• ${d.name} — ${d.url}`));
  }
  if (opts.clientWrote) text.push(`Client wrote: ${opts.clientWrote}`);
  if (b.description) text.push(`Description: ${b.description}`);

  const link = (url: string, label: string) =>
    `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
  const how =
    b.method === "Zoom" && b.zoomLink
      ? `Zoom — ${link(b.zoomLink, b.zoomLink)}`
      : escapeHtml(methodLabel(b));
  const html: string[] = [
    `<p><strong>Type of appt:</strong> ${escapeHtml(apptTypeLabel(b))}</p>`,
    `<p><strong>How to proceed:</strong> ${how}</p>`,
    `<p><strong>Interpreter:</strong> ${escapeHtml(interpreterLabel(b))}</p>`,
  ];
  if (b.dmsUrl) html.push(`<p><strong>DMS:</strong> ${link(b.dmsUrl, b.dmsUrl)}</p>`);
  if (b.documents.length > 0) {
    html.push(`<p><strong>Documents:</strong></p>`, ...b.documents.map((d) => `<p>• ${link(d.url, d.name)}</p>`));
  }
  if (opts.clientWrote) {
    html.push(`<p><strong>Client wrote:</strong> ${escapeHtml(opts.clientWrote).replace(/\n/g, "<br>")}</p>`);
  }
  if (b.description) {
    html.push(`<p><strong>Description:</strong> ${escapeHtml(b.description).replace(/\n/g, "<br>")}</p>`);
  }

  return { text: text.join("\n"), html: html.join("") };
}

/**
 * The E&A entry's title. Staff's own entries have none (Monday stores null),
 * so the prep note goes without one too. The API marks title as required,
 * though; if Monday refuses the blank one, the route retries once with
 * PREP_TITLE_FALLBACK, and an entry queued during an outage carries it.
 */
export const PREP_TITLE = "";
export const PREP_TITLE_FALLBACK = "Consult prep";

// -----------------------------------------------------------------------------
// Write-back of edited fields
// -----------------------------------------------------------------------------

export interface PrepWriteBackStep {
  target: "profile" | "appointment";
  field: "phone" | "description" | "dms_url" | FolderKind;
  columnId: string;
  value: string;
}

/**
 * Which pre-filled fields were edited, and where each goes back to — the place
 * it was pre-filled from. Phone: the profile's Phone column (only when the
 * consult is by phone, since that is the only time the field is shown).
 * Description: the appointment's Description column — for a Calendly booking
 * (`keepClient`) the client's own words stay, with reception's text below them
 * after RECEPTION_MARK (a re-prep replaces only that part); reception may also
 * correct the client's words (`clientWrote`), which then replace theirs.
 * Clearing a field is not a write-back: an empty box most likely means
 * "nothing to add", not "erase".
 * A folder link fills an EMPTY E-File / Consult File, or replaces the link
 * reception chose to change (`replaces`) — only while the column still holds
 * that link, so one set in Monday since the page loaded is never overwritten.
 * A DMS link goes to the profile's DMS URL when that is empty or points at no
 * record (".../records/" — some profiles hold that); a real one is never replaced.
 */
export function planPrepWriteBack(
  b: PrepBody,
  current: {
    profilePhone: string | null;
    appointmentDescription: string | null;
    profileFolders?: Partial<Record<FolderKind, string | null>>;
    profileDmsUrl?: string | null;
    /** Keep the client's words in the Description (a Calendly booking). */
    keepClient?: boolean;
  },
  columns: {
    profilePhone: string | null;
    appointmentDescription: string | null;
    profileFolders?: Partial<Record<FolderKind, string | null>>;
    profileDmsUrl?: string | null;
  },
): PrepWriteBackStep[] {
  const steps: PrepWriteBackStep[] = [];
  const same = (a: string | null, c: string | null) => (a ?? "").trim() === (c ?? "").trim();
  if (b.method === "Phone" && b.phone && columns.profilePhone && !same(b.phone, current.profilePhone)) {
    steps.push({ target: "profile", field: "phone", columnId: columns.profilePhone, value: b.phone });
  }
  const clientEdit = current.keepClient ? b.clientWrote : null;
  if ((b.description || clientEdit) && columns.appointmentDescription) {
    const now = current.keepClient ? splitDescription(current.appointmentDescription) : { client: "", reception: "" };
    const client = clientEdit || now.client;
    const reception = b.description || now.reception;
    const value = client && reception ? `${client}${RECEPTION_MARK}${reception}` : client || reception;
    if (!same(value, current.appointmentDescription)) {
      steps.push({ target: "appointment", field: "description", columnId: columns.appointmentDescription, value });
    }
  }
  // Scheme and trailing slash don't make a different link ("x.sharepoint.com/…" is stored bare).
  const link = (u: string | null | undefined) => (u ?? "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase();
  for (const f of b.folderLinks) {
    const columnId = columns.profileFolders?.[f.kind];
    const now = current.profileFolders?.[f.kind] ?? "";
    const free = !now.trim() || (f.replaces !== null && link(now) === link(f.replaces));
    if (columnId && free && link(now) !== link(f.url)) {
      steps.push({ target: "profile", field: f.kind, columnId, value: f.url });
    }
  }
  if (b.dmsUrl && columns.profileDmsUrl && !isDmsRecordUrl(current.profileDmsUrl) && link(current.profileDmsUrl) !== link(b.dmsUrl)) {
    steps.push({ target: "profile", field: "dms_url", columnId: columns.profileDmsUrl, value: b.dmsUrl });
  }
  return steps;
}

// -----------------------------------------------------------------------------
// Routes
// -----------------------------------------------------------------------------

/** The activity type reception asked for, looked up by name in Monday. */
export const CONSULT_PREP_ACTIVITY_NAME = "Consult Prep Note";
/**
 * "Consult note" — the existing E&A type booking already posts under
 * (appointment-write.ts). Used until someone creates "Consult Prep Note" in
 * Monday; after that the name lookup finds it with no release.
 */
export const CONSULT_NOTE_ACTIVITY_ID = "34b09f1c-3572-4590-85af-9635a09eddb8";

/** Largest file M18 may also copy into the appointment's Files column. */
export const PREP_FILE_MAX_BYTES = 25 * 1024 * 1024;

interface ConsultRow {
  localId: string;
  mondayItemId: string | null;
  boardKey: string;
  name: string;
  status: string | null;
  date: string | null;
  time: string | null;
  attorney: string | null;
  columnValues: string | null;
  profileLocalId: string | null;
  profileMondayId: string | null;
  profileName: string | null;
  profilePhone: string | null;
  profileRaw: string | null;
  prepAt: string | null;
  prepAuthor: string | null;
  prepApptType: string | null;
  prepMethod: string | null;
  prepPending: number | null;
  prepInterpNeed: string | null;
  prepInterpLanguage: string | null;
  detainedAt: string | null;
  driveFolder: string | null;
}

export interface ReceptionConsult {
  localId: string;
  mondayItemId: string | null;
  boardKey: string;
  /** The attorney's board badge (R, M, LB…). */
  board: string;
  name: string;
  status: string | null;
  date: string | null;
  time: string | null;
  attorney: string | null;
  language: string | null;
  fromCalendly: boolean;
  phone: string | null;
  description: string | null;
  description2: string | null;
  profile: {
    localId: string;
    name: string;
    phone: string | null;
    eFile: string | null;
    consultFile: string | null;
    /** Case No. ("21164") — builds the default DMS link. */
    caseNo: string | null;
    /** The profile's DMS URL column, as stored. */
    dmsUrl: string | null;
  } | null;
  lastPrep: {
    at: string; author: string | null; apptType: string; method: string; pending: boolean;
    /** The interpreter language from the prep ("Portuguese", "Vietnamese"), null when none was needed. */
    interpreter: string | null;
  } | null;
  /**
   * The client folder name the consult sweep would use ("ESTRADA, Silvia" under
   * initial "E"), so M19 can find or create it at the same path — or why the
   * names on the row can't be trusted to build one.
   */
  folderName: { ok: true; folder: string; initial: string } | { ok: false; detail: string };
  /** Det. Facility on the client's open court case — pre-fills "Detained appt". */
  detainedAt: string | null;
  /**
   * The Google Drive folder the client was sent to upload documents to: the
   * appointment's "Google Drive Folder" column, else the newest folder the
   * Drive intake job matched to it (drive_folders — before the next sync, or
   * on a board without the column).
   */
  driveFolder: string | null;
  /**
   * Other consults for the same client on the same day, on any active board —
   * usually one booking made twice (a Monday "Create Appt" / "Appt?" button
   * clicked on two boards). P17.2 flags them; nothing is merged or deleted.
   */
  sameDayCount: number;
}

/**
 * Who a consult is for, to spot two bookings of one client on one day: the
 * linked profile, else the item name without its "[Det …] [A…]" suffixes.
 */
function clientKey(c: { name: string; profile: { localId: string } | null }): string {
  if (c.profile) return `p:${c.profile.localId}`;
  return `n:${c.name.replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim().toLowerCase()}`;
}

function parseJson(s: string | null): Record<string, unknown> {
  if (!s) return {};
  try {
    const v = JSON.parse(s) as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** A column value as display text: plain string, or a status/dropdown `{label}`. */
function textOf(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (v && typeof v === "object" && "label" in v && typeof (v as { label: unknown }).label === "string") {
    return ((v as { label: string }).label).trim() || null;
  }
  return null;
}

/** A text column's value when it is an http(s) link (safe for an href), else null. */
function httpUrlOf(v: string | null): string | null {
  return v && /^https?:\/\/\S+$/i.test(v) ? v : null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Consults on the active attorney boards between two dates, with their latest prep. */
export function getReceptionConsults(
  db: DatabaseInstance,
  opts: { from: string; to: string; boardKeys: string[]; boardBadges: Map<string, string> },
): ReceptionConsult[] {
  if (opts.boardKeys.length === 0) return [];
  const rows = db
    .prepare(
      `SELECT bi.local_id AS localId, bi.monday_item_id AS mondayItemId, bi.board_key AS boardKey, bi.name,
              bi.status, bi.next_date AS date, bi.next_time AS time, bi.attorney, bi.column_values AS columnValues,
              p.local_id AS profileLocalId, p.monday_item_id AS profileMondayId, p.name AS profileName,
              p.phone AS profilePhone, p.raw_column_values AS profileRaw,
              cp.created_at AS prepAt, cp.author_name AS prepAuthor, cp.appt_type AS prepApptType,
              cp.method AS prepMethod, cp.pending AS prepPending,
              json_extract(cp.fields, '$.interpreter.need') AS prepInterpNeed,
              json_extract(cp.fields, '$.interpreter.language') AS prepInterpLanguage,
              -- Same rule as getOpenDetentions (P3.0's "Detained at …" pill):
              -- the newest open "Court Case" row with a Det. Facility.
              (SELECT json_extract(cc.column_values, '$.det_facility.label')
                 FROM board_items cc
                WHERE cc.profile_local_id = bi.profile_local_id
                  AND cc.board_key = 'court_cases'
                  AND cc.group_title = 'Court Case'
                  AND cc.deleted_at IS NULL
                  AND COALESCE(json_extract(cc.column_values, '$.det_facility.label'), '') <> ''
                ORDER BY COALESCE(cc.updated_at_source, cc.created_at) DESC
                LIMIT 1) AS detainedAt,
              (SELECT df.url FROM drive_folders df
                WHERE df.appointment_local_id = bi.local_id AND df.match_status = 'matched'
                ORDER BY df.drive_created_at DESC LIMIT 1) AS driveFolder
         FROM board_items bi
         LEFT JOIN profiles p ON p.local_id = bi.profile_local_id AND p.deleted_at IS NULL
         LEFT JOIN consult_preps cp ON cp.id = (
           SELECT id FROM consult_preps WHERE appointment_local_id = bi.local_id ORDER BY id DESC LIMIT 1
         )
        WHERE bi.board_key IN (${opts.boardKeys.map(() => "?").join(",")})
          AND bi.deleted_at IS NULL
          AND bi.next_date >= ? AND bi.next_date <= ?
        ORDER BY bi.next_date ASC, COALESCE(bi.next_time, '99:99') ASC, bi.name ASC`,
    )
    .all(...opts.boardKeys, opts.from, opts.to) as ConsultRow[];

  const consults = rows.map((r): ReceptionConsult => {
    const cv = parseJson(r.columnValues);
    const praw = parseJson(r.profileRaw);
    // The appointment's own First / Last Name first (what Calendly filled),
    // then the profile's — the same sources the sweep reads.
    const named = consultFolderName({
      firstName: textOf(cv.first_name) ?? textOf(praw.first_name),
      lastName: textOf(cv.last_name) ?? textOf(praw.last_name),
    });
    return {
      localId: r.localId,
      mondayItemId: r.mondayItemId,
      boardKey: r.boardKey,
      board: opts.boardBadges.get(r.boardKey) ?? r.boardKey,
      name: r.name,
      status: r.status,
      date: r.date,
      time: r.time,
      attorney: r.attorney,
      language: textOf(cv.language),
      fromCalendly: isFromCalendly(cv),
      phone: textOf(cv.phone),
      description: textOf(cv.description),
      description2: textOf(cv.description_2),
      profile: r.profileLocalId && r.profileName
        ? {
            localId: r.profileLocalId,
            name: r.profileName,
            phone: r.profilePhone,
            eFile: textOf(praw.e_file),
            consultFile: textOf(praw.consult_file),
            caseNo: textOf(praw.case_no),
            dmsUrl: textOf(praw.dms_url),
          }
        : null,
      lastPrep: r.prepAt
        ? {
            at: r.prepAt,
            author: r.prepAuthor,
            apptType: r.prepApptType ?? "",
            method: r.prepMethod ?? "",
            pending: r.prepPending === 1,
            interpreter: !r.prepInterpNeed || r.prepInterpNeed === "No"
              ? null
              : r.prepInterpNeed === "Other language" ? (r.prepInterpLanguage ?? "Other language") : r.prepInterpNeed,
          }
        : null,
      folderName: named.ok
        ? { ok: true, folder: named.name.folder, initial: named.name.initial }
        : { ok: false, detail: named.detail },
      detainedAt: r.profileLocalId ? r.detainedAt : null,
      driveFolder: httpUrlOf(textOf(cv.google_drive_folder)) ?? r.driveFolder,
      sameDayCount: 0,
    };
  });

  const perDay = new Map<string, number>();
  const dayKey = (c: ReceptionConsult) => `${c.date}|${clientKey(c)}`;
  for (const c of consults) perDay.set(dayKey(c), (perDay.get(dayKey(c)) ?? 0) + 1);
  for (const c of consults) c.sameDayCount = perDay.get(dayKey(c))! - 1;
  return consults;
}

/**
 * The detention centers reception picks from for a "Detained appt": the
 * Det. Facility labels on the Court Cases board, as synced — a facility added
 * in Monday shows up here with no release. "Other" (free text) is the form's.
 */
export function getDetentionFacilities(db: DatabaseInstance): string[] {
  const col = getBoardColumnsFor(db, "court_cases")?.columns.find((c) => c.title.trim().toLowerCase() === "det. facility");
  const labels = (col?.options ?? []).map((o) => o.label.trim()).filter(Boolean);
  return [...new Set(labels)].sort((a, b) => a.localeCompare(b));
}

export interface ReceptionDeps {
  db: DatabaseInstance;
  mondayApiToken: string | undefined;
  writeTokenOptions: WriteTokenOptions;
}

export function registerReceptionRoutes(app: Express, deps: ReceptionDeps): void {
  const { db, mondayApiToken: MONDAY_API_TOKEN, writeTokenOptions } = deps;

  /** "Consult Prep Note" by name once it exists, cached; "Consult note" until then. */
  let activityCache: { id: string; at: number } | null = null;
  const ACTIVITY_TTL_MS = 30 * 60 * 1000;
  async function prepActivityId(): Promise<string> {
    if (activityCache && Date.now() - activityCache.at < ACTIVITY_TTL_MS) return activityCache.id;
    let id = CONSULT_NOTE_ACTIVITY_ID;
    try {
      const all = await fetchCustomActivities(MONDAY_API_TOKEN);
      const wanted = CONSULT_PREP_ACTIVITY_NAME.toLowerCase();
      for (const [actId, name] of all) {
        if (name.trim().toLowerCase() === wanted) id = actId;
      }
    } catch (err) {
      console.error("[reception] could not list E&A activity types; using Consult note:", err);
    }
    activityCache = { id, at: Date.now() };
    return id;
  }

  // Consults between ?from and ?to (YYYY-MM-DD, inclusive). Defaults: today
  // through 7 days out, in the firm's timezone.
  app.get("/api/reception/consults", requireAuth, (req, res) => {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: FIRM_TIMEZONE });
    const from = typeof req.query.from === "string" && DATE_RE.test(req.query.from) ? req.query.from : today;
    const toRaw = typeof req.query.to === "string" && DATE_RE.test(req.query.to) ? req.query.to : addDays(from, 7);
    // A bounded window: the list is a work queue, not an archive.
    const to = toRaw < from ? from : toRaw > addDays(from, 62) ? addDays(from, 62) : toRaw;
    const boards = loadAttorneyBoards();
    const consults = getReceptionConsults(db, {
      from,
      to,
      boardKeys: activeBoardKeys(),
      boardBadges: new Map(boards.map((b) => [b.boardKey, b.displayName])),
    });
    res.json({ data: { from, to, today, consults, detentionFacilities: getDetentionFacilities(db) } });
  });

  app.post("/api/reception/consults/:localId/prep", requireAuth, async (req, res) => {
    if (!MONDAY_API_TOKEN) {
      res.status(503).json({ error: "Monday.com write-back not configured (MONDAY_API_TOKEN missing)" });
      return;
    }
    const parsed = parsePrepBody(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const prep = parsed.body;
    const localId = String(req.params.localId);

    const appt = db
      .prepare(
        `SELECT bi.local_id AS localId, bi.monday_item_id AS mondayItemId, bi.board_key AS boardKey,
                bi.next_date AS date, bi.next_time AS time, bi.attorney, bi.column_values AS columnValues,
                p.local_id AS profileLocalId, p.monday_item_id AS profileMondayId, p.batch_id AS batchId,
                p.phone AS profilePhone, p.raw_column_values AS profileRaw
           FROM board_items bi
           LEFT JOIN profiles p ON p.local_id = bi.profile_local_id AND p.deleted_at IS NULL
          WHERE bi.local_id = ? AND bi.deleted_at IS NULL`,
      )
      .get(localId) as
      | {
          localId: string; mondayItemId: string | null; boardKey: string; date: string | null; time: string | null;
          attorney: string | null; columnValues: string | null; profileLocalId: string | null;
          profileMondayId: string | null; batchId: number | null; profilePhone: string | null;
          profileRaw: string | null;
        }
      | undefined;
    if (!appt || !appt.boardKey.startsWith("appointments")) {
      res.status(404).json({ error: "Appointment not found" });
      return;
    }
    if (!appt.mondayItemId) {
      res.status(400).json({ error: "This appointment has no Monday.com item ID" });
      return;
    }
    if (!appt.profileLocalId || !appt.profileMondayId) {
      res.status(409).json({ error: "This appointment is not linked to a client profile in Monday — link it first" });
      return;
    }
    const apptMondayId = appt.mondayItemId;
    const profileMondayId = appt.profileMondayId;
    const profileLocalId = appt.profileLocalId;

    const author = req.user?.name ?? req.user?.preferred_username ?? "Staff";
    const authorOid = req.user?.oid ?? null;
    // A Calendly client's own words stay in the Description and lead the note.
    const apptCv = parseJson(appt.columnValues);
    const keepClient = isFromCalendly(apptCv);
    const clientWrote = keepClient ? prep.clientWrote || splitDescription(textOf(apptCv.description)).client || null : null;
    const note = prepNote(prep, { clientWrote });

    let pending = false;
    const failures: string[] = [];
    const queue = (what: string, input: Parameters<typeof enqueueWrite>[1], err: unknown) => {
      console.error(`[reception] ${what} failed; queueing for retry:`, err);
      pending = true;
      failures.push(what);
      enqueueWrite(db, input);
    };

    // 1. Update on the profile — and a local copy so the timeline shows it now.
    try {
      const posted = await withTokenFallback(
        (token) => dataSource.postUpdate(profileMondayId, note.html, token),
        writeTokenOptions(req),
      );
      db.prepare(`
        INSERT OR IGNORE INTO client_updates
          (batch_id, local_id, monday_update_id, profile_local_id, board_item_local_id,
           board_key, author_name, author_email, text_body, body_html, source_type,
           reply_to_update_id, created_at_source, sync_status)
        VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, 'update', NULL, ?, 'synced')
      `).run(
        appt.batchId ?? null, randomUUID(), posted.result, profileLocalId,
        author, req.user?.email ?? null, note.text, note.html, new Date().toISOString(),
      );
    } catch (err) {
      queue("profile update", {
        opType: "create_update", targetTable: "profiles", targetLocalId: profileLocalId,
        mondayItemId: profileMondayId, authorOid, payload: { body: note.html },
      }, err);
    }

    // 2. Update on the appointment, pinned. A failed pin is cosmetic — the
    //    note is there either way — so it is logged, never queued.
    try {
      const posted = await withTokenFallback(
        (token) => dataSource.postUpdate(apptMondayId, note.html, token),
        writeTokenOptions(req),
      );
      try {
        await withTokenFallback((token) => dataSource.pinUpdate(posted.result, apptMondayId, token), writeTokenOptions(req));
      } catch (err) {
        console.error("[reception] pinning the prep note failed (note is posted):", err);
      }
    } catch (err) {
      queue("appointment update", {
        opType: "create_update", targetTable: "board_items", targetLocalId: appt.localId,
        mondayItemId: apptMondayId, authorOid, payload: { body: note.html },
      }, err);
    }

    // 3. Emails & Activities on the profile — HTML content, so documents are
    //    named links. No title, like staff's own entries (see PREP_TITLE).
    const activity: CreateTimelineItemInput = {
      itemId: profileMondayId,
      title: PREP_TITLE,
      customActivityId: await prepActivityId(),
      content: note.html,
    };
    const postActivity = (input: CreateTimelineItemInput) =>
      withTokenFallback((token) => dataSource.createTimelineItem(input, token), writeTokenOptions(req));
    try {
      try {
        await postActivity(activity);
      } catch (err) {
        // Monday refusing the request itself (not an outage) is most likely the
        // blank title on a non-null argument: try once more with one.
        if (!(err instanceof MondayApiError) || err.retryable) throw err;
        console.warn("[reception] E&A entry refused with a blank title; retrying with one:", err.message);
        await postActivity({ ...activity, title: PREP_TITLE_FALLBACK });
      }
    } catch (err) {
      // Queued with a title, so a retry can't fail on that again.
      queue("E&A entry", {
        opType: "create_timeline_item", targetTable: "profiles", targetLocalId: profileLocalId,
        mondayItemId: profileMondayId, authorOid, payload: { ...activity, title: PREP_TITLE_FALLBACK },
      }, err);
    }

    // 4. Edited fields back to where they came from.
    const profileSchema = getBoardColumnsFor(db, "profiles");
    const apptSchema = getBoardColumnsFor(db, appt.boardKey);
    const colByTitle = (
      schema: ReturnType<typeof getBoardColumnsFor>, title: string, types: string[],
    ) => schema?.columns.find((c) => c.title.trim().toLowerCase() === title && types.includes(c.type)) ?? null;
    const phoneCol = colByTitle(profileSchema, "phone", ["text", "phone"]);
    const descCol = colByTitle(apptSchema, "description", ["long_text", "text"]);
    const profileRaw = parseJson(appt.profileRaw);
    const folderCol = (kind: FolderKind) => colByTitle(profileSchema, FOLDER_COLUMN_TITLES[kind], ["text", "link"]);
    const dmsCol = colByTitle(profileSchema, "dms url", ["text"]);
    const steps = planPrepWriteBack(
      prep,
      {
        profilePhone: appt.profilePhone,
        appointmentDescription: textOf(apptCv.description),
        keepClient,
        profileFolders: { e_file: textOf(profileRaw.e_file), consult_file: textOf(profileRaw.consult_file) },
        profileDmsUrl: textOf(profileRaw.dms_url),
      },
      {
        profilePhone: phoneCol?.type === "text" ? phoneCol.columnId : null,
        appointmentDescription: descCol?.columnId ?? null,
        // Text columns only: a link column wants JSON, and both are text today.
        profileFolders: {
          e_file: folderCol("e_file")?.type === "text" ? folderCol("e_file")!.columnId : null,
          consult_file: folderCol("consult_file")?.type === "text" ? folderCol("consult_file")!.columnId : null,
        },
        profileDmsUrl: dmsCol?.columnId ?? null,
      },
    );
    for (const step of steps) {
      const isProfile = step.target === "profile";
      const boardId = isProfile ? profileSchema!.mondayBoardId : apptSchema!.mondayBoardId;
      const itemId = isProfile ? profileMondayId : apptMondayId;
      try {
        await withTokenFallback(
          (token) => dataSource.setColumnValue(boardId, itemId, step.columnId, step.value, token),
          writeTokenOptions(req),
        );
      } catch (err) {
        queue(`${step.field} write-back`, {
          opType: "change_column", targetTable: isProfile ? "profiles" : "board_items",
          targetLocalId: isProfile ? profileLocalId : appt.localId, mondayItemId: itemId, authorOid,
          payload: { boardId, columnId: step.columnId, value: step.value },
        }, err);
      }
      // Optimistic local mirror, so P17 and the 360 view agree right away.
      if (step.field === "phone") {
        db.prepare("UPDATE profiles SET phone = ? WHERE local_id = ?").run(step.value, profileLocalId);
      } else if (isProfile) {
        db.prepare(`UPDATE profiles SET raw_column_values = json_set(COALESCE(raw_column_values, '{}'), '$.${step.field}', ?) WHERE local_id = ?`)
          .run(step.value, profileLocalId);
      } else {
        db.prepare("UPDATE board_items SET column_values = json_set(COALESCE(column_values, '{}'), '$.description', ?) WHERE local_id = ?")
          .run(step.value, appt.localId);
      }
    }

    db.prepare(`
      INSERT INTO consult_preps
        (appointment_local_id, appointment_monday_id, profile_local_id, appt_type, method,
         fields, note_text, author_oid, author_name, pending)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      appt.localId, apptMondayId, profileLocalId, apptTypeLabel(prep), prep.method,
      JSON.stringify(prep), note.text, authorOid, author, pending ? 1 : 0,
    );

    auditFromReq(req, "monday.consult_prepped", {
      targetType: "profile", targetId: profileLocalId, targetMondayId: profileMondayId,
      metadata: {
        appointment: apptMondayId,
        boardKey: appt.boardKey,
        apptType: apptTypeLabel(prep),
        method: prep.method,
        documents: prep.documents.length,
        dms: !!prep.dmsUrl,
        wroteBack: steps.map((s) => s.field),
        queued: failures,
      },
    });
    res.status(pending ? 202 : 200).json({ data: { prepped: true, pending, wroteBack: steps.map((s) => s.field) } });
  });

  // A document picked or uploaded in M18/M19 also goes onto the appointment, in
  // its Files column (each attorney board has its own column id; found by
  // title). Raw body (any type), the file name in ?name=. Best-effort from the
  // popup's point of view: the file is already safe in SharePoint.
  app.post(
    "/api/reception/consults/:localId/files",
    requireAuth,
    express.raw({ type: () => true, limit: PREP_FILE_MAX_BYTES }),
    async (req, res) => {
      if (!MONDAY_API_TOKEN) {
        res.status(503).json({ error: "Monday.com write-back not configured (MONDAY_API_TOKEN missing)" });
        return;
      }
      const body = req.body as unknown;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        res.status(400).json({ error: "Send the file as the request body" });
        return;
      }
      const name = (typeof req.query.name === "string" ? req.query.name : "").trim().replace(/[\\/]/g, "_").slice(0, 200);
      if (!name) {
        res.status(400).json({ error: "?name= is required" });
        return;
      }
      const row = db
        .prepare(
          `SELECT local_id AS localId, monday_item_id AS mondayItemId, board_key AS boardKey
             FROM board_items WHERE local_id = ? AND deleted_at IS NULL`,
        )
        .get(String(req.params.localId)) as { localId: string; mondayItemId: string | null; boardKey: string } | undefined;
      if (!row || !row.boardKey.startsWith("appointments")) {
        res.status(404).json({ error: "Appointment not found" });
        return;
      }
      if (!row.mondayItemId) {
        res.status(400).json({ error: "This appointment has no Monday.com item ID" });
        return;
      }
      const filesCol = getBoardColumnsFor(db, row.boardKey)?.columns.find(
        (c) => c.type === "file" && c.title.trim().toLowerCase() === "files",
      );
      if (!filesCol) {
        res.status(409).json({ error: "Could not resolve the appointment's Files column — run a sync first" });
        return;
      }
      const itemId = row.mondayItemId;
      // The body is always sent as octet-stream (a JSON file would otherwise be
      // eaten by the global express.json()); the real type rides in ?type=.
      const typeParam = typeof req.query.type === "string" ? req.query.type.trim() : "";
      const contentType = /^[\w.+-]+\/[\w.+-]+$/.test(typeParam) ? typeParam : "application/octet-stream";
      try {
        await withTokenFallback(
          (token) => dataSource.addFile(itemId, filesCol.columnId, name, new Uint8Array(body), contentType, token),
          writeTokenOptions(req),
        );
      } catch (err) {
        // No queue: add_file reads from data/, and keeping a copy of every
        // client document on the server is not worth it for a duplicate of a
        // file SharePoint already holds. The popup says it was not attached.
        console.error("[reception] attaching the file to the appointment failed:", err);
        res.status(502).json({ error: "Saved to SharePoint, but Monday did not accept the file" });
        return;
      }
      auditFromReq(req, "monday.consult_file_attached", {
        targetType: "board_item", targetId: row.localId, targetMondayId: itemId,
        metadata: { name, bytes: body.length, boardKey: row.boardKey },
      });
      res.json({ data: { attached: true } });
    },
  );
}
