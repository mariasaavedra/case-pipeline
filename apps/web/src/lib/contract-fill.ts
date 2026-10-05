// =============================================================================
// Contract templates — fields, formatting, checking, filling
// =============================================================================
// The firm's contract templates are ordinary Word files in a SharePoint folder
// (config CONTRACT_TEMPLATES_FOLDER), edited by staff in Word. A blank is a tag
// typed into the text: {{client_name}}, {{attorney_fee}}… CONTRACT_FIELDS is
// the full list (also what the "READ ME" cheat sheet in the folder lists).
//
// Everything happens in the browser: M22 downloads the template, checks it
// (inspectContractTemplate — unknown tags and broken braces are reported, so a
// typo in a template is caught before a contract goes out), shows only the
// fields that template uses, and fills it (fillContractTemplate). Amounts print
// WITH their "$" ("$5,000.00"); dates as "October 5, 2026" (or the Spanish /
// short variants). The 3% surcharge is on the attorney fee only, as in the
// 2026 contracts.
// =============================================================================

import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";

export const SURCHARGE_RATE = 0.03;

/** Everything the contract form collects. Amounts in dollars, dates ISO. */
export interface ContractInput {
  date: string;
  clientName: string;
  salutation: string;
  email: string;
  address: string;
  cityStateZip: string;
  /** COURT: "Master Hearing" / "Individual Hearing". */
  hearingType: string;
  hearingDate: string;
  /** FORMS: the form(s) the contract is for, e.g. "I-130". */
  formName: string;
  attorneyFee: number | null;
  filingFee: number | null;
  /** Null prints "N/A". */
  postageFee: number | null;
  /** Null = 3% of the attorney fee. */
  surcharge: number | null;
  interviewFee: number | null;
  dueDate: string;
  attorneyName: string;
  creatorInitials: string;
}

export interface ContractField {
  tag: string;
  label: string;
  /** Example of what prints, for the cheat sheet. */
  example: string;
  value: (f: ContractInput) => string;
  /** The template can't go out with this blank empty. */
  required?: (f: ContractInput) => boolean;
}

const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_ES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

function ymd(iso: string): { y: number; m: number; d: number } | null {
  const hit = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!hit) return null;
  const [y, m, d] = [Number(hit[1]), Number(hit[2]), Number(hit[3])];
  return m >= 1 && m <= 12 && d >= 1 && d <= 31 ? { y, m, d } : null;
}
export const dateEn = (iso: string) => { const p = ymd(iso); return p ? `${MONTHS_EN[p.m - 1]} ${p.d}, ${p.y}` : ""; };
export const dateEs = (iso: string) => { const p = ymd(iso); return p ? `${p.d} de ${MONTHS_ES[p.m - 1]}, ${p.y}` : ""; };
export const dateShort = (iso: string) => { const p = ymd(iso); return p ? `${String(p.m).padStart(2, "0")}/${String(p.d).padStart(2, "0")}/${p.y}` : ""; };

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
export const money = (n: number | null) => (n === null || !Number.isFinite(n) ? "" : usd.format(n));

const round2 = (n: number) => Math.round(n * 100) / 100;
export const surchargeFor = (attorneyFee: number | null) => round2((attorneyFee ?? 0) * SURCHARGE_RATE);
export const surchargeOf = (f: ContractInput) => f.surcharge ?? surchargeFor(f.attorneyFee);
export const totalOf = (f: ContractInput) =>
  round2((f.attorneyFee ?? 0) + (f.filingFee ?? 0) + (f.postageFee ?? 0) + surchargeOf(f));

const has = (s: string) => s.trim() !== "";
const positive = (n: number | null) => n !== null && Number.isFinite(n) && n > 0;

