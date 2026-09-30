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
//   1. extractNoticeFields(text)  — one page → every field it prints (receipt,
//                                   case type, dates, petitioner/beneficiary…),
//                                   read by position (mail-layout.ts)
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
import { LOW_OCR_CONFIDENCE } from "./types";
import { readLayout, type LayoutValues, type Word } from "./mail-layout";

const OPEN_FORMS_BOARD = "_cd_open_forms";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface NoticePerson {
  role: string;
  name: string;
}

/**
 * Everything read off a notice. Dates are ISO (YYYY-MM-DD); names are as
 * printed ("LOPEZ, MARIA"). `people` is derived from the three name fields and
 * kept for rows saved before they existed.
 */
export interface NoticeFields {
  receiptNumbers: string[];
  aNumbers: string[];
  /** Normalized form, for matching: "I130". */
  formType: string | null;
  /** As printed: "I130 - PETITION FOR ALIEN RELATIVE". */
  caseType: string | null;
  noticeType: string | null;
  noticeDate: string | null;
  receivedDate: string | null;
  priorityDate: string | null;
  petitioner: string | null;
  beneficiary: string | null;
  applicant: string | null;
  dateOfBirth: string | null;
  /** Classification line, e.g. "Husband or wife of U.S. citizen, 201(b) INA". */
  section: string | null;
  /**
   * Our clients whose names appear anywhere on the pages, as they're on file.
   * Found by looking every client up in the text, so it works on any document
   * (court notices, letters, EOIR forms) — not only where an I-797 labels them.
   */
  names: string[];
  people: NoticePerson[];
}

export const NAME_ROLES = ["petitioner", "beneficiary", "applicant"] as const;
const ROLE_LABEL = { petitioner: "Petitioner", beneficiary: "Beneficiary", applicant: "Applicant" } as const;

export function emptyFields(): NoticeFields {
  return {
    receiptNumbers: [],
    aNumbers: [],
    formType: null,
    caseType: null,
    noticeType: null,
    noticeDate: null,
    receivedDate: null,
    priorityDate: null,
    petitioner: null,
    beneficiary: null,
    applicant: null,
    dateOfBirth: null,
    section: null,
    names: [],
    people: [],
  };
}

/**
 * Fill in anything missing (rows saved before a field existed) and re-derive
 * `people`. Older rows only had `people`; their names move into the fields.
 */
export function normalizeFields(raw: Partial<NoticeFields> | null | undefined): NoticeFields {
  const f: NoticeFields = { ...emptyFields(), ...(raw ?? {}) };
  for (const p of f.people ?? []) {
    const role = p.role.toLowerCase() as (typeof NAME_ROLES)[number];
    if ((NAME_ROLES as readonly string[]).includes(role) && !f[role]) f[role] = p.name;
  }
  f.people = NAME_ROLES.filter((r) => f[r]).map((r) => ({ role: ROLE_LABEL[r], name: f[r]! }));
  return f;
}

/** One page as the PDF reader produced it. */
export interface MailPageInput {
  text: string;
  /** True when the text came from OCR rather than the PDF's text layer. */
  ocr?: boolean;
  /** Tesseract's 0-100 page confidence, when OCR'd. */
  ocrConfidence?: number | null;
  /** Word boxes (text layer or OCR), so labelled fields can be read by position. */
  words?: Word[] | null;
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
  /** The front of a notice: its header AND something only a front carries. */
  hasNoticeHeader: boolean;
  /**
   * Carries notice fields (identifiers, or the Receipt Number / Case Type /
   * Notice Date labels). False for a notice's boilerplate back, an envelope, a
   * card photo — pages that can join a notice without anyone checking them.
   */
  looksLikeNotice: boolean;
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
  | "several_receipts"
  | "name_mismatch"
  | "name_uncertain";

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
  /** The form's "Received/Priority Date" column, ISO. */
  receivedDate: string | null;
  profileLocalId: string | null;
  profileName: string | null;
}

export interface NoticeMatch {
  status: MatchStatus;
  reason: AttentionReason | null;
  message: string;
  matchedBy: "receipt_number" | "a_number" | "name" | null;
  profile: MatchedProfile | null;
  openForm: MatchedOpenForm | null;
  /** What the write-back would do. Never executed by the prototype. */
  proposedAction: "fill_receipt" | "attach_only" | null;
  candidateProfiles: MatchedProfile[];
  candidateForms: MatchedOpenForm[];
}

