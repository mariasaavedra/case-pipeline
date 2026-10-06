// =============================================================================
// G-28 — Notice of Entry of Appearance (USCIS, edition 09/17/18)
// =============================================================================
// templates/forms/g-28.pdf is the official fillable form with every field
// empty. The copy USCIS publishes is encrypted, which pdf-lib can't edit, so the
// template was made from a firm-filled copy (same edition) with every value
// cleared — checked to carry nothing of that client.
//
//   g28Prefill  — what the popup starts with: the attorney from Settings (the
//                 client's own attorney when it matches), the client from
//                 Monday, and a detained client's facility as their mailing
//                 address ("IN ICE CUSTODY …", as the firm writes it).
//   fillG28     — the edited values → the filled PDF. Every empty text box gets
//                 "N/A", as USCIS asks; signatures and their dates stay empty
//                 (signed by hand).
// =============================================================================

import { PDFDocument, PDFTextField, StandardFonts } from "pdf-lib";
import type { AttorneyInfo, DocumentSettings, FacilityInfo } from "./document-settings.js";
import { splitUsAddress, type UnitType } from "./us-address.js";

export type G28Agency = "uscis" | "ice" | "cbp";
export type G28ClientRole = "applicant" | "petitioner" | "requestor" | "beneficiary" | "respondent";

export interface G28Address {
  street: string;
  unitType: UnitType;
  unit: string;
  city: string;
  state: string;
  zip: string;
  province: string;
  postalCode: string;
  country: string;
}

export interface G28Input {
  attorney: {
    /** Settings id it was picked from; "" when typed by hand. */
    id: string;
    familyName: string;
    givenName: string;
    middleName: string;
    uscisAccount: string;
    address: G28Address;
    phone: string;
    mobile: string;
    email: string;
    fax: string;
    licensingAuthority: string;
    barNumber: string;
    firmName: string;
    /** Part 2 1.c — "I am / am not subject to any order …". */
    subjectToOrders: boolean;
  };
  matter: {
    agency: G28Agency;
    /** USCIS: form numbers ("I-589, I-765"). */
    uscisForms: string;
    /** ICE / CBP: the specific matter ("Consult only"). */
    specificMatter: string;
    receiptNumber: string;
    clientRole: G28ClientRole;
  };
  client: {
    familyName: string;
    givenName: string;
    middleName: string;
    aNumber: string;
    uscisAccount: string;
    phone: string;
    mobile: string;
    email: string;
    address: G28Address;
  };
  /**
   * Part 4, "Options Regarding Receipt of USCIS Notices" — printed 1.a–1.c
   * (the PDF names the boxes Pt4Line2a–2c).
   */
  notices: {
    /** 1.a original notices → attorney */
    originalsToAttorney: boolean;
    /** 1.b secure identity documents (green card, EAD, travel doc) → attorney */
    cardsToAttorney: boolean;
    /** 1.c the I-94 notice → client's U.S. mailing address */
    i94ToClient: boolean;
  };
}

/** What the popup also shows next to the form: where pre-filled values came from. */
export interface G28Prefill {
  input: G28Input;
  detainedAt: string | null;
  /** The detained client's facility had no address in Settings. */
  facilityMissing: boolean;
  /** Profile phone / e-mail left out because the client is detained. */
  profileContact: { phone: string; email: string };
  /** The profile's attorney, as Monday names them. */
  mondayAttorney: string;
}

export const US_COUNTRY = "UNITED STATES OF AMERICA";

const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

/** US phone → the 10 digits the form takes (drops a leading 1). */
export function formPhone(s: string | null | undefined): string {
  const d = digits(s);
  return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
}

/** "A-241-045-572" / "241045572" → "241045572"; an 8-digit A# gets its leading 0. */
export function formANumber(s: string | null | undefined): string {
  const d = digits(s);
  return d.length === 8 ? `0${d}` : d;
}

