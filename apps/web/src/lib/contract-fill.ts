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
// short variants). The 3% surcharge is on everything the client pays by card:
// AF + FF + postage (changed 2026-10-14; it was AF only). Most 2026 contracts
// print it per fee instead, one "Surcharge Fee" line under each amount:
// {{attorney_fee_surcharge}}, {{filing_fee_surcharge}}… = 3% of that one fee.
// Scope of services (2026-10-23): the FORMS contract prints what its Fee K
// Type includes / leaves out ({{services}}, {{services_excluded}}, + _es),
// pre-filled from Settings → Firm → Fee K Types and editable per contract; the
// court contracts carry their scope as fixed text in the Word file.
// One contract can cover several people (a family at one Master Hearing):
// "Contract is for more than one person" in M22, then everyone it covers. The
// client — who signs and pays — is listed only if typed in: a relative often
// signs for someone detained. A template repeats a block per person with a
// loop, {{#people}}{{person_name}} A# {{person_a_number}}{{/people}}, wrapped in
// {{#has_people}}…{{/has_people}} so a one-person contract prints as before;
// or names them in a sentence with {{people_names}}. One fee, one signer.
// Pro hac vice (2026-10-29, Habeas): when the attorney must be admitted in the
// federal district, M22's "Includes a pro hac vice motion" box turns on the
// {{#pro_hac_vice}}…{{/pro_hac_vice}} clause, with {{pro_hac_vice_district}}
// {{pro_hac_vice_fee}} (preparing the motion; Rekha sets it with the attorney)
// and {{pro_hac_vice_filing_fee}} (the court's). Both are paid into Operating
// with the AF, so both are in the surcharge and the total.
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
  /** The same in Spanish (the Fee K Type's Spanish name). */
  formNameEs: string;
  /** The Fee K Type(s) picked in M22; formName / formNameEs / the scope follow them. */
  feeKTypes: string[];
  attorneyFee: number | null;
  filingFee: number | null;
  /** Null prints "N/A". */
  postageFee: number | null;
  /** Null = 3% of AF + FF + postage. */
  surcharge: number | null;
  interviewFee: number | null;
  /** COURT APPLICATION: DHS biometrics fee. Null prints "N/A". */
  bioFee: number | null;
  /** MASTER HEARING + MOTION: which motion, in English and Spanish (MOTIONS fills both). */
  motionName: string;
  motionNameEs: string;
  /** BOND MOTION + MASTER HEARING: the motion's and the hearing's attorney fees. */
  motionFee: number | null;
  hearingFee: number | null;
  dueDate: string;
  /** TRIAL: when the signed contract must be back (the payment deadline is dueDate). */
  signByDate: string;
  attorneyName: string;
  creatorInitials: string;
  /** "Contract is for more than one person" — `people` counts only when ticked. */
  multiplePeople: boolean;
  /** Everyone the contract covers; the client (signer) only if listed. */
  people: ContractPerson[];
  /** TRIAL: the prep and the trial are separate fees, each with its own deadline. */
  trialPrepFee: number | null;
  trialPrepDueDate: string;
  trialFee: number | null;
  trialDueDate: string;
  /** Scope of services from the Fee K Type (Settings → Firm), editable per contract. "" prints nothing. */
  services: string;
  servicesEs: string;
  servicesExcluded: string;
  servicesExcludedEs: string;
  /** HABEAS: "Includes a pro hac vice motion" — the fee and district count only when ticked. */
  proHacVice: boolean;
  proHacViceFee: number | null;
  /** The court's filing fee for the motion (not the firm's), paid with the AF too. */
  proHacViceFilingFee: number | null;
  /** The federal district, e.g. "Western District of Missouri". */
  proHacViceDistrict: string;
}