export const CONTRACT_FIELDS: ContractField[] = [
  { tag: "date", label: "Letter date (Date Fee K created)", example: "October 5, 2026", value: (f) => dateEn(f.date), required: (f) => !ymd(f.date) },
  { tag: "date_es", label: "Letter date, Spanish", example: "5 de Octubre, 2026", value: (f) => dateEs(f.date), required: (f) => !ymd(f.date) },
  { tag: "client_name", label: "Client name", example: "Ana LOPEZ", value: (f) => f.clientName.trim(), required: (f) => !has(f.clientName) },
  { tag: "salutation", label: '"Dear …" name', example: "Ana LOPEZ", value: (f) => (f.salutation.trim() || f.clientName.trim()) },
  { tag: "email", label: "Client email", example: "ana@example.com", value: (f) => f.email.trim() },
  { tag: "address", label: "Street address", example: "123 Main St", value: (f) => f.address.trim() },
  { tag: "city_state_zip", label: "City, State zip", example: "Kansas City, MO 64105", value: (f) => f.cityStateZip.trim() },
  { tag: "address_full", label: "Address on one line", example: "123 Main St, Kansas City, MO 64105", value: (f) => [f.address.trim(), f.cityStateZip.trim()].filter(Boolean).join(", ") },
  { tag: "hearing_type", label: "Hearing type", example: "Master Hearing", value: (f) => f.hearingType.trim(), required: (f) => !has(f.hearingType) },
  { tag: "hearing_date", label: "Hearing date", example: "November 12, 2026", value: (f) => dateEn(f.hearingDate), required: (f) => !ymd(f.hearingDate) },
  { tag: "hearing_date_es", label: "Hearing date, Spanish", example: "12 de Noviembre, 2026", value: (f) => dateEs(f.hearingDate), required: (f) => !ymd(f.hearingDate) },
  { tag: "form_name", label: "Form(s) / matter", example: "I-130", value: (f) => f.formName.trim(), required: (f) => !has(f.formName) },
  { tag: "attorney_fee", label: "Attorney fee (AF)", example: "$5,000.00", value: (f) => money(f.attorneyFee), required: (f) => !positive(f.attorneyFee) },
  { tag: "filing_fee", label: "Filing fee (FF)", example: "$675.00", value: (f) => money(f.filingFee ?? 0) },
  { tag: "postage_fee", label: "Postage fee (N/A when empty)", example: "$100.00", value: (f) => (f.postageFee === null ? "N/A" : money(f.postageFee)) },
  { tag: "surcharge", label: "Surcharge (3% of AF unless changed)", example: "$150.00", value: (f) => money(surchargeOf(f)) },
  { tag: "total_fee", label: "Total (AF + FF + postage + surcharge)", example: "$5,925.00", value: (f) => money(totalOf(f)) },
  { tag: "interview_fee", label: "Interview attendance fee", example: "$500.00", value: (f) => money(f.interviewFee), required: (f) => !positive(f.interviewFee) },
  { tag: "due_date", label: "Payment deadline", example: "October 12, 2026", value: (f) => dateEn(f.dueDate), required: (f) => !ymd(f.dueDate) },
  { tag: "due_date_es", label: "Payment deadline, Spanish", example: "12 de Octubre, 2026", value: (f) => dateEs(f.dueDate), required: (f) => !ymd(f.dueDate) },
  { tag: "due_date_short", label: "Payment deadline, short", example: "10/12/2026", value: (f) => dateShort(f.dueDate), required: (f) => !ymd(f.dueDate) },
  { tag: "attorney_name", label: "Attorney (signs the letter)", example: "Jane Attorney", value: (f) => f.attorneyName.trim(), required: (f) => !has(f.attorneyName) },
  { tag: "creator_initials", label: "Initials of who made the Fee K", example: "RC", value: (f) => f.creatorInitials.trim(), required: (f) => !has(f.creatorInitials) },
];

const BY_TAG = new Map(CONTRACT_FIELDS.map((f) => [f.tag, f]));

// Same delimiters as the rest of the app's templates (libs/template/src/docx.ts).
const OPTIONS = { delimiters: { start: "{{", end: "}}" }, paragraphLoop: true, linebreaks: true, nullGetter: () => "" };

export interface TemplateCheck {
  /** Known tags the template uses, in CONTRACT_FIELDS order. */
  tags: string[];
  /** Tags that aren't fields (typos) — the contract can't be generated. */
  unknown: string[];
  /** Broken tags ("{{client_name}" …), from docxtemplater. */
  errors: string[];
}

interface DocxError { properties?: { errors?: { properties?: { explanation?: string } }[]; explanation?: string } }

/** Read a template's tags without filling it. Never throws. */
export function inspectContractTemplate(file: ArrayBuffer): TemplateCheck {
  try {
    // docxtemplater hands every tag to the parser while compiling — that's the list.
    const found = new Set<string>();
    new Docxtemplater(new PizZip(file), {
      ...OPTIONS,
      parser: (tag: string) => {
        found.add(tag.trim());
        return { get: () => "" };
      },
    });
    return {
      tags: CONTRACT_FIELDS.map((f) => f.tag).filter((t) => found.has(t)),
      unknown: [...found].filter((t) => !BY_TAG.has(t)),
      errors: [],
    };
  } catch (e) {
    const err = e as DocxError;
    const list = err.properties?.errors?.map((x) => x.properties?.explanation ?? "").filter(Boolean)
      ?? [err.properties?.explanation ?? (e instanceof Error ? e.message : "This isn't a Word file the app can read")];
    return { tags: [], unknown: [], errors: list };
  }
}

/** What stops this template from being filled with this input. Empty = OK. */
export function contractProblems(check: TemplateCheck, input: ContractInput): string[] {
  const out = [...check.errors];
  if (check.unknown.length > 0) out.push(`Unknown field(s) in the template: ${check.unknown.map((t) => `{{${t}}}`).join(", ")}`);
  for (const tag of check.tags) {
    const field = BY_TAG.get(tag)!;
    if (field.required?.(input)) out.push(`${field.label} is missing`);
  }
  return out;
}

export function contractValues(input: ContractInput): Record<string, string> {
  return Object.fromEntries(CONTRACT_FIELDS.map((f) => [f.tag, f.value(input)]));
}

/** Fill a template. Call contractProblems first. */
export function fillContractTemplate(file: ArrayBuffer, input: ContractInput): Blob {
  const doc = new Docxtemplater(new PizZip(file), OPTIONS);
  doc.render(contractValues(input));
  return doc.getZip().generate({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    compression: "DEFLATE",
  }) as Blob;
}