/** The Settings attorney matching Monday's "Attorney" label ("Rekha@Sharma- com" included). */
export function matchAttorney(attorneys: AttorneyInfo[], mondayLabel: string | null | undefined): AttorneyInfo | null {
  const first = (mondayLabel ?? "").split(",")[0]!.trim().toLowerCase();
  if (!first) return null;
  return (
    attorneys.find((a) => first === `${a.givenName} ${a.familyName}`.toLowerCase()) ??
    attorneys.find((a) => a.givenName && first.split(/[\s@]+/)[0] === a.givenName.toLowerCase()) ??
    null
  );
}

export function attorneyFields(a: AttorneyInfo | null, firm: DocumentSettings["firm"]): G28Input["attorney"] {
  const bar = a?.bars.find((b) => b.state === a.defaultBar) ?? a?.bars[0];
  return {
    id: a?.id ?? "",
    familyName: a?.familyName ?? "",
    givenName: a?.givenName ?? "",
    middleName: "",
    uscisAccount: a?.uscisAccount ?? "",
    address: {
      street: firm.street, unitType: firm.suite ? "ste" : "", unit: firm.suite,
      city: firm.city, state: firm.state, zip: firm.zip, province: "", postalCode: "", country: US_COUNTRY,
    },
    phone: formPhone(firm.phone),
    mobile: formPhone(a?.mobile),
    email: a?.email ?? "",
    fax: formPhone(firm.fax),
    licensingAuthority: bar?.state ?? "",
    barNumber: bar?.number ?? "",
    firmName: firm.name,
    subjectToOrders: false,
  };
}

export function facilityAddress(f: FacilityInfo): G28Address {
  return {
    street: `IN ICE CUSTODY ${f.street}`.trim(), unitType: "", unit: "",
    city: f.city, state: f.state, zip: f.zip, province: "", postalCode: "", country: US_COUNTRY,
  };
}

/** The profile's row, as the prefill route reads it. */
export interface G28ProfileRow {
  name: string;
  firstName: string | null;
  lastName: string | null;
  middleName: string | null;
  aNumber: string | null;
  phone: string | null;
  email: string | null;
  mailingAddress: string | null;
  physicalAddress: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  attorney: string | null;
}

/** Staff park notes in the name columns — "[A221-455-213] (Det In Core Civic)". */
const cleanName = (s: string | null | undefined) =>
  (s ?? "").replace(/\[[^\]]*\]?|\([^)]*\)?/g, " ").replace(/\s+/g, " ").trim();

export function g28Prefill(p: G28ProfileRow, settings: DocumentSettings, detainedAt: string | null): G28Prefill {
  const attorney = matchAttorney(settings.attorneys, p.attorney) ?? settings.attorneys[0] ?? null;
  const facility = detainedAt ? settings.facilities.find((f) => f.label === detainedAt) ?? null : null;

  let family = cleanName(p.lastName);
  let given = cleanName(p.firstName);
  if (!family && !given) {
    // Only the item name: "First Last" — the last word is the family name.
    const words = cleanName(p.name).split(" ");
    family = words.length > 1 ? words.pop()! : words[0] ?? "";
    given = words.length > 0 && words[0] !== family ? words.join(" ") : "";
  }

  const line = (p.mailingAddress ?? "").trim() || (p.physicalAddress ?? "").trim();
  const split = splitUsAddress(line);
  const profileAddress: G28Address = {
    ...split,
    // The separate City / State / Zip columns fill what the line didn't say.
    city: split.city || (p.city ?? "").trim(),
    state: split.state || ((p.state ?? "").trim().length === 2 ? p.state!.trim().toUpperCase() : ""),
    zip: split.zip || digits(p.zip).slice(0, 5),
    province: "", postalCode: "", country: US_COUNTRY,
  };

  const detained = !!detainedAt;
  return {
    input: {
      attorney: attorneyFields(attorney, settings.firm),
      matter: detained
        ? { agency: "ice", uscisForms: "", specificMatter: "Consult only", receiptNumber: "", clientRole: "respondent" }
        : { agency: "uscis", uscisForms: "", specificMatter: "", receiptNumber: "", clientRole: "applicant" },
      client: {
        familyName: family.toUpperCase(),
        givenName: given,
        middleName: cleanName(p.middleName),
        aNumber: formANumber(p.aNumber),
        uscisAccount: "",
        // A detained client can't be reached on the profile's numbers — those
        // are family's. The popup shows them in case they're wanted.
        phone: detained ? "" : formPhone(p.phone),
        mobile: "",
        email: detained ? "" : (p.email ?? "").trim(),
        address: facility ? facilityAddress(facility) : profileAddress,
      },
      notices: { originalsToAttorney: true, cardsToAttorney: true, i94ToClient: false },
    },
    detainedAt,
    facilityMissing: detained && !facility,
    profileContact: { phone: formPhone(p.phone), email: (p.email ?? "").trim() },
    mondayAttorney: (p.attorney ?? "").trim(),
  };
}