/** Someone the contract covers. */
export interface ContractPerson {
  name: string;
  aNumber: string;
  /** ISO date, "" when not given. */
  dob: string;
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
/** 3% of the fees it applies to: AF + FF + postage. */
export const surchargeFor = (...fees: (number | null)[]) => round2(fees.reduce<number>((s, f) => s + (f ?? 0), 0) * SURCHARGE_RATE);
const phv = (f: ContractInput, fee: number | null) => (f.proHacVice ? fee ?? 0 : 0);
/** Pro hac vice fee + the court's filing fee, when the contract includes the motion (0 otherwise): both go to Operating. */
export const proHacViceFeeOf = (f: ContractInput) => phv(f, f.proHacViceFee) + phv(f, f.proHacViceFilingFee);
export const surchargeOf = (f: ContractInput) => f.surcharge ?? surchargeFor(f.attorneyFee, f.filingFee, f.postageFee, proHacViceFeeOf(f));
export const totalOf = (f: ContractInput) =>
  round2((f.attorneyFee ?? 0) + (f.filingFee ?? 0) + (f.postageFee ?? 0) + proHacViceFeeOf(f) + surchargeOf(f));

/** "N/A" for a fee that doesn't apply (null), else the amount. */
const moneyOrNA = (n: number | null) => (n === null ? "N/A" : money(n));
/** BIA appeal fees are paid in two equal halves (Trial was too, until 2026-10-22). */
export const halfOf = (attorneyFee: number | null) => round2((attorneyFee ?? 0) / 2);

const has = (s: string) => s.trim() !== "";
const positive = (n: number | null) => n !== null && Number.isFinite(n) && n > 0;

/** Everyone listed, when the contract is for more than one person; rows without a name don't count. */
export const peopleOf = (f: ContractInput): ContractPerson[] =>
  f.multiplePeople ? f.people.filter((p) => has(p.name)).map((p) => ({ ...p, name: p.name.trim(), aNumber: p.aNumber.trim() })) : [];
/** The names a sentence uses: everyone listed, else the client alone. */
const namesOf = (f: ContractInput) => {
  const listed = peopleOf(f).map((p) => p.name);
  return listed.length > 0 ? listed : [f.clientName.trim()];
};
/** "Ana, Juan and Maria" (Spanish: "y"). */
export const joinNames = (names: string[], and: string) =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} ${and} ${names[names.length - 1]}`;
export const trialTotalOf = (f: ContractInput) => round2((f.trialPrepFee ?? 0) + (f.trialFee ?? 0));

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
  { tag: "form_name", label: "Form(s) / matter", example: "I-130 - Petition for Alien Relative", value: (f) => f.formName.trim(), required: (f) => !has(f.formName) },
  { tag: "form_name_es", label: "Form(s) / matter, Spanish (English when there's none)", example: "Petición de familiar extranjero (I-130)", value: (f) => f.formNameEs.trim() || f.formName.trim(), required: (f) => !has(f.formName) && !has(f.formNameEs) },
  { tag: "attorney_fee", label: "Attorney fee (AF)", example: "$5,000.00", value: (f) => money(f.attorneyFee), required: (f) => !positive(f.attorneyFee) },
  { tag: "filing_fee", label: "Filing fee (FF)", example: "$675.00", value: (f) => money(f.filingFee ?? 0) },
  { tag: "postage_fee", label: "Postage fee (N/A when empty)", example: "$100.00", value: (f) => (f.postageFee === null ? "N/A" : money(f.postageFee)) },
  { tag: "surcharge", label: "Surcharge (3% of AF + FF + postage + pro hac vice unless changed)", example: "$150.00", value: (f) => money(surchargeOf(f)) },
  { tag: "total_fee", label: "Total (AF + FF + postage + pro hac vice + surcharge)", example: "$5,925.00", value: (f) => money(totalOf(f)) },
  { tag: "attorney_fee_surcharge", label: "Surcharge on the attorney fee (3%)", example: "$150.00", value: (f) => money(surchargeFor(f.attorneyFee)), required: (f) => !positive(f.attorneyFee) },
  { tag: "filing_fee_surcharge", label: "Surcharge on the filing fee (3%)", example: "$20.25", value: (f) => money(surchargeFor(f.filingFee)) },
  { tag: "postage_fee_surcharge", label: "Surcharge on postage (3%, N/A when no postage)", example: "$3.00", value: (f) => (f.postageFee === null ? "N/A" : money(surchargeFor(f.postageFee))) },
  { tag: "attorney_fee_half", label: "Half the attorney fee (paid in two halves)", example: "$2,500.00", value: (f) => money(halfOf(f.attorneyFee)), required: (f) => !positive(f.attorneyFee) },
  { tag: "attorney_fee_half_surcharge", label: "Surcharge on half the attorney fee (3%)", example: "$75.00", value: (f) => money(surchargeFor(halfOf(f.attorneyFee))), required: (f) => !positive(f.attorneyFee) },
  { tag: "bio_fee", label: "DHS biometrics fee (N/A when empty)", example: "$30.00", value: (f) => moneyOrNA(f.bioFee) },
  { tag: "bio_fee_surcharge", label: "Surcharge on the biometrics fee (3%)", example: "$0.90", value: (f) => (f.bioFee === null ? "N/A" : money(surchargeFor(f.bioFee))) },
  { tag: "motion_name", label: "Motion (which one)", example: "Motion to Recalendar", value: (f) => f.motionName.trim(), required: (f) => !has(f.motionName) },
  { tag: "motion_name_es", label: "Motion, Spanish", example: "Moción para Recalendarizar", value: (f) => f.motionNameEs.trim(), required: (f) => !has(f.motionNameEs) },
  { tag: "motion_fee", label: "Attorney fee for the motion", example: "$1,500.00", value: (f) => money(f.motionFee), required: (f) => !positive(f.motionFee) },
  { tag: "motion_fee_surcharge", label: "Surcharge on the motion fee (3%)", example: "$45.00", value: (f) => money(surchargeFor(f.motionFee)), required: (f) => !positive(f.motionFee) },
  { tag: "hearing_fee", label: "Attorney fee for the hearing", example: "$1,000.00", value: (f) => money(f.hearingFee), required: (f) => !positive(f.hearingFee) },
  { tag: "hearing_fee_surcharge", label: "Surcharge on the hearing fee (3%)", example: "$30.00", value: (f) => money(surchargeFor(f.hearingFee)), required: (f) => !positive(f.hearingFee) },
  { tag: "pro_hac_vice_fee", label: "Pro hac vice fee (when the box is ticked)", example: "$500.00", value: (f) => money(phv(f, f.proHacViceFee)), required: (f) => f.proHacVice && !positive(f.proHacViceFee) },
  { tag: "pro_hac_vice_fee_surcharge", label: "Surcharge on the pro hac vice fee (3%)", example: "$15.00", value: (f) => money(surchargeFor(phv(f, f.proHacViceFee))), required: (f) => f.proHacVice && !positive(f.proHacViceFee) },
  { tag: "pro_hac_vice_filing_fee", label: "Court filing fee for the pro hac vice motion (when ticked)", example: "$100.00", value: (f) => money(phv(f, f.proHacViceFilingFee)), required: (f) => f.proHacVice && !positive(f.proHacViceFilingFee) },
  { tag: "pro_hac_vice_filing_fee_surcharge", label: "Surcharge on the pro hac vice filing fee (3%)", example: "$3.00", value: (f) => money(surchargeFor(phv(f, f.proHacViceFilingFee))), required: (f) => f.proHacVice && !positive(f.proHacViceFilingFee) },
  { tag: "pro_hac_vice_district", label: "Federal district for the pro hac vice motion", example: "Western District of Missouri", value: (f) => (f.proHacVice ? f.proHacViceDistrict.trim() : ""), required: (f) => f.proHacVice && !has(f.proHacViceDistrict) },
  { tag: "people_names", label: "Everyone on the contract, in a sentence", example: "Ana LOPEZ, Juan LOPEZ and Maria LOPEZ", value: (f) => joinNames(namesOf(f), "and"), required: (f) => !has(f.clientName) },
  { tag: "people_names_es", label: "Everyone on the contract, Spanish", example: "Ana LOPEZ, Juan LOPEZ y Maria LOPEZ", value: (f) => joinNames(namesOf(f), "y"), required: (f) => !has(f.clientName) },
  { tag: "people_count", label: "How many people", example: "3", value: (f) => String(namesOf(f).length) },
  { tag: "trial_prep_fee", label: "Trial prep fee", example: "$3,000.00", value: (f) => money(f.trialPrepFee), required: (f) => !positive(f.trialPrepFee) },
  { tag: "trial_prep_fee_surcharge", label: "Surcharge on the trial prep fee (3%)", example: "$90.00", value: (f) => money(surchargeFor(f.trialPrepFee)), required: (f) => !positive(f.trialPrepFee) },
  { tag: "trial_prep_due_date", label: "Trial prep fee due", example: "November 1, 2026", value: (f) => dateEn(f.trialPrepDueDate), required: (f) => !ymd(f.trialPrepDueDate) },
  { tag: "trial_prep_due_date_es", label: "Trial prep fee due, Spanish", example: "1 de Noviembre, 2026", value: (f) => dateEs(f.trialPrepDueDate), required: (f) => !ymd(f.trialPrepDueDate) },
  { tag: "trial_fee", label: "Trial fee", example: "$4,000.00", value: (f) => money(f.trialFee), required: (f) => !positive(f.trialFee) },
  { tag: "trial_fee_surcharge", label: "Surcharge on the trial fee (3%)", example: "$120.00", value: (f) => money(surchargeFor(f.trialFee)), required: (f) => !positive(f.trialFee) },
  { tag: "trial_due_date", label: "Trial fee due", example: "January 15, 2027", value: (f) => dateEn(f.trialDueDate), required: (f) => !ymd(f.trialDueDate) },
  { tag: "trial_due_date_es", label: "Trial fee due, Spanish", example: "15 de Enero, 2027", value: (f) => dateEs(f.trialDueDate), required: (f) => !ymd(f.trialDueDate) },
  { tag: "trial_total_fee", label: "Trial prep + trial fee", example: "$7,000.00", value: (f) => money(trialTotalOf(f)), required: (f) => !positive(f.trialPrepFee) || !positive(f.trialFee) },
  { tag: "services", label: "Services included (from the Fee K Type)", example: "Prepare and file Form I-130 with the evidence of your relationship.", value: (f) => f.services.trim() },
  { tag: "services_es", label: "Services included, Spanish", example: "Preparar y presentar el Formulario I-130…", value: (f) => f.servicesEs.trim() },
  { tag: "services_excluded", label: "Not included (from the Fee K Type)", example: "Adjustment of status (I-485) or consular processing…", value: (f) => f.servicesExcluded.trim() },
  { tag: "services_excluded_es", label: "Not included, Spanish", example: "El ajuste de estatus (I-485) o el proceso consular…", value: (f) => f.servicesExcludedEs.trim() },
  { tag: "interview_fee", label: "Interview attendance fee", example: "$500.00", value: (f) => money(f.interviewFee), required: (f) => !positive(f.interviewFee) },
  { tag: "due_date", label: "Payment deadline", example: "October 12, 2026", value: (f) => dateEn(f.dueDate), required: (f) => !ymd(f.dueDate) },
  { tag: "due_date_es", label: "Payment deadline, Spanish", example: "12 de Octubre, 2026", value: (f) => dateEs(f.dueDate), required: (f) => !ymd(f.dueDate) },
  { tag: "sign_by_date", label: "Signed contract due", example: "October 10, 2026", value: (f) => dateEn(f.signByDate), required: (f) => !ymd(f.signByDate) },
  { tag: "sign_by_date_es", label: "Signed contract due, Spanish", example: "10 de Octubre, 2026", value: (f) => dateEs(f.signByDate), required: (f) => !ymd(f.signByDate) },
  { tag: "due_date_short", label: "Payment deadline, short", example: "10/12/2026", value: (f) => dateShort(f.dueDate), required: (f) => !ymd(f.dueDate) },
  { tag: "attorney_name", label: "Attorney (signs the letter)", example: "Jane Attorney", value: (f) => f.attorneyName.trim(), required: (f) => !has(f.attorneyName) },
  { tag: "creator_initials", label: "Initials of who made the Fee K", example: "RC", value: (f) => f.creatorInitials.trim(), required: (f) => !has(f.creatorInitials) },
];

/** What M22 needs of a Fee K Types row (Settings → Firm). */
export interface FeeKTypeText {
  feeKType: string;
  spanish: string;
  services: string;
  servicesEs: string;
  excluded: string;
  excludedEs: string;
}
const typeKey = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
/** A Fee K Type as a contract names it: Monday's "(c)" court marker and doubled spaces dropped. */
export const contractTitle = (feeKType: string) => feeKType.replace(/\(c\)/gi, "").replace(/\s+/g, " ").trim();

/**
 * Picking Fee K Type(s) in M22: the contract's matter in English and Spanish
 * (several joined with " + "; no Spanish name = the English one) and the scope
 * of services (each type's text, joined). Mirrors the API's pre-fill.
 */
export function fromFeeKTypes(types: string[], rows: FeeKTypeText[]): Pick<ContractInput,
  "feeKTypes" | "formName" | "formNameEs" | "services" | "servicesEs" | "servicesExcluded" | "servicesExcludedEs"> {
  const byKey = new Map(rows.map((r) => [typeKey(r.feeKType), r]));
  const hits = types.map((t) => byKey.get(typeKey(t)));
  const join = (k: keyof FeeKTypeText) => hits.map((r) => r?.[k] ?? "").filter(Boolean).join(" ");
  return {
    feeKTypes: types,
    formName: types.map(contractTitle).filter(Boolean).join(" + "),
    formNameEs: types.map((t, i) => hits[i]?.spanish || contractTitle(t)).filter(Boolean).join(" + "),
    services: join("services"), servicesEs: join("servicesEs"),
    servicesExcluded: join("excluded"), servicesExcludedEs: join("excludedEs"),
  };
}

/** The {{#people}} … {{/people}} loop: its tags print once per person. */
export const PEOPLE_LOOP = "people";
/** {{#has_people}} … {{/has_people}}: printed only when the contract is for more than one person. */
export const PEOPLE_SECTION = "has_people";
/** Fewer than this many listed = not "more than one person". */
const MIN_PEOPLE = 2;
export const PERSON_FIELDS: ContractField[] = [
  { tag: "person_name", label: "Person's name (inside the loop)", example: "Juan LOPEZ", value: () => "" },
  { tag: "person_number", label: "1, 2, 3… (inside the loop)", example: "2", value: () => "" },
  { tag: "person_a_number", label: "Person's A# (inside the loop)", example: "123-456-789", value: () => "" },
  { tag: "person_dob", label: "Person's date of birth (inside the loop)", example: "March 4, 1990", value: () => "" },
  { tag: "person_dob_es", label: "Person's date of birth, Spanish (inside the loop)", example: "4 de Marzo, 1990", value: () => "" },
];
const PERSON_TAGS = new Set(PERSON_FIELDS.map((f) => f.tag));

/** {{#pro_hac_vice}} … {{/pro_hac_vice}}: printed only when "Includes a pro hac vice motion" is ticked. */
export const PRO_HAC_VICE_SECTION = "pro_hac_vice";

/**
 * {{#uscis_filing}} … {{/uscis_filing}}: the FORMS opening ("Preparing and filing
 * your … with USCIS"). Off when a picked Fee K Type isn't filed with USCIS: a
 * CVP goes to the National Visa Center, and its own scope says what's done.
 */
export const USCIS_SECTION = "uscis_filing";
const NOT_FILED_WITH_USCIS = new Set(["CVP - Consular Visa Process"].map(typeKey));
export const filedWithUscis = (f: Pick<ContractInput, "feeKTypes">) => !f.feeKTypes.some((t) => NOT_FILED_WITH_USCIS.has(typeKey(t)));

/** One row of the people loop per person. */
export function peopleRows(f: ContractInput): Record<string, string>[] {
  return peopleOf(f).map((p, i) => ({
    person_name: p.name, person_number: String(i + 1), person_a_number: p.aNumber,
    person_dob: dateEn(p.dob), person_dob_es: dateEs(p.dob),
  }));
}

/**
 * Motions that ride along with a Master Hearing (MASTER HEARING + MOTION Fee K).
 * Picking one in M22 fills both languages; anything else is typed by hand.
 */
export const MOTIONS: { en: string; es: string }[] = [
  { en: "Motion to Administratively Close", es: "Moción de Cierre Administrativo" },
  { en: "Motion to Recalendar", es: "Moción para Recalendarizar" },
  { en: "Motion to Reopen", es: "Moción para Reabrir" },
  { en: "Motion to Reconsider", es: "Moción de Reconsideración" },
  { en: "Motion to Change Venue", es: "Moción de Cambio de Sede" },
  { en: "Motion to Continue", es: "Moción de Aplazamiento" },
  { en: "Motion to Terminate", es: "Moción para Terminar el Procedimiento" },
  { en: "Motion to Dismiss", es: "Moción de Desestimación" },
  { en: "Motion to Advance", es: "Moción para Adelantar la Audiencia" },
];
/** The Spanish name for a listed motion ("" when it isn't one). */
export const motionEs = (en: string) => MOTIONS.find((m) => m.en.toLowerCase() === en.trim().toLowerCase())?.es ?? "";

const BY_TAG = new Map(CONTRACT_FIELDS.map((f) => [f.tag, f]));

/**
 * The contract's file name, the same everywhere (download, Adobe, the signed
 * copy in the E-File): "Client name - Form(s)/Matter - MM-DD-YYYY". Decided
 * 2026-10-15. A contract with a motion (motion_name) is named after it. A bilingual title typed into Form(s)/matter keeps its English
 * half ("… / I-212 Aplicación…" is dropped) and is capped at a word, so the
 * name stays readable in a folder.
 */
export function contractDocumentName(f: ContractInput, tags: string[] = []): string {
  const clean = (s: string) => s.replace(/[\\/:*?"<>|#%{}~&]+/g, " ").replace(/\s+/g, " ").trim();
  // MASTER HEARING + MOTION: the motion names the matter ("Master Hearing + Motion to Recalendar").
  const motion = tags.includes("motion_name") && has(f.motionName) ? `Master Hearing + ${f.motionName.trim()}` : "";
  // Several people: "Ana LOPEZ + 3" so the file still sorts under the client.
  const count = peopleOf(f).length;
  const client = clean(f.clientName);
  let matter = clean((motion || f.formName.trim() || f.hearingType.trim() || "Fee K").split(" / ")[0]!);
  if (matter.length > 80) matter = `${matter.slice(0, 80).replace(/\s+\S*$/, "")}…`;
  const p = ymd(f.date);
  const date = p ? `${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}-${p.y}` : "";
  // Several people: "… - Master Hearing (4 people) - …".
  if (count > 0) matter = `${matter} (${count} people)`;
  return [client, matter, date].filter(Boolean).join(" - ");
}

/**
 * Adobe Sign text tags — {{Sig_es_:signer1:signature}}, {{*Addr_es_:signer2}}…
 * — share our {{ }} braces. They always contain "_es_", are not ours to fill,
 * and must reach the PDF exactly as typed: Adobe turns each into a signing
 * field there (signer1 = attorney, signer2 = client; docs/features/esign-zapier.md).
 */
export const isAdobeSignTag = (tag: string) => /_es_/i.test(tag);

// Same delimiters as the rest of the app's templates (libs/template/src/docx.ts).
const OPTIONS = { delimiters: { start: "{{", end: "}}" }, paragraphLoop: true, linebreaks: true, nullGetter: () => "" };

export interface TemplateCheck {
  /** Known tags the template uses, in CONTRACT_FIELDS order, then the people loop and its tags. */
  tags: string[];
  /** Tags that aren't fields (typos) — the contract can't be generated. */
  unknown: string[];
  /** Adobe Sign text tags, passed through untouched. None = Adobe adds a signature page at the end. */
  signTags: string[];
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
      tags: [...CONTRACT_FIELDS.map((f) => f.tag), PEOPLE_SECTION, PEOPLE_LOOP, ...PERSON_TAGS, PRO_HAC_VICE_SECTION, USCIS_SECTION].filter((t) => found.has(t)),
      unknown: [...found].filter((t) => !BY_TAG.has(t) && t !== PEOPLE_SECTION && t !== PEOPLE_LOOP && !PERSON_TAGS.has(t) && t !== PRO_HAC_VICE_SECTION && t !== USCIS_SECTION && !isAdobeSignTag(t)),
      signTags: [...found].filter(isAdobeSignTag),
      errors: [],
    };
  } catch (e) {
    const err = e as DocxError;
    const list = err.properties?.errors?.map((x) => x.properties?.explanation ?? "").filter(Boolean)
      ?? [err.properties?.explanation ?? (e instanceof Error ? e.message : "This isn't a Word file the app can read")];
    return { tags: [], unknown: [], signTags: [], errors: list };
  }
}

/** The template lists or names the people a contract covers (M22 shows the People box). */
export const usesPeople = (check: TemplateCheck) =>
  check.tags.some((t) => t === PEOPLE_LOOP || t === PEOPLE_SECTION || t.startsWith("people_"));

/** The template has the optional pro hac vice clause (M22 shows its box). */
export const usesProHacVice = (check: TemplateCheck) =>
  check.tags.some((t) => t === PRO_HAC_VICE_SECTION || t.startsWith("pro_hac_vice_"));

/** What stops this template from being filled with this input. Empty = OK. */
export function contractProblems(check: TemplateCheck, input: ContractInput): string[] {
  const out = [...check.errors];
  if (check.unknown.length > 0) out.push(`Unknown field(s) in the template: ${check.unknown.map((t) => `{{${t}}}`).join(", ")}`);
  for (const tag of check.tags) {
    if (BY_TAG.get(tag)?.required?.(input)) out.push(`${BY_TAG.get(tag)!.label} is missing`);
  }
  if (input.multiplePeople && usesPeople(check) && peopleOf(input).length < MIN_PEOPLE) {
    out.push(`List at least ${MIN_PEOPLE} people, or untick "Contract is for more than one person"`);
  }
  return out;
}

export function contractValues(input: ContractInput): Record<string, string> {
  return Object.fromEntries(CONTRACT_FIELDS.map((f) => [f.tag, f.value(input)]));
}

const RUN_RE = /<w:r[ >](?:(?!<\/w:r>)[\s\S])*?<\/w:r>/g;
const HIGHLIGHT_RE = /<w:highlight\b[^>]*\/>/g;

/**
 * Staff mark the blanks in a template with Word's highlighter (magenta in the
 * 2026 COURT Fee K) so they're easy to spot while editing. The fill keeps a
 * run's formatting, so the colour would land on the client's contract: drop
 * the highlight from the runs that make up a {{tag}} (a tag can be split over
 * several runs), and leave every other highlight alone.
 */
export function unhighlightTags(xml: string): string {
  let open = false;
  // A paragraph holding a tag also carries the highlight on its end mark (pPr).
  const marks = xml.replace(/<w:p[ >](?:(?!<\/w:p>)[\s\S])*?<\/w:p>/g, (p) =>
    p.includes("{{") ? p.replace(/<w:pPr>[\s\S]*?<\/w:pPr>/, (ppr) => ppr.replace(HIGHLIGHT_RE, "")) : p);
  return marks.replace(RUN_RE, (run) => {
    const text = [...run.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("");
    const inTag = open || text.includes("{{");
    const lastOpen = text.lastIndexOf("{{");
    const lastClose = text.lastIndexOf("}}");
    if (lastOpen > lastClose) open = true;
    else if (lastClose > lastOpen) open = false;
    return inTag ? run.replace(HIGHLIGHT_RE, "") : run;
  });
}

/** The template with its tags' highlight removed (document, headers, footers). */
function withoutTagHighlight(file: ArrayBuffer): PizZip {
  const zip = new PizZip(file);
  for (const name of Object.keys(zip.files)) {
    if (!/^word\/(document|header\d*|footer\d*)\.xml$/.test(name)) continue;
    const xml = zip.file(name)!.asText();
    const clean = unhighlightTags(xml);
    if (clean !== xml) zip.file(name, clean);
  }
  return zip;
}

/** Fill a template. Call contractProblems first. */
export function fillContractTemplate(file: ArrayBuffer, input: ContractInput): Blob {
  const values: Record<string, unknown> = { ...contractValues(input), [PEOPLE_LOOP]: peopleRows(input), [PEOPLE_SECTION]: peopleOf(input).length > 0, [PRO_HAC_VICE_SECTION]: input.proHacVice, [USCIS_SECTION]: filedWithUscis(input) };
  const doc = new Docxtemplater(withoutTagHighlight(file), {
    ...OPTIONS,
    // Adobe Sign tags print back as they were typed (spaces included: they set the field's width).
    // Anything else is looked up in its scope: a person's row inside {{#people}}, else
    // undefined so docxtemplater moves out to the contract's values.
    parser: (tag: string) => ({
      get: (scope: unknown) => {
        if (isAdobeSignTag(tag)) return `{{${tag}}}`;
        const key = tag.trim();
        return scope && typeof scope === "object" && key in scope ? (scope as Record<string, unknown>)[key] : undefined;
      },
    }),
  });
  doc.render(values);
  return doc.getZip().generate({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    compression: "DEFLATE",
  }) as Blob;
}
