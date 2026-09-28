// =============================================================================
// Mail Intake — read scanned mail, split it into notices, match them to cases
// =============================================================================
// Prototype. No AI: USCIS notices use fixed formats, so plain regex finds the
// identifiers, and the local DB tells us whose they are. Nothing here writes —
// the result is a report of what WOULD happen (fill a receipt number, attach
// a PDF) plus the documents a person has to decide on.
//
// Three stages, each usable on its own:
//   0. repairOcrText(text)        — undo OCR's letter/digit swaps, where a
//                                   field's format says which one it must be
//   1. extractNoticeFields(text)  — one page's text → identifiers
//   2. splitIntoDocuments(pages)  — one big scan → separate notices
//   3. matchNotice(db, fields)    — identifiers → profile + Open Form
//
// Matching order matters. A RECEIPT notice is how the firm learns a receipt
// number, so for a new case the number is not in Monday yet and cannot be the
// key: we find the client by A-number, then their Open Form for the same form
// type that still has no receipt number. Later notices (approval, biometrics,
// RFE) carry a receipt number that IS on file, which is the stronger key.
// =============================================================================

import type BetterSqlite3 from "better-sqlite3";
type Database = BetterSqlite3.Database;

const OPEN_FORMS_BOARD = "_cd_open_forms";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface NoticePerson {
  role: string;
  name: string;
}

export interface NoticeFields {
  receiptNumbers: string[];
  aNumbers: string[];
  formType: string | null;
  noticeType: string | null;
  noticeDate: string | null;
  people: NoticePerson[];
}

/** One page as the PDF reader produced it. */
export interface MailPageInput {
  text: string;
  /** True when the text came from OCR rather than the PDF's text layer. */
  ocr?: boolean;
  /** Tesseract's 0-100 page confidence, when OCR'd. */
  ocrConfidence?: number | null;
}

export interface PageInfo {
  page: number; // 1-based
  text: string;
  ocr: boolean;
  ocrConfidence: number | null;
  fields: NoticeFields;
  blank: boolean;
  /** "Page 2 of 3" → { index: 2, total: 3 } */
  pageMarker: { index: number; total: number } | null;
  hasNoticeHeader: boolean;
}

export type SplitReason =
  | "first_page"
  | "page_marker"
  | "notice_header"
  | "new_identifiers"
  | "after_separator";

export interface SplitDocument {
  pages: number[];
  splitReason: SplitReason;
  /** Pages that joined only because nothing said "new document" — worth a look. */
  uncertainPages: number[];
  /** Pages read by OCR, and the lowest confidence among them (null if none). */
  ocrPages: number[];
  ocrConfidence: number | null;
  fields: NoticeFields;
}

export type MatchStatus = "matched" | "needs_attention" | "no_match" | "unreadable";

export type AttentionReason =
  | "several_profiles"
  | "several_forms"
  | "no_open_form"
  | "receipt_already_filled"
  | "identifier_mismatch"
  | "several_receipts";

export interface MatchedProfile {
  localId: string;
  name: string;
  aNumber: string | null;
}

export interface MatchedOpenForm {
  localId: string;
  mondayItemId: string | null;
  name: string;
  status: string | null;
  formType: string | null;
  receiptNo: string | null;
  profileLocalId: string | null;
}

export interface NoticeMatch {
  status: MatchStatus;
  reason: AttentionReason | null;
  message: string;
  matchedBy: "receipt_number" | "a_number" | null;
  profile: MatchedProfile | null;
  openForm: MatchedOpenForm | null;
  /** What the write-back would do. Never executed by the prototype. */
  proposedAction: "fill_receipt" | "attach_only" | null;
  candidateProfiles: MatchedProfile[];
  candidateForms: MatchedOpenForm[];
}

export interface MailScanDocument extends SplitDocument {
  match: NoticeMatch;
}

export interface MailScanResult {
  totalPages: number;
  separatorPages: number[];
  /** Pages with no usable text layer, read by OCR instead. */
  ocrPages: number[];
  documents: MailScanDocument[];
  summary: Record<MatchStatus, number>;
}

// -----------------------------------------------------------------------------
// 1. Field extraction
// -----------------------------------------------------------------------------