// ---- Validation -------------------------------------------------------------

/**
 * The form's own box sizes (the PDF's maxLength). The popup caps its inputs at
 * these, and g28Problems refuses anything longer rather than cutting it off.
 * Keyed "<section>.<field>", address fields as "<section>.address.<field>".
 */
export const G28_LIMITS: Record<string, number> = {
  "attorney.uscisAccount": 12, "attorney.phone": 10, "attorney.mobile": 10, "attorney.fax": 10,
  "attorney.email": 38, "attorney.barNumber": 10,
  "attorney.address.street": 34, "attorney.address.unit": 6, "attorney.address.city": 20,
  "attorney.address.zip": 5, "attorney.address.province": 20, "attorney.address.postalCode": 9,
  "matter.uscisForms": 30, "matter.specificMatter": 30, "matter.receiptNumber": 13,
  "client.uscisAccount": 12, "client.aNumber": 9, "client.phone": 10, "client.mobile": 10, "client.email": 38,
  "client.address.street": 34, "client.address.unit": 6, "client.address.city": 20,
  "client.address.zip": 5, "client.address.province": 20, "client.address.postalCode": 9,
};

const LABELS: Record<string, string> = {
  street: "Street", unit: "Apt/Ste/Flr", city: "City", zip: "ZIP", province: "Province", postalCode: "Postal code",
  uscisAccount: "USCIS account no.", phone: "Phone", mobile: "Mobile", fax: "Fax", email: "Email",
  barNumber: "Bar number", firmName: "Firm name", uscisForms: "Form number(s)", specificMatter: "Matter",
  receiptNumber: "Receipt number", aNumber: "A-Number",
};

function valueAt(i: G28Input, key: string): string {
  let v: unknown = i;
  for (const k of key.split(".")) v = (v as Record<string, unknown> | undefined)?.[k];
  return typeof v === "string" ? v.trim() : "";
}

/** What must be fixed before the PDF is made. Empty = OK. */
export function g28Problems(i: G28Input): string[] {
  const out: string[] = [];
  for (const [key, max] of Object.entries(G28_LIMITS)) {
    const len = valueAt(i, key).length;
    if (len > max) {
      const [section, ...rest] = key.split(".");
      out.push(`${section === "matter" ? "" : section === "client" ? "Client " : "Attorney "}${LABELS[rest[rest.length - 1]!] ?? key}: ${len} characters, the form fits ${max}.`.trim());
    }
  }
  if (!i.attorney.familyName || !i.attorney.givenName) out.push("Attorney name is missing.");
  if (!i.attorney.barNumber) out.push("Attorney bar number is missing.");
  if (!i.client.familyName) out.push("Client family (last) name is missing.");
  if (i.client.aNumber && !/^\d{9}$/.test(i.client.aNumber)) out.push("A-Number must be 9 digits.");
  if (i.matter.agency === "uscis" && !i.matter.uscisForms.trim()) out.push("List the USCIS form number(s).");
  if (i.matter.agency !== "uscis" && !i.matter.specificMatter.trim()) out.push(`Describe the ${i.matter.agency.toUpperCase()} matter.`);
  for (const [who, p] of [["Attorney", i.attorney.phone], ["Attorney fax", i.attorney.fax], ["Client", i.client.phone]] as const) {
    if (p && !/^\d{10}$/.test(p)) out.push(`${who} phone must be 10 digits.`);
  }
  return out;
}