export interface MailScanDocument extends SplitDocument {
  match: NoticeMatch;
  /** Goes to Alerts → Mail to review. */
  needsReview: boolean;
  /** Saved row id, once the scan is stored. */
  id?: number;
}

export interface MailScanResult {
  totalPages: number;
  separatorPages: number[];
  /** Pages with no usable text layer, read by OCR instead. */
  ocrPages: number[];
  documents: MailScanDocument[];
  summary: Record<MatchStatus, number>;
  /** Saved scan id, once stored. */
  scanId?: number;
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
// A case type as printed: "I130 - PETITION FOR ALIEN RELATIVE". The first
// glyph is loose because OCR reads the I as 1, l, |, [ or !.
const CASE_TYPE_TEXT_RE = /(?<![\w-])([IN1l|[!])-?(\d{3}[A-Z]?)[ \t]*[-–][ \t\n]*((?:PETITION|APPLICATION|REQUEST|NOTICE)\b[^\n]*)/;
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

const MONTH_RE = new RegExp(`^(${MONTHS})\\s+(\\d{1,2}),?\\s+(\\d{4})$`, "i");

/** ISO date from "08/14/2026", "August 14, 2026" or "2026-08-14"; null for blank, "N/A" and nonsense. */
export function parseNoticeDate(raw: string | null | undefined, ocr = false): string | null {
  if (!raw) return null;
  let v = raw.trim().replace(/\s+/g, " ");
  // OCR swaps inside the numeric parts only: "O8/14/2O26" → "08/14/2026".
  if (ocr) v = v.replace(/[0-9OoDQIl|SsBZzG]+(?=[/.-])|(?<=[/.-])[0-9OoDQIl|SsBZzG]+/g, digitsOf);
  let y: number, m: number, d: number;
  const slash = /(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(v);
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(v);
  const named = MONTH_RE.exec(v.replace(/[^\w ,]/g, "").trim());
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (slash) [y, m, d] = [Number(slash[3]), Number(slash[1]), Number(slash[2])];
  else if (named) {
    y = Number(named[3]);
    m = MONTHS.split("|").findIndex((x) => x.toLowerCase() === named[1]!.toLowerCase()) + 1;
    d = Number(named[2]);
  } else return null;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2100) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** A name as printed, minus what shares its line: A-numbers, digits, stray labels. */
export function cleanName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = raw
    .replace(/\bA\s*[#:-]?\s*\d[\d\s-]{6,}/gi, " ")
    .replace(/[^A-Za-zÀ-ÖØ-öø-ÿ ,.'-]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[ ,.-]+|[ ,.-]+$/g, "")
    .trim();
  return v.length >= 2 && /[A-Za-z]{2}/.test(v) ? v : null;
}

function canonicalNoticeType(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const known = NOTICE_TYPES.find(([re]) => re.test(raw))?.[1];
  const v = raw.replace(/\s+/g, " ").trim();
  return known ?? (v || null);
}

/**
 * Every field on one page. Labelled fields are read by position first (a
 * grid-layout I-797 puts values under their labels), then the text-wide rules
 * fill whatever the labels didn't give: receipt and A-numbers anywhere, the
 * first form number, notice-type wording, "Label: value" people.
 */
export function extractNoticeFields(text: string, words?: Word[] | null, ocr = false): NoticeFields {
  return fieldsFromLayout(text, readLayout(text, words), ocr);
}

function fieldsFromLayout(text: string, layout: LayoutValues, ocr: boolean): NoticeFields {
  const fix = (v: string | undefined) => (v && ocr ? repairOcrText(v) : v);

  const receiptNumbers = new Set<string>();
  const labelledReceipt = fix(layout.receiptNumber);
  if (labelledReceipt) for (const m of labelledReceipt.matchAll(RECEIPT_RE)) receiptNumbers.add(`${m[1]}${m[2]}`);
  for (const m of text.matchAll(RECEIPT_RE)) receiptNumbers.add(`${m[1]}${m[2]}`);

  const aNumbers = new Set<string>();
  if (layout.aNumber) {
    const n = normalizeANumber(ocr ? digitsOf(layout.aNumber) : layout.aNumber);
    if (n) aNumbers.add(n);
  }
  for (const m of text.matchAll(A_NUMBER_RE)) {
    const n = normalizeANumber(`${m[1]}${m[2]}${m[3]}`);
    if (n) aNumbers.add(n);
  }

  // A case type always names a form; anything else under that label is noise.
  let rawCaseType = fix(layout.caseType)?.replace(/\s+/g, " ").trim() || null;
  // Under the Case Type label, one glyph before three digits can only be the I
  // of an I-form: OCR reads "I765" as "1765", "[765", "l765", "|765"…
  if (rawCaseType && ocr) rawCaseType = rawCaseType.replace(/^[1lIi|![\]L](?=-?\d{3}[A-Z]?\b)/, "I");
  // No (readable) Case Type label: the value itself is distinctive enough —
  // "1485 - APPLICATION TO REGISTER…", where the form's I is often misread.
  if (!normalizeFormType(rawCaseType)) {
    const m = CASE_TYPE_TEXT_RE.exec(text);
    if (m) rawCaseType = `${m[1] === "N" ? "N" : "I"}${m[2]} - ${m[3]!.replace(/\s+/g, " ").trim()}`;
  }
  const caseType = normalizeFormType(rawCaseType) ? rawCaseType : null;
  let formType = normalizeFormType(caseType);
  if (!formType) {
    for (const m of text.matchAll(FORM_RE)) {
      const f = `${m[1]}${m[2]}${m[3] ?? ""}`;
      if (!NOTICE_FORMS.has(f) && !f.startsWith("I797")) {
        formType = f;
        break;
      }
    }
  }

  const inline: Partial<Record<(typeof NAME_ROLES)[number], string>> = {};
  for (const m of text.matchAll(PERSON_RE)) {
    const role = m[1]!.toLowerCase() as (typeof NAME_ROLES)[number];
    if ((NAME_ROLES as readonly string[]).includes(role) && !inline[role]) inline[role] = m[2]!.trim();
  }
  const noticeDateMatch = NOTICE_DATE_RE.exec(text);

  return normalizeFields({
    receiptNumbers: [...receiptNumbers],
    aNumbers: [...aNumbers],
    formType,
    caseType,
    noticeType: canonicalNoticeType(layout.noticeType) ?? NOTICE_TYPES.find(([re]) => re.test(text))?.[1] ?? null,
    noticeDate: parseNoticeDate(layout.noticeDate, ocr) ?? (noticeDateMatch ? parseNoticeDate(noticeDateMatch[1]) : null),
    receivedDate: parseNoticeDate(layout.receivedDate, ocr),
    priorityDate: parseNoticeDate(layout.priorityDate, ocr),
    petitioner: cleanName(layout.petitioner) ?? cleanName(inline.petitioner),
    beneficiary: cleanName(layout.beneficiary) ?? cleanName(inline.beneficiary),
    applicant: cleanName(layout.applicant) ?? cleanName(inline.applicant),
    dateOfBirth: parseNoticeDate(layout.dateOfBirth, ocr),
    section: layout.section?.replace(/\s+/g, " ").trim() || null,
  });
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
const TO_LETTER: Record<string, string> = { "0": "O", "1": "I", "|": "I", l: "I", "5": "S", "8": "B", "2": "Z", "6": "G" };

const digitsOf = (s: string) => s.replace(/./g, (c) => TO_DIGIT[c] ?? c);
const lettersOf = (s: string) => s.replace(/./g, (c) => TO_LETTER[c] ?? c);

// Receipt prefixes USCIS actually issues (service centers, field offices, the
// online filing system). A prefix that repairs to one of these is trusted even
// when OCR got two of its three letters wrong — "10E" and "|0E" are IOE.
const KNOWN_RECEIPT_PREFIXES = new Set([
  "IOE", "EAC", "VSC", "WAC", "CSC", "LIN", "NSC", "SRC", "TSC", "NBC", "MSC", "YSC", "PSC",
]);

// Loose shapes. Each requires most characters already be the right kind, so a
// word is never turned into a number.
const LOOSE_RECEIPT_RE = /(?<![A-Za-z0-9])([A-Z0-9|l]{3})([\s-]?)([0-9OoDQIl|iSsBZzG]{10})\b/g;
const LOOSE_FORM_RE = /\b([1l|])-(\d{3}[A-Z]?)\b(?![-\d])/g;
const LOOSE_A_NUMBER_RE = /(\bA\s*[#:]\s*|\bA-?\s*Number\s*:?\s*|\bAlien\s+Number\s*:?\s*)([0-9OoDQIl|iSsBZzG]{2,3}[-\s]?[0-9OoDQIl|iSsBZzG]{3}[-\s]?[0-9OoDQIl|iSsBZzG]{3})(?![0-9A-Za-z])/gi;

// OCR sometimes inserts a stray I between prefix and number: "EACI1809750382".
const STRAY_I_RECEIPT_RE = new RegExp(`(?<![A-Za-z0-9])(${[...KNOWN_RECEIPT_PREFIXES].join("|")})[Il|1](\\d{10})\\b`, "g");

export function repairOcrText(text: string): string {
  return text
    .replace(STRAY_I_RECEIPT_RE, "$1$2")
    .replace(LOOSE_RECEIPT_RE, (whole, prefix: string, sep: string, num: string) => {
      const realDigits = num.replace(/\D/g, "").length;
      const realLetters = prefix.replace(/[^A-Z]/g, "").length;
      const fixedPrefix = lettersOf(prefix);
      if (realDigits < 7 || (realLetters < 2 && !KNOWN_RECEIPT_PREFIXES.has(fixedPrefix))) return whole;
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
  const { text: raw, ocr = false, ocrConfidence = null, words = null } =
    typeof input === "string" ? { text: input } : input;
  const text = ocr ? repairOcrText(raw) : raw;
  const layout = readLayout(text, words);
  // "Page 1 of 2" inline, or a grid "Page" label with "1 of 2" under it.
  // OCR turns "2 of 2" into "20f2" and "1 of 1" into "lofl", hence the loose
  // "of" and digits.
  const gridPage = /^([\dlI|]{1,2})\s*[oO0]\s*f\s*([\dlI|]{1,2})$/i.exec(layout.page?.trim() ?? "");
  const marker = PAGE_MARKER_RE.exec(text) ?? (gridPage && [gridPage[0], digitsOf(gridPage[1]!), digitsOf(gridPage[2]!)]);
  const fields = fieldsFromLayout(text, layout, ocr);
  const looksLikeNotice =
    fields.receiptNumbers.length > 0 ||
    fields.aNumbers.length > 0 ||
    layout.receiptNumber != null ||
    layout.caseType != null ||
    layout.noticeDate != null;
  return {
    page,
    text,
    ocr,
    ocrConfidence: ocr ? ocrConfidence : null,
    fields,
    // A scanner's blank separator sheet still yields a few stray characters.
    blank: Math.max(text.replace(/\s/g, "").length, (words ?? []).reduce((n, w) => n + w.text.length, 0)) < 15,
    pageMarker: marker ? { index: Number(marker[1]), total: Number(marker[2]) } : null,
    // The back of an I-797 says "Form I-797, Notice of Action" in its
    // boilerplate — that is not a new notice.
    hasNoticeHeader: NOTICE_HEADER_RE.test(text) && looksLikeNotice,
    looksLikeNotice,
  };
}

// -----------------------------------------------------------------------------
// 2. Splitting one scan into documents
// -----------------------------------------------------------------------------

/** A notice's fields across its pages: lists unite, and the first page to print a value wins. */
function mergeFields(a: NoticeFields, b: NoticeFields): NoticeFields {
  const merged = { ...a } as NoticeFields;
  for (const key of Object.keys(emptyFields()) as Array<keyof NoticeFields>) {
    if (key === "receiptNumbers" || key === "aNumbers" || key === "names") merged[key] = [...new Set([...a[key], ...b[key]])];
    else if (key !== "people") (merged as unknown as Record<string, unknown>)[key] = a[key] ?? b[key];
  }
  return normalizeFields(merged);
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
 * A page with none of these joins the current document. If it looks like a
 * notice (labels, but no identifiers read) it is flagged as uncertain — that is
 * the one case a person should check. A page that doesn't (a notice's back, an
 * envelope, a card photo) just joins, and lends the notice none of its fields.
 */
export function splitIntoDocuments(pages: PageInfo[]): { documents: SplitDocument[]; separatorPages: number[] } {
  const documents: SplitDocument[] = [];
  const separatorPages: number[] = [];
  let current: SplitDocument | null = null;
  // False while the current document is only an envelope or loose back pages:
  // the notice that follows belongs with them rather than starting its own.
  let currentHasNotice = false;
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
    } else if (!currentHasNotice) {
      reason = null;
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
      uncertain = !hasIds && !p.pageMarker && p.looksLikeNotice;
    }
    afterSeparator = false;

    if (reason) {
      current = { pages: [], splitReason: reason, uncertainPages: [], ocrPages: [], ocrConfidence: null, fields: emptyFields() };
      documents.push(current);
      currentHasNotice = false;
    } else if (uncertain) {
      current!.uncertainPages.push(p.page);
    }
    // The page that starts a document always counts — a court notice or a
    // letter has none of the I-797 labels but is still the document.
    if (p.looksLikeNotice || reason) current!.fields = mergeFields(current!.fields, p.fields);
    if (p.looksLikeNotice) currentHasNotice = true;
    current!.pages.push(p.page);
    if (p.ocr) {
      current!.ocrPages.push(p.page);
      // A smudged envelope reads at 20%; that says nothing about the notice.
      if (p.ocrConfidence != null && p.looksLikeNotice) {
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
  profileName: string | null;
  columnValues: string;
}

function readReceipt(cv: Record<string, unknown>): string | null {
  const v = cv.receipt_no;
  const raw = typeof v === "string" ? v : v && typeof v === "object" ? (v as { text?: unknown }).text : null;
  return typeof raw === "string" && raw.trim() ? raw.replace(/[\s-]/g, "").toUpperCase() : null;
}

function readDate(v: unknown): string | null {
  const raw = v && typeof v === "object" ? (v as { date?: unknown }).date : v;
  return typeof raw === "string" && /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : null;
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
    receivedDate: readDate(cv.received_priority_date),
    profileLocalId: row.profileLocalId || null,
    profileName: row.profileName,
  };
}

const OPEN_FORM_COLS = `local_id AS localId, monday_item_id AS mondayItemId, name, status,
  profile_local_id AS profileLocalId, column_values AS columnValues,
  (SELECT p.name FROM profiles p WHERE p.local_id = board_items.profile_local_id) AS profileName`;

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

// --- Names -------------------------------------------------------------------
// Notices print "LOPEZ GARCIA, MARIA"; profiles hold "Maria Lopez" or
// "Ms. Maria LOPEZ GARCIA". Compare as sets of words, accents and titles
// dropped. "Strong" = every word of the shorter name is in the longer one and
// there are at least two; that tolerates a missing second surname but never
// matches on a surname alone.

const TITLES = new Set(["mr", "mrs", "ms", "miss", "dr", "md", "jr", "sr", "ii", "iii", "iv", "phd", "esq", "dds", "dvm"]);

export function nameTokens(name: string | null | undefined): string[] {
  if (!name) return [];
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .split(" ")
    .filter((t) => t.length >= 2 && !TITLES.has(t));
}

export type NameMatch = "strong" | "partial" | "none";

export function compareNames(a: string | null | undefined, b: string | null | undefined): NameMatch {
  const A = new Set(nameTokens(a));
  const B = new Set(nameTokens(b));
  const [small, big] = A.size <= B.size ? [A, B] : [B, A];
  const overlap = [...small].filter((t) => big.has(t)).length;
  if (small.size >= 2 && overlap === small.size) return "strong";
  if (overlap >= 2) return "partial";
  return "none";
}

/** Any word in common at all — the bar for "these can't be the same person" checks. */
function sharesAWord(a: string | null | undefined, b: string | null | undefined): boolean {
  const A = new Set(nameTokens(a));
  return nameTokens(b).some((t) => A.has(t));
}

interface ProfileIndexEntry extends MatchedProfile {
  tokens: string[];
}

// All profiles, tokenised once per few seconds rather than per notice.
const profileIndexCache = new WeakMap<Database, { at: number; entries: ProfileIndexEntry[] }>();

function profileIndex(db: Database): ProfileIndexEntry[] {
  const hit = profileIndexCache.get(db);
  if (hit && Date.now() - hit.at < 5_000) return hit.entries;
  const rows = db
    .prepare(`SELECT local_id AS localId, name, a_number AS aNumber FROM profiles WHERE deleted_at IS NULL`)
    .all() as MatchedProfile[];
  const entries = rows.map((r) => ({ ...r, tokens: nameTokens(r.name) }));
  profileIndexCache.set(db, { at: Date.now(), entries });
  return entries;
}

function findProfilesByName(db: Database, name: string): { strong: MatchedProfile[]; partial: MatchedProfile[] } {
  const strong: MatchedProfile[] = [];
  const partial: MatchedProfile[] = [];
  if (nameTokens(name).length < 2) return { strong, partial };
  for (const e of profileIndex(db)) {
    const m = compareNames(name, e.name);
    const p = { localId: e.localId, name: e.name, aNumber: e.aNumber };
    if (m === "strong") strong.push(p);
    else if (m === "partial") partial.push(p);
  }
  return { strong, partial };
}

const uniqueBy = <T extends { localId: string }>(xs: T[]) => [...new Map(xs.map((x) => [x.localId, x])).values()];

/** "petitioner LOPEZ, MARIA and beneficiary LOPEZ, JUAN" */
function namesPhrase(names: Array<{ role: string; name: string }>): string {
  return names.map((n) => `${n.role} ${n.name}`).join(" and ");
}

/** Among forms, the one whose Received/Priority Date is a date this notice prints. */
function pickByDate(forms: MatchedOpenForm[], fields: NoticeFields): MatchedOpenForm | null {
  const dates = [fields.receivedDate, fields.priorityDate].filter(Boolean);
  if (dates.length === 0) return null;
  const hits = forms.filter((f) => f.receivedDate && dates.includes(f.receivedDate));
  return hits.length === 1 ? hits[0]! : null;
}

/**
 * Clients named anywhere in `text`, by their name on file. Every one of a
 * client's name words (initials aside) must appear, close together, so
 * "Norma X. ZAVALA LEIVA" is found in "Norma Xiomara Zavala Leiva v. …" but not
 * in a page that says "Norma" in one paragraph and "Leiva" three paragraphs on.
 */
export function findNamedClients(db: Database, text: string): MatchedProfile[] {
  const words = nameTokens(text);
  const at = new Map<string, number[]>();
  words.forEach((w, i) => at.set(w, [...(at.get(w) ?? []), i]));
  const namedHere = (tokens: string[]) => {
    if (tokens.length < 2 || !tokens.every((t) => at.has(t))) return false;
    // Some occurrence of the first word with every other word nearby.
    const window = tokens.length + 3;
    return at.get(tokens[0]!)!.some((i) =>
      tokens.slice(1).every((t) => at.get(t)!.some((j) => Math.abs(j - i) <= window)),
    );
  };
  const found: MatchedProfile[] = [];
  for (const e of profileIndex(db)) {
    // Names on file carry notes and couples: "Carlos VALENZUELA CASTRO (Maria
    // PRIETO USC)", "Juan LOPEZ & Ana RUIZ". A document names one person.
    const people = e.name.replace(/\([^)]*\)|\[[^\]]*\]/g, " ").split(/\s+(?:&|and|y)\s+|\//i);
    if (people.some((person) => namedHere([...new Set(nameTokens(person))]))) {
      found.push({ localId: e.localId, name: e.name, aNumber: e.aNumber });
    }
  }
  // A client whose whole name sits inside another found client's name is that
  // other client read twice ("ANA LOPEZ" inside "ANA MARIA LOPEZ PEREZ").
  return found.filter(
    (p) => !found.some((q) => q !== p && q.name.length > p.name.length && compareNames(p.name, q.name) === "strong"),
  );
}

export function matchNotice(db: Database, fields: NoticeFields): NoticeMatch {
  const { receiptNumbers, aNumbers, formType } = fields;
  const names: Array<{ role: string; name: string }> = [
    ...NAME_ROLES.filter((r) => fields[r]).map((r) => ({ role: r, name: fields[r]! })),
    ...fields.names
      .filter((n) => !NAME_ROLES.some((r) => compareNames(fields[r], n) === "strong"))
      .map((name) => ({ role: "client", name })),
  ];

  if (receiptNumbers.length === 0 && aNumbers.length === 0 && names.length === 0) {
    return result({ status: "unreadable", message: "No receipt number, A-number or name found on these pages." });
  }
  if (receiptNumbers.length > 1) {
    return result({
      status: "needs_attention",
      reason: "several_receipts",
      message: `${receiptNumbers.length} different receipt numbers — this may be two notices scanned together.`,
    });
  }

  const receipt = receiptNumbers[0] ?? null;
  const byA = uniqueBy(aNumbers.flatMap((a) => findProfilesByANumber(db, a)));
  const nameHits = names.map((n) => ({ ...n, ...findProfilesByName(db, n.name) }));
  const strongByName = uniqueBy(nameHits.flatMap((h) => h.strong));
  /** Does any name on the notice plausibly belong to this client? */
  const namesFit = (p: MatchedProfile) => names.length === 0 || names.some((n) => sharesAWord(n.name, p.name));

  // 1. Strongest key: a receipt number already on an Open Form.
  if (receipt) {
    let forms = findFormsByReceipt(db, receipt);
    if (forms.length > 1 && names.length > 0) {
      // The same number copied onto two clients' forms: the names decide.
      const owned = forms.filter((f) => strongByName.some((p) => p.localId === f.profileLocalId));
      if (owned.length === 1) forms = owned;
    }
    if (forms.length === 1) {
      const form = forms[0]!;
      const owner = form.profileLocalId ? getProfile(db, form.profileLocalId) : null;
      if (owner && byA.length > 0 && !byA.some((p) => p.localId === owner.localId)) {
        return result({
          status: "needs_attention",
          reason: "identifier_mismatch",
          message: `Receipt ${receipt} belongs to ${owner.name}, but the A-number points to ${byA[0]!.name}.`,
          candidateProfiles: [owner, ...byA],
          candidateForms: forms,
        });
      }
      if (owner && !namesFit(owner)) {
        return result({
          status: "needs_attention",
          reason: "name_mismatch",
          message: `Receipt ${receipt} is on ${owner.name}'s Open Form, but the notice names ${namesPhrase(names)}.`,
          candidateProfiles: uniqueBy([owner, ...strongByName]),
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

  // 2. The client: by A-number, checked against the names; else by name.
  let profile: MatchedProfile | null = null;
  let matchedBy: NoticeMatch["matchedBy"] = null;

  if (byA.length > 0) {
    const fitting = byA.filter(namesFit);
    if (byA.length > 1) {
      const narrowed = byA.filter((p) => strongByName.some((s) => s.localId === p.localId));
      if (narrowed.length !== 1) {
        return result({
          status: "needs_attention",
          reason: "several_profiles",
          message: `${byA.length} clients share this A-number.`,
          candidateProfiles: byA,
        });
      }
      profile = narrowed[0]!;
    } else if (fitting.length === 0) {
      // One wrong OCR digit in an A-number is a different client; the names catch it.
      return result({
        status: "needs_attention",
        reason: "name_mismatch",
        message: `The A-number points to ${byA[0]!.name}, but the notice names ${namesPhrase(names)}.`,
        candidateProfiles: uniqueBy([...byA, ...strongByName]),
      });
    } else {
      profile = byA[0]!;
    }
    matchedBy = "a_number";
  } else if (strongByName.length === 1) {
    profile = strongByName[0]!;
    matchedBy = "name";
  } else if (strongByName.length > 1) {
    return result({
      status: "needs_attention",
      reason: "several_profiles",
      message: `${strongByName.length} clients match the names on the notice (${namesPhrase(names)}).`,
      candidateProfiles: strongByName,
    });
  } else {
    const partial = uniqueBy(nameHits.flatMap((h) => h.partial));
    const noA = aNumbers.length ? `No client has A-number ${aNumbers.join(", ")}` : "The notice shows no A-number";
    const noR = receipt ? ` and no Open Form has receipt ${receipt}` : "";
    if (partial.length > 0) {
      return result({
        status: "needs_attention",
        reason: "name_uncertain",
        message: `${noA}${noR}. ${partial.length === 1 ? "One client's name is" : `${partial.length} clients' names are`} close to ${namesPhrase(names)}.`,
        candidateProfiles: partial.slice(0, 10),
      });
    }
    return result({
      status: "no_match",
      message: `${noA}${noR}${names.length ? `, and no client is named ${names.map((n) => n.name).join(" or ")}` : ""}.`,
    });
  }

  const how = matchedBy === "name" ? ` (matched by name${aNumbers.length ? `; A-number ${aNumbers.join(", ")} is not on file` : ""})` : "";

  // 3. The Open Form: same form type; a date the notice prints breaks ties.
  const forms = findFormsForProfile(db, profile.localId);
  const sameType = formType ? forms.filter((f) => f.formType === formType) : forms;
  const label = formType ?? "any form";

  if (sameType.length === 0) {
    return result({
      status: "needs_attention",
      reason: "no_open_form",
      matchedBy,
      profile,
      message: `${profile.name} has no Open Form for ${label}${forms.length ? ` (has ${forms.length} other)` : ""}${how}.`,
      candidateForms: forms,
    });
  }

  if (!receipt) {
    const one = sameType.length === 1 ? sameType[0]! : pickByDate(sameType, fields);
    if (one) {
      return result({
        status: "matched",
        matchedBy,
        profile,
        openForm: one,
        proposedAction: "attach_only",
        message: `${sameType.length === 1 ? "Only" : "The date-matching"} ${label} Open Form for ${profile.name} — attach the notice${how}.`,
      });
    }
    return result({
      status: "needs_attention",
      reason: "several_forms",
      matchedBy,
      profile,
      message: `${profile.name} has ${sameType.length} Open Forms for ${label} — pick one${how}.`,
      candidateForms: sameType,
    });
  }

  // A new receipt number: it belongs on the one matching form that has none yet.
  const empty = sameType.filter((f) => !f.receiptNo);
  const target = empty.length === 1 ? empty[0]! : empty.length > 1 ? pickByDate(empty, fields) : null;
  if (target) {
    return result({
      status: "matched",
      matchedBy,
      profile,
      openForm: target,
      proposedAction: "fill_receipt",
      message: `New receipt ${receipt} → fill Receipt No. on ${profile.name}'s ${label} Open Form${empty.length > 1 ? " (picked by date)" : ""}${how}.`,
    });
  }
  if (empty.length > 1) {
    return result({
      status: "needs_attention",
      reason: "several_forms",
      matchedBy,
      profile,
      message: `${profile.name} has ${empty.length} ${label} Open Forms without a receipt number — pick one${how}.`,
      candidateForms: empty,
    });
  }
  return result({
    status: "needs_attention",
    reason: "receipt_already_filled",
    matchedBy,
    profile,
    message: `${profile.name}'s ${label} Open Form already has receipt ${sameType.map((f) => f.receiptNo).join(", ")}, not ${receipt}${how}.`,
    candidateForms: sameType,
  });
}

/**
 * A person has to look when the match isn't settled — and also when it looks
 * settled but rests on shaky input: a low-confidence OCR read (one wrong digit
 * is a different client) or a page that joined the notice only by default.
 */
export function needsReview(doc: Pick<MailScanDocument, "match" | "ocrConfidence" | "uncertainPages">): boolean {
  return (
    doc.match.status !== "matched" ||
    (doc.ocrConfidence != null && doc.ocrConfidence < LOW_OCR_CONFIDENCE) ||
    doc.uncertainPages.length > 0
  );
}

// -----------------------------------------------------------------------------
// Orchestration
// -----------------------------------------------------------------------------

export function scanMailPages(db: Database, pageInputs: Array<string | MailPageInput>): MailScanResult {
  const pages = pageInputs.map((t, i) => analyzePage(i + 1, t));
  const { documents, separatorPages } = splitIntoDocuments(pages);
  const scanned = documents.map((d) => {
    const text = d.pages.map((n) => pages[n - 1]!.text).join("\n");
    const named = findNamedClients(db, text).map((p) => p.name);
    d.fields = normalizeFields({ ...d.fields, names: [...new Set([...d.fields.names, ...named])] });
    const match = matchNotice(db, d.fields);
    return { ...d, match, needsReview: needsReview({ ...d, match }) };
  });
  const summary: Record<MatchStatus, number> = { matched: 0, needs_attention: 0, no_match: 0, unreadable: 0 };
  for (const d of scanned) summary[d.match.status]++;
  const ocrPages = pages.filter((p) => p.ocr).map((p) => p.page);
  return { totalPages: pageInputs.length, separatorPages, ocrPages, documents: scanned, summary };
}