// 3 letters + 10 digits. Any prefix is accepted (live data has IOE, YSC, ZMI…);
// the fixed length is what keeps false positives out.
const RECEIPT_RE = /\b([A-Z]{3})[\s-]?(\d{10})\b/g;

// "A# 123-456-789", "A-Number: 123456789", "Alien Number 12 345 678", "A123456789".
// 3-3-3 grouping (8-digit numbers are 2-3-3) so a trailing date is never swallowed.
const A_NUMBER_RE =
  /(?:\bA(?:lien)?\s*(?:Registration\s*)?(?:#|-?\s*Number|No\.?)?\s*[:#]?\s*|\bA-?)(\d{2,3})[-\s]?(\d{3})[-\s]?(\d{3})(?!\d)/gi;

// "I-130", "I130", "N-400", "I-601A". I-797 is the notice itself, never the case.
const FORM_RE = /\b([IN])-?(\d{3})([A-Z])?\b/g;
const NOTICE_FORMS = new Set(["I797", "I797C", "I797A", "I797B", "I797D", "I797E"]);

const NOTICE_TYPES: Array<[RegExp, string]> = [
  [/request\s+for\s+evidence/i, "Request for Evidence"],
  [/biometric/i, "Biometrics Appointment"],
  [/interview/i, "Interview Notice"],
  [/approval\s+notice|has\s+been\s+approved/i, "Approval Notice"],
  [/rejection|rejected/i, "Rejection Notice"],
  [/transfer\s+notice|has\s+been\s+transferred/i, "Transfer Notice"],
  [/receipt\s+notice|we\s+have\s+received/i, "Receipt Notice"],
];

const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December";
const NOTICE_DATE_RE = new RegExp(
  `Notice\\s+Date\\s*:?\\s*((?:${MONTHS})\\s+\\d{1,2},\\s+\\d{4}|\\d{1,2}/\\d{1,2}/\\d{4})`,
  "i",
);

const PERSON_RE = /\b(Applicant|Beneficiary|Petitioner|Respondent)\s*:\s*([A-Z][A-Za-z'.-]+(?:[ ,]+[A-Z][A-Za-z'.-]+){0,4})/g;

const PAGE_MARKER_RE = /\bPage\s+(\d{1,2})\s+of\s+(\d{1,2})\b/i;
const NOTICE_HEADER_RE = /\bNotice\s+of\s+Action\b|\bI-797[A-E]?\b/i;

/** 9-digit, zero-padded — the shape profiles.a_number holds. */
export function normalizeANumber(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 9) return null;
  return digits.padStart(9, "0");
}

/** "I-130" / "I130" / "i-601a" → "I130" / "I601A". */
export function normalizeFormType(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = /\b([IN])-?(\d{3})([A-Z])?\b/i.exec(raw);
  return m ? `${m[1]!.toUpperCase()}${m[2]}${(m[3] ?? "").toUpperCase()}` : null;
}