// ---- Filling the PDF --------------------------------------------------------

const P1 = "form1[0].#subform[0].";
const P2 = "form1[0].#subform[1].";
const P3 = "form1[0].#subform[2].";
const P4 = "form1[0].#subform[3].";

/** Left empty on purpose — signed and dated by hand; barcodes aren't text. */
const NEVER_NA = new Set([
  `${P3}Line1_Signature[0]`, `${P3}Line2_SignatureStudent[0]`, `${P3}P5_Line6a_SignatureofApplicant[0]`,
  `${P3}Line3_Date[0]`, `${P3}Pt5Line2b_DateofSignature[0]`, `${P3}Pt4Line2b_DateofSignature[0]`,
]);

/** Part 3 item 5 — the box for each role (export values A / P / R / BD / B). */
const ROLE_BOX: Record<G28ClientRole, string> = {
  requestor: `${P2}Line4_Checkbox[0]`,
  applicant: `${P2}Line4_Checkbox[1]`,
  respondent: `${P2}Line4_Checkbox[2]`,
  petitioner: `${P2}Line4_Checkbox[3]`,
  beneficiary: `${P2}Line4_Checkbox[4]`,
};

/** Unit boxes: [0] Suite, [1] Floor, [2] Apartment. */
const UNIT_INDEX: Record<Exclude<UnitType, "">, number> = { ste: 0, flr: 1, apt: 2 };

export async function fillG28(template: Uint8Array, i: G28Input): Promise<Uint8Array> {
  const doc = await PDFDocument.load(template);
  const form = doc.getForm();
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);

  const text = (name: string, value: string) => {
    const f = form.getTextField(name);
    const max = f.getMaxLength();
    const v = value.replace(/\s+/g, " ").trim();
    f.setText(max !== undefined ? v.slice(0, max) : v);
    // The boxes don't shrink their text: "IN ICE CUSTODY 1199 N Haseltine Rd"
    // fits the 34 characters but not the width at 10 pt. Shrink just that box.
    if (!v || f.isCombed()) return;
    const size = Number(/([\d.]+)\s+Tf/.exec(f.acroField.getDefaultAppearance() ?? "")?.[1]) || 10;
    const width = f.acroField.getWidgets()[0]?.getRectangle().width ?? 0;
    const fits = (width - 4) / helvetica.widthOfTextAtSize(v, 1);
    if (width > 0 && fits < size) f.setFontSize(Math.max(6, Math.floor(fits * 2) / 2));
  };
  const check = (name: string, on: boolean) => {
    const b = form.getCheckBox(name);
    if (on) b.check();
    else b.uncheck();
  };
  const state = (name: string, value: string) => {
    const d = form.getDropdown(name);
    if (d.getOptions().includes(value)) d.select(value);
    else d.clear();
  };
  const address = (prefix: string, street: string, unitBox: string, unitText: string, a: G28Address, keys: { city: string; state: string; zip: string; province: string; postal: string; country: string }) => {
    text(prefix + street, a.street);
    for (const [type, idx] of Object.entries(UNIT_INDEX)) check(`${prefix}${unitBox}[${idx}]`, a.unitType === type);
    text(prefix + unitText, a.unit);
    text(prefix + keys.city, a.city);
    state(prefix + keys.state, a.state);
    text(prefix + keys.zip, a.zip);
    text(prefix + keys.province, a.province);
    text(prefix + keys.postal, a.postalCode);
    text(prefix + keys.country, a.country);
  };

  // Part 1 — attorney.
  const at = i.attorney;
  text(`${P1}#area[0].Pt1Line1_USCISOnlineAcctNumber[0]`, at.uscisAccount);
  text(`${P1}Pt1Line2a_FamilyName[0]`, at.familyName);
  text(`${P1}Pt1Line2b_GivenName[0]`, at.givenName);
  text(`${P1}Pt1Line2c_MiddleName[0]`, at.middleName);
  address(P1, "Line3a_StreetNumber[0]", "Line3b_Unit", "Line3b_AptSteFlrNumber[0]", at.address, {
    city: "Line3c_CityOrTown[0]", state: "Line3d_State[0]", zip: "Line3e_ZipCode[0]",
    province: "Line3f_Province[0]", postal: "Line3g_PostalCode[0]", country: "Line3h_Country[0]",
  });
  text(`${P1}Line4_DaytimeTelephoneNumber[0]`, at.phone);
  // USCIS swapped these two names: "Line6_EMail" is item 5, Mobile (10 digits),
  // and "Line7_MobileTelephoneNumber" is item 6, Email — per their tooltips.
  text(`${P1}Line6_EMail[0]`, at.mobile);
  text(`${P1}Line7_MobileTelephoneNumber[0]`, at.email);
  text(`${P1}Pt1ItemNumber7_FaxNumber[0]`, at.fax);

  // Part 2 — eligibility: an attorney (1.a), not subject to any order (1.c).
  check(`${P1}CheckBox1[0]`, true);
  text(`${P1}Pt2Line1a_LicensingAuthority[0]`, at.licensingAuthority);
  text(`${P1}Pt2Line1b_BarNumber[0]`, at.barNumber);
  check(`${P1}Checkbox1dAm[0]`, at.subjectToOrders);
  check(`${P1}Checkbox1dAmNot[0]`, !at.subjectToOrders);
  // The box says 30 characters but "Sharma-Crawford Attorneys at Law" is 32 and
  // the firm's own G-28s carry it whole — so this one isn't capped.
  form.getTextField(`${P1}Pt2Line1d_NameofFirmOrOrganization[0]`).setMaxLength(undefined);
  text(`${P1}Pt2Line1d_NameofFirmOrOrganization[0]`, at.firmName);

  // Part 3 — the appearance.
  const m = i.matter;
  check(`${P2}Line1a_USCIS[0]`, m.agency === "uscis");
  text(`${P2}Line1b_ListFormNumber[0]`, m.agency === "uscis" ? m.uscisForms : "");
  check(`${P2}Line2a_ICE[0]`, m.agency === "ice");
  text(`${P2}Line2b_ListMatter[0]`, m.agency === "ice" ? m.specificMatter : "");
  check(`${P2}Line3a_CBP[0]`, m.agency === "cbp");
  text(`${P2}Line3b_ListSpecificMatter[0]`, m.agency === "cbp" ? m.specificMatter : "");
  text(`${P2}Pt3Line4_ReceiptNumber[0]`, m.receiptNumber);
  for (const [role, box] of Object.entries(ROLE_BOX)) check(box, role === m.clientRole);

  const c = i.client;
  text(`${P2}Pt3Line5a_FamilyName[0]`, c.familyName);
  text(`${P2}Pt3Line5b_GivenName[0]`, c.givenName);
  text(`${P2}Pt3Line5c_MiddleName[0]`, c.middleName);
  text(`${P2}#area[1].Pt3Line8_USCISOnlineAcctNumber[0]`, c.uscisAccount);
  text(`${P2}Pt3Line9_ANumber[0]`, c.aNumber);
  text(`${P2}Line9_DaytimeTelephoneNumber[0]`, c.phone);
  text(`${P2}Line10_MobileTelephoneNumber[0]`, c.mobile);
  text(`${P2}Line11_EMail[0]`, c.email);
  address(P2, "Line12a_StreetNumberName[0]", "Line12b_Unit", "Line12b_AptSteFlrNumber[0]", c.address, {
    city: "Line12c_CityOrTown[0]", state: "Line12d_State[0]", zip: "Line12e_ZipCode[0]",
    province: "Line12f_Province[0]", postal: "Line12g_PostalCode[0]", country: "Line12h_Country[0]",
  });

  // Part 4 — where USCIS sends notices.
  check(`${P3}Pt4Line2a_CheckBox2a[0]`, i.notices.originalsToAttorney);
  check(`${P3}Pt4Line2b_CheckBox2b[0]`, i.notices.cardsToAttorney);
  check(`${P3}Pt4Line2c_CheckBox2c[0]`, i.notices.i94ToClient);

  // Part 6 header repeats the client's name.
  text(`${P4}Pt3Line5a_FamilyName[1]`, c.familyName);
  text(`${P4}Pt3Line5b_GivenName[1]`, c.givenName);
  text(`${P4}Pt3Line5c_MiddleName[1]`, c.middleName);

  // Everything still empty reads N/A — except boxes too short for it (Part 6's
  // two-character page numbers).
  for (const f of form.getFields()) {
    if (!(f instanceof PDFTextField) || NEVER_NA.has(f.getName()) || f.getName().includes("BarCode")) continue;
    if ((f.getMaxLength() ?? 3) < 3) continue;
    if (!(f.getText() ?? "").trim()) f.setText("N/A");
  }

  return doc.save();
}