function isoDate(raw: string): string | null {
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (slash) return `${slash[3]}-${slash[1]!.padStart(2, "0")}-${slash[2]!.padStart(2, "0")}`;
  const d = new Date(`${raw} 12:00 UTC`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export function extractNoticeFields(text: string): NoticeFields {
  const receiptNumbers = new Set<string>();
  for (const m of text.matchAll(RECEIPT_RE)) receiptNumbers.add(`${m[1]}${m[2]}`);

  const aNumbers = new Set<string>();
  for (const m of text.matchAll(A_NUMBER_RE)) {
    const n = normalizeANumber(`${m[1]}${m[2]}${m[3]}`);
    if (n) aNumbers.add(n);
  }

  let formType: string | null = null;
  for (const m of text.matchAll(FORM_RE)) {
    const f = `${m[1]}${m[2]}${m[3] ?? ""}`;
    if (!NOTICE_FORMS.has(f) && !f.startsWith("I797")) {
      formType = f;
      break;
    }
  }

  const noticeType = NOTICE_TYPES.find(([re]) => re.test(text))?.[1] ?? null;
  const dateMatch = NOTICE_DATE_RE.exec(text);

  const people: NoticePerson[] = [];
  for (const m of text.matchAll(PERSON_RE)) {
    const name = m[2]!.trim();
    if (!people.some((p) => p.role === m[1] && p.name === name)) people.push({ role: m[1]!, name });
  }

  return {
    receiptNumbers: [...receiptNumbers],
    aNumbers: [...aNumbers],
    formType,
    noticeType,
    noticeDate: dateMatch ? isoDate(dateMatch[1]!) : null,
    people,
  };
}

// -----------------------------------------------------------------------------
// 0. OCR repair
// -----------------------------------------------------------------------------
// Tesseract confuses glyphs that look alike: I/1/l/|, O/0, S/5, B/8, Z/2. A
// general "fix" would wreck ordinary words, so repairs only happen where a
// field's format pins down which kind of character belongs: a receipt number
// is 3 letters then 10 digits, a form is I-/N- then digits, an A-number after
// its label is all digits.

const TO_DIGIT: Record<string, string> = { O: "0", o: "0", D: "0", Q: "0", I: "1", l: "1", "|": "1", i: "1", S: "5", s: "5", B: "8", Z: "2", z: "2", G: "6" };
const TO_LETTER: Record<string, string> = { "0": "O", "1": "I", "5": "S", "8": "B", "2": "Z", "6": "G" };

const digitsOf = (s: string) => s.replace(/./g, (c) => TO_DIGIT[c] ?? c);
const lettersOf = (s: string) => s.replace(/./g, (c) => TO_LETTER[c] ?? c);

// Loose shapes. Each requires most characters already be the right kind, so a
// word is never turned into a number.
const LOOSE_RECEIPT_RE = /\b([A-Z0-9]{3})([\s-]?)([0-9OoDQIl|iSsBZzG]{10})\b/g;
const LOOSE_FORM_RE = /\b([1l|])-(\d{3}[A-Z]?)\b(?![-\d])/g;
const LOOSE_A_NUMBER_RE = /(\bA\s*[#:]\s*|\bA-?\s*Number\s*:?\s*|\bAlien\s+Number\s*:?\s*)([0-9OoDQIl|iSsBZzG]{2,3}[-\s]?[0-9OoDQIl|iSsBZzG]{3}[-\s]?[0-9OoDQIl|iSsBZzG]{3})(?![0-9A-Za-z])/gi;

export function repairOcrText(text: string): string {
  return text
    .replace(LOOSE_RECEIPT_RE, (whole, prefix: string, sep: string, num: string) => {
      const realDigits = num.replace(/\D/g, "").length;
      const realLetters = prefix.replace(/[^A-Z]/g, "").length;
      if (realDigits < 7 || realLetters < 2) return whole;
      const fixedPrefix = lettersOf(prefix);
      const fixedNum = digitsOf(num);
      return /^[A-Z]{3}$/.test(fixedPrefix) && /^\d{10}$/.test(fixedNum) ? `${fixedPrefix}${sep}${fixedNum}` : whole;
    })
    .replace(LOOSE_FORM_RE, (_w, _one: string, rest: string) => `I-${rest}`)
    .replace(LOOSE_A_NUMBER_RE, (whole, label: string, num: string) => {
      if (num.replace(/\D/g, "").length < 6) return whole;
      return `${label}${digitsOf(num)}`;
    });
}

export function analyzePage(page: number, input: string | MailPageInput): PageInfo {
  const { text: raw, ocr = false, ocrConfidence = null } = typeof input === "string" ? { text: input } : input;
  const text = ocr ? repairOcrText(raw) : raw;
  const marker = PAGE_MARKER_RE.exec(text);
  return {
    page,
    text,
    ocr,
    ocrConfidence: ocr ? ocrConfidence : null,
    fields: extractNoticeFields(text),
    // A scanner's blank separator sheet still yields a few stray characters.
    blank: text.replace(/\s/g, "").length < 15,
    pageMarker: marker ? { index: Number(marker[1]), total: Number(marker[2]) } : null,
    hasNoticeHeader: NOTICE_HEADER_RE.test(text),
  };
}

// -----------------------------------------------------------------------------
// 2. Splitting one scan into documents
// -----------------------------------------------------------------------------

function mergeFields(a: NoticeFields, b: NoticeFields): NoticeFields {
  const people = [...a.people];
  for (const p of b.people) if (!people.some((q) => q.role === p.role && q.name === p.name)) people.push(p);
  return {
    receiptNumbers: [...new Set([...a.receiptNumbers, ...b.receiptNumbers])],
    aNumbers: [...new Set([...a.aNumbers, ...b.aNumbers])],
    formType: a.formType ?? b.formType,
    noticeType: a.noticeType ?? b.noticeType,
    noticeDate: a.noticeDate ?? b.noticeDate,
    people,
  };
}

function sharesNone(a: string[], b: string[]): boolean {
  return a.length > 0 && b.length > 0 && !a.some((x) => b.includes(x));
}

/**
 * A new document starts when a page says so. In order of trust:
 *   - a blank separator sheet came before it
 *   - "Page 1 of N" (and "Page 2 of N" keeps it attached, whatever else it says)
 *   - an I-797 "Notice of Action" header
 *   - identifiers that don't overlap the current document's
 * A page with none of these joins the current document, flagged as uncertain —
 * that is the one case a person should check.
 */
export function splitIntoDocuments(pages: PageInfo[]): { documents: SplitDocument[]; separatorPages: number[] } {
  const documents: SplitDocument[] = [];
  const separatorPages: number[] = [];
  let current: SplitDocument | null = null;
  let afterSeparator = false;

  for (const p of pages) {
    if (p.blank) {
      separatorPages.push(p.page);
      current = null;
      afterSeparator = true;
      continue;
    }

    let reason: SplitReason | null = null;
    let uncertain = false;
    if (!current) {
      reason = afterSeparator ? "after_separator" : "first_page";
    } else if (p.pageMarker && p.pageMarker.index > 1) {
      reason = null; // explicit continuation
    } else if (p.pageMarker?.index === 1) {
      reason = "page_marker";
    } else if (p.hasNoticeHeader) {
      reason = "notice_header";
    } else if (
      sharesNone(p.fields.receiptNumbers, current.fields.receiptNumbers) ||
      sharesNone(p.fields.aNumbers, current.fields.aNumbers)
    ) {
      reason = "new_identifiers";
    } else {
      const hasIds = p.fields.receiptNumbers.length > 0 || p.fields.aNumbers.length > 0;
      uncertain = !hasIds && !p.pageMarker;
    }
    afterSeparator = false;

    if (reason) {
      current = { pages: [], splitReason: reason, uncertainPages: [], ocrPages: [], ocrConfidence: null, fields: p.fields };
      documents.push(current);
    } else {
      current!.fields = mergeFields(current!.fields, p.fields);
      if (uncertain) current!.uncertainPages.push(p.page);
    }
    current!.pages.push(p.page);
    if (p.ocr) {
      current!.ocrPages.push(p.page);
      if (p.ocrConfidence != null) {
        current!.ocrConfidence = Math.min(current!.ocrConfidence ?? 100, p.ocrConfidence);
      }
    }
  }

  return { documents, separatorPages };
}

// -----------------------------------------------------------------------------
// 3. Matching against the local mirror
// -----------------------------------------------------------------------------

interface OpenFormRow {
  localId: string;
  mondayItemId: string | null;
  name: string;
  status: string | null;
  profileLocalId: string | null;
  columnValues: string;
}

function readReceipt(cv: Record<string, unknown>): string | null {
  const v = cv.receipt_no;
  const raw = typeof v === "string" ? v : v && typeof v === "object" ? (v as { text?: unknown }).text : null;
  return typeof raw === "string" && raw.trim() ? raw.replace(/[\s-]/g, "").toUpperCase() : null;
}

/** Live rows carry a `forms` label column; seed rows only have "Name - I-485 (…)". */
function readFormType(cv: Record<string, unknown>, name: string): string | null {
  const forms = cv.forms as { labels?: unknown } | undefined;
  const labels = Array.isArray(forms?.labels) ? (forms!.labels as unknown[]) : [];
  for (const l of labels) {
    const f = normalizeFormType(String(l));
    if (f) return f;
  }
  return normalizeFormType(name);
}

function toOpenForm(row: OpenFormRow): MatchedOpenForm {
  let cv: Record<string, unknown> = {};
  try {
    cv = JSON.parse(row.columnValues) as Record<string, unknown>;
  } catch {
    // malformed JSON reads as empty
  }
  return {
    localId: row.localId,
    mondayItemId: row.mondayItemId,
    name: row.name,
    status: row.status,
    formType: readFormType(cv, row.name),
    receiptNo: readReceipt(cv),
    profileLocalId: row.profileLocalId || null,
  };
}

const OPEN_FORM_COLS = `local_id AS localId, monday_item_id AS mondayItemId, name, status,
  profile_local_id AS profileLocalId, column_values AS columnValues`;

function findFormsByReceipt(db: Database, receipt: string): MatchedOpenForm[] {
  const rows = db
    .prepare(
      `SELECT ${OPEN_FORM_COLS} FROM board_items
       WHERE board_key = ? AND deleted_at IS NULL
         AND upper(replace(replace(coalesce(json_extract(column_values, '$.receipt_no.text'),
                                            json_extract(column_values, '$.receipt_no'), ''), ' ', ''), '-', '')) = ?`,
    )
    .all(OPEN_FORMS_BOARD, receipt) as OpenFormRow[];
  return rows.map(toOpenForm);
}

/** Exported for the sample-PDF generator, which needs the same view of a client's forms. */
export function findFormsForProfile(db: Database, profileLocalId: string): MatchedOpenForm[] {
  const rows = db
    .prepare(
      `SELECT ${OPEN_FORM_COLS} FROM board_items
       WHERE board_key = ? AND deleted_at IS NULL AND profile_local_id = ?
       ORDER BY name`,
    )
    .all(OPEN_FORMS_BOARD, profileLocalId) as OpenFormRow[];
  return rows.map(toOpenForm);
}

function findProfilesByANumber(db: Database, aNumber: string): MatchedProfile[] {
  // Stored as "231315285" or "098-170-274"; compare digits without leading zeros.
  return db
    .prepare(
      `SELECT local_id AS localId, name, a_number AS aNumber FROM profiles
       WHERE deleted_at IS NULL AND a_number IS NOT NULL
         AND ltrim(replace(replace(a_number, '-', ''), ' ', ''), '0') = ?`,
    )
    .all(aNumber.replace(/^0+/, "")) as MatchedProfile[];
}

function getProfile(db: Database, localId: string): MatchedProfile | null {
  return (
    (db
      .prepare(`SELECT local_id AS localId, name, a_number AS aNumber FROM profiles WHERE local_id = ?`)
      .get(localId) as MatchedProfile | undefined) ?? null
  );
}

function result(partial: Partial<NoticeMatch> & Pick<NoticeMatch, "status" | "message">): NoticeMatch {
  return {
    reason: null,
    matchedBy: null,
    profile: null,
    openForm: null,
    proposedAction: null,
    candidateProfiles: [],
    candidateForms: [],
    ...partial,
  };
}

export function matchNotice(db: Database, fields: NoticeFields): NoticeMatch {
  const { receiptNumbers, aNumbers, formType } = fields;

  if (receiptNumbers.length === 0 && aNumbers.length === 0) {
    return result({ status: "unreadable", message: "No receipt number or A-number found on these pages." });
  }
  if (receiptNumbers.length > 1) {
    return result({
      status: "needs_attention",
      reason: "several_receipts",
      message: `${receiptNumbers.length} different receipt numbers — this may be two notices scanned together.`,
    });
  }

  const receipt = receiptNumbers[0] ?? null;
  const profilesByA = aNumbers.flatMap((a) => findProfilesByANumber(db, a));
  const uniqueProfiles = [...new Map(profilesByA.map((p) => [p.localId, p])).values()];

  // Strongest key first: a receipt number already on an Open Form.
  if (receipt) {
    const forms = findFormsByReceipt(db, receipt);
    if (forms.length === 1) {
      const form = forms[0]!;
      const owner = form.profileLocalId ? getProfile(db, form.profileLocalId) : null;
      if (owner && uniqueProfiles.length > 0 && !uniqueProfiles.some((p) => p.localId === owner.localId)) {
        return result({
          status: "needs_attention",
          reason: "identifier_mismatch",
          message: `Receipt ${receipt} belongs to ${owner.name}, but the A-number points to ${uniqueProfiles[0]!.name}.`,
          candidateProfiles: [owner, ...uniqueProfiles],
          candidateForms: forms,
        });
      }
      return result({
        status: "matched",
        matchedBy: "receipt_number",
        message: `Receipt ${receipt} is already on this Open Form — attach the notice.`,
        profile: owner,
        openForm: form,
        proposedAction: "attach_only",
      });
    }
    if (forms.length > 1) {
      return result({
        status: "needs_attention",
        reason: "several_forms",
        message: `Receipt ${receipt} is on ${forms.length} Open Forms.`,
        candidateForms: forms,
      });
    }
  }

  // No receipt on file — fall back to the client's A-number.
  if (uniqueProfiles.length === 0) {
    return result({
      status: "no_match",
      message: aNumbers.length
        ? `No client has A-number ${aNumbers.join(", ")}${receipt ? ` and no Open Form has receipt ${receipt}` : ""}.`
        : `No Open Form has receipt ${receipt}, and the notice shows no A-number.`,
    });
  }
  if (uniqueProfiles.length > 1) {
    return result({
      status: "needs_attention",
      reason: "several_profiles",
      message: `${uniqueProfiles.length} clients share this A-number.`,
      candidateProfiles: uniqueProfiles,
    });
  }

  const profile = uniqueProfiles[0]!;
  const forms = findFormsForProfile(db, profile.localId);
  const sameType = formType ? forms.filter((f) => f.formType === formType) : forms;
  const label = formType ?? "any form";

  if (sameType.length === 0) {
    return result({
      status: "needs_attention",
      reason: "no_open_form",
      matchedBy: "a_number",
      profile,
      message: `${profile.name} has no Open Form for ${label}${forms.length ? ` (has ${forms.length} other)` : ""}.`,
      candidateForms: forms,
    });
  }

  if (!receipt) {
    if (sameType.length === 1) {
      return result({
        status: "matched",
        matchedBy: "a_number",
        profile,
        openForm: sameType[0]!,
        proposedAction: "attach_only",
        message: `Only ${label} Open Form for ${profile.name} — attach the notice.`,
      });
    }
    return result({
      status: "needs_attention",
      reason: "several_forms",
      matchedBy: "a_number",
      profile,
      message: `${profile.name} has ${sameType.length} Open Forms for ${label} — pick one.`,
      candidateForms: sameType,
    });
  }

  // A new receipt number: it belongs on the one matching form that has none yet.
  const empty = sameType.filter((f) => !f.receiptNo);
  if (empty.length === 1) {
    return result({
      status: "matched",
      matchedBy: "a_number",
      profile,
      openForm: empty[0]!,
      proposedAction: "fill_receipt",
      message: `New receipt ${receipt} → fill Receipt No. on ${profile.name}'s ${label} Open Form.`,
    });
  }
  if (empty.length > 1) {
    return result({
      status: "needs_attention",
      reason: "several_forms",
      matchedBy: "a_number",
      profile,
      message: `${profile.name} has ${empty.length} ${label} Open Forms without a receipt number — pick one.`,
      candidateForms: empty,
    });
  }
  return result({
    status: "needs_attention",
    reason: "receipt_already_filled",
    matchedBy: "a_number",
    profile,
    message: `${profile.name}'s ${label} Open Form already has receipt ${sameType.map((f) => f.receiptNo).join(", ")}, not ${receipt}.`,
    candidateForms: sameType,
  });
}

// -----------------------------------------------------------------------------
// Orchestration
// -----------------------------------------------------------------------------

export function scanMailPages(db: Database, pageInputs: Array<string | MailPageInput>): MailScanResult {
  const pages = pageInputs.map((t, i) => analyzePage(i + 1, t));
  const { documents, separatorPages } = splitIntoDocuments(pages);
  const scanned = documents.map((d) => ({ ...d, match: matchNotice(db, d.fields) }));
  const summary: Record<MatchStatus, number> = { matched: 0, needs_attention: 0, no_match: 0, unreadable: 0 };
  for (const d of scanned) summary[d.match.status]++;
  const ocrPages = pages.filter((p) => p.ocr).map((p) => p.page);
  return { totalPages: pageInputs.length, separatorPages, ocrPages, documents: scanned, summary };
}