// ---- Untrusted input ---------------------------------------------------------

const s = (v: unknown, max = 200) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const o = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);

function sanitizeAddress(raw: unknown): G28Address {
  const a = o(raw);
  return {
    street: s(a.street), unitType: pick(a.unitType, ["", "apt", "ste", "flr"] as const, ""), unit: s(a.unit),
    city: s(a.city), state: s(a.state, 2).toUpperCase(), zip: s(a.zip, 10), province: s(a.province),
    postalCode: s(a.postalCode), country: s(a.country),
  };
}

/** The popup's body → a G28Input; anything missing or of the wrong type becomes empty. */
export function sanitizeG28Input(raw: unknown): G28Input {
  const r = o(raw);
  const a = o(r.attorney);
  const m = o(r.matter);
  const c = o(r.client);
  const n = o(r.notices);
  return {
    attorney: {
      id: s(a.id, 60), familyName: s(a.familyName), givenName: s(a.givenName), middleName: s(a.middleName),
      uscisAccount: s(a.uscisAccount), address: sanitizeAddress(a.address),
      phone: formPhone(s(a.phone)), mobile: formPhone(s(a.mobile)), email: s(a.email), fax: formPhone(s(a.fax)),
      licensingAuthority: s(a.licensingAuthority, 66), barNumber: s(a.barNumber), firmName: s(a.firmName),
      subjectToOrders: a.subjectToOrders === true,
    },
    matter: {
      agency: pick(m.agency, ["uscis", "ice", "cbp"] as const, "uscis"),
      uscisForms: s(m.uscisForms), specificMatter: s(m.specificMatter), receiptNumber: s(m.receiptNumber),
      clientRole: pick(m.clientRole, ["applicant", "petitioner", "requestor", "beneficiary", "respondent"] as const, "applicant"),
    },
    client: {
      familyName: s(c.familyName), givenName: s(c.givenName), middleName: s(c.middleName),
      aNumber: formANumber(s(c.aNumber)), uscisAccount: s(c.uscisAccount),
      phone: formPhone(s(c.phone)), mobile: formPhone(s(c.mobile)), email: s(c.email),
      address: sanitizeAddress(c.address),
    },
    notices: {
      originalsToAttorney: n.originalsToAttorney === true,
      cardsToAttorney: n.cardsToAttorney === true,
      i94ToClient: n.i94ToClient === true,
    },
  };
}

/** "G-28 – LASTNAME First – 2026-10-06.pdf" */
export function g28FileName(i: G28Input, isoDate: string): string {
  const who = [i.client.familyName, i.client.givenName].filter(Boolean).join(" ").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  return `G-28 – ${who || "client"} – ${isoDate}.pdf`;
}
