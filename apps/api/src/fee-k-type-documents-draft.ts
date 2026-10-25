// =============================================================================
// Fee K Types — suggested Buzón document lists (docs/features/buzon.md)
// =============================================================================
// What Settings → Firm → Fee K Types offers as "Use suggested list" for a case
// type whose Documents… is empty. A suggestion is used for NOTHING until an
// admin fills it in and saves (only the saved table drives the Buzón), so an
// attorney reviews every list first. Drafted 2026-10-24 from the usual USCIS /
// EOIR evidence for each type; Spanish drafted alongside, to be checked by staff.
//
// The client sees these names, and so does anyone holding their link. So:
// plain words, no legal terms, and for VAWA / U visa / T visa / asylum nothing
// that names what happened ("abuse", "crime", "persecution"): those lists ask
// for "the documents we talked about" instead.
// Types with no list (address changes, FOIA to EOIR, G-28, briefs, litigation…)
// need nothing from the client.
// =============================================================================

import type { CaseDocument } from "./fee-k-types.js";

type Doc = [en: string, es: string, required?: boolean];

// --- Building blocks -----------------------------------------------------------

const PASSPORT: Doc = ["Passport (the page with your photo)", "Pasaporte (la página con su foto)"];
const BIRTH: Doc = ["Birth certificate", "Acta de nacimiento"];
const PHOTO_ID: Doc = ["Photo ID (passport, consular ID or driver's license)", "Identificación con foto (pasaporte, matrícula consular o licencia)"];
const PAPERS: Doc = ["All your immigration papers (I-94, visas, USCIS or court notices)", "Todos sus papeles de inmigración (I-94, visas, cartas de USCIS o de la corte)"];
const ARRESTS: Doc = ["Police and court records, if you were ever arrested", "Records de policía y de corte, si alguna vez lo arrestaron", false];
const MARRIAGE: Doc = ["Marriage certificate", "Acta de matrimonio"];
const DIVORCES: Doc = ["Divorce papers from any earlier marriage", "Papeles de divorcio de cualquier matrimonio anterior", false];
const PETITIONER_STATUS: Doc = [
  "Proof your family member is a U.S. citizen or resident (passport, certificate or green card)",
  "Prueba de que su familiar es ciudadano o residente (pasaporte, certificado o tarjeta de residencia)",
];
const PETITIONER_ID: Doc = ["Your family member's photo ID", "Identificación con foto de su familiar"];
const LIVE_TOGETHER: Doc = [
  "Proof you live together (lease, bills, bank statements with both names)",
  "Prueba de que viven juntos (contrato de renta, recibos, estados de cuenta con los dos nombres)",
];
const PHOTOS_TOGETHER: Doc = ["Photos of you together over the years", "Fotos de ustedes juntos a lo largo de los años", false];
const TAXES: Doc = ["Tax returns, last 3 years", "Declaraciones de impuestos de los últimos 3 años"];
const JOB: Doc = ["Recent pay stubs or a letter from your job", "Talones de pago recientes o una carta de su trabajo"];
const SPONSOR_TAXES: Doc = ["Your sponsor's tax returns, last 3 years", "Declaraciones de impuestos de su patrocinador, últimos 3 años"];
const SPONSOR_JOB: Doc = ["Your sponsor's recent pay stubs or job letter", "Talones de pago recientes o carta de trabajo de su patrocinador"];
const MEDICAL: Doc = ["Medical exam (I-693), if you already have it", "Examen médico (I-693), si ya lo tiene", false];
const WORK_PERMIT: Doc = ["Your current work permit (front and back)", "Su permiso de trabajo actual (frente y reverso)"];
const GREEN_CARD: Doc = ["Your green card (front and back)", "Su tarjeta de residencia (frente y reverso)"];
const ENTRY: Doc = ["Proof of how and when you entered the U.S., if you have it", "Prueba de cómo y cuándo entró a Estados Unidos, si la tiene", false];
const PRESENCE: Doc = [
  "Proof you have lived in the U.S. (school, medical, bills, pay stubs), a few from each year",
  "Prueba de que ha vivido en Estados Unidos (escuela, médico, recibos, talones de pago), algunos de cada año",
];
const CHILDREN: Doc = ["Your children's birth certificates", "Actas de nacimiento de sus hijos", false];
const SUPPORT_LETTERS: Doc = ["Letters of support from family, church or work", "Cartas de apoyo de familia, iglesia o trabajo", false];
const HARDSHIP: Doc = [
  "Proof of how your family would suffer without you (medical, school, money)",
  "Prueba de cómo sufriría su familia sin usted (médica, escolar, económica)",
];
const TALKED_ABOUT: Doc = ["Other documents we talked about for your case", "Otros documentos de los que hablamos para su caso"];
const NOTICE: Doc = ["The letter from USCIS you want us to answer", "La carta de USCIS que quiere que contestemos"];
const COURT_NOTICE: Doc = ["Your latest notice from immigration court", "Su aviso más reciente de la corte de inmigración"];
const NTA: Doc = ["Notice to Appear (NTA), if you have it", "Aviso de comparecencia (NTA), si lo tiene", false];
const APPROVAL: Doc = ["The approval notice for your case", "La carta de aprobación de su caso"];

const FAMILY_PETITION: Doc[] = [PETITIONER_STATUS, PETITIONER_ID, BIRTH, PASSPORT, MARRIAGE, DIVORCES, LIVE_TOGETHER, PHOTOS_TOGETHER];
const ADJUSTMENT: Doc[] = [PASSPORT, BIRTH, PAPERS, ENTRY, TAXES, JOB, SPONSOR_TAXES, SPONSOR_JOB, MEDICAL, ARRESTS];
const ADJUST_BASIC: Doc[] = [PASSPORT, BIRTH, PAPERS, APPROVAL, MEDICAL, ARRESTS];
/** VAWA, U, T, asylum: neutral names only (see the header). */
const PROTECTED: Doc[] = [PASSPORT, BIRTH, PAPERS, TALKED_ABOUT, ARRESTS];
const CANCELLATION: Doc[] = [PHOTO_ID, PAPERS, PRESENCE, TAXES, CHILDREN, HARDSHIP, SUPPORT_LETTERS, ARRESTS];
const WAIVER: Doc[] = [PASSPORT, BIRTH, PAPERS, MARRIAGE, PETITIONER_STATUS, HARDSHIP, SUPPORT_LETTERS, ARRESTS];
const COURT: Doc[] = [PHOTO_ID, COURT_NOTICE, NTA, PAPERS, ARRESTS];
const BOND: Doc[] = [
  PHOTO_ID,
  ["Proof of where you will live (lease or a letter from who you'll live with)", "Prueba de dónde va a vivir (contrato de renta o carta de con quién va a vivir)"],
  ["Photo ID and status of the person who will pay the bond", "Identificación y estatus de la persona que va a pagar la fianza"],
  SUPPORT_LETTERS, CHILDREN, TAXES, ARRESTS,
];

const lists: Record<string, Doc[]> = {
  "I-485 + I-130 - Full Packet": [...FAMILY_PETITION, ...ADJUSTMENT.filter((d) => d !== PASSPORT && d !== BIRTH)],
  "I-130 - Petition for Alien Relative": FAMILY_PETITION,
  "I-485 - Adjustment of Status": [...ADJUSTMENT, APPROVAL],
  "I-485 - In Proceedings AOS (c)": [...ADJUSTMENT, COURT_NOTICE, APPROVAL],
  "I-485 - T Visa AOS": ADJUST_BASIC,
  "I-485 - UVisa AOS": [...ADJUST_BASIC, PRESENCE],
  "I-485 - VAWA AOS": ADJUST_BASIC,
  "I-485 - SIJS AOS": ADJUST_BASIC,
  "I-485 - CAA AOS": [PASSPORT, BIRTH, PAPERS, ENTRY, MEDICAL, ARRESTS],
  "I-765 - EAD Renewal": [WORK_PERMIT, PHOTO_ID, PAPERS],
  "I-765 - Initial EAD": [PHOTO_ID, PAPERS, ARRESTS],
  "I-131 - Advance Parole": [PHOTO_ID, PAPERS, ["Why and when you need to travel (letter, medical or family papers)", "Por qué y cuándo necesita viajar (carta, papeles médicos o familiares)"]],
  "I-131 - Military PIP Advance Parole": [PASSPORT, BIRTH, MARRIAGE, ["Your family member's military ID or service letter", "Identificación militar o carta de servicio de su familiar"], PAPERS],
  "I-821D - DACA - Childhood Deferred Action": [PHOTO_ID, PAPERS, ["Your current DACA approval or work permit", "Su aprobación de DACA o permiso de trabajo actual"], ARRESTS],
  "I-821 - TPS Deferred Action": [PASSPORT, BIRTH, PRESENCE, PAPERS, ARRESTS],
  "I-821 - Deferred Action": [PHOTO_ID, PAPERS, TALKED_ABOUT, ARRESTS],
  "I-129F - K1 Petition for Alien Fiancé(e)": [
    PETITIONER_STATUS, ["Your fiancé(e)'s passport", "Pasaporte de su prometido(a)"], DIVORCES,
    ["Proof you met in person in the last 2 years (photos, tickets, stamps)", "Prueba de que se conocieron en persona en los últimos 2 años (fotos, boletos, sellos)"],
    PHOTOS_TOGETHER,
  ],
  "I-360 - VAWA": PROTECTED,
  "I-360 - SIJS": [BIRTH, PASSPORT, ["The order from the state court (juvenile or family court)", "La orden de la corte estatal (corte juvenil o familiar)"], PAPERS],
  "I-751 - LPR Removal of Conditions": [GREEN_CARD, MARRIAGE, LIVE_TOGETHER, TAXES, CHILDREN, PHOTOS_TOGETHER, ARRESTS],
  "N-400 - Naturalization": [
    GREEN_CARD, PHOTO_ID, TAXES,
    ["Dates of every trip outside the U.S. in the last 5 years", "Fechas de cada viaje fuera de Estados Unidos en los últimos 5 años"],
    MARRIAGE, DIVORCES, ARRESTS,
  ],
  "N-600 - Certificate of Citizenship": [
    BIRTH, GREEN_CARD,
    ["Your U.S. citizen parent's birth certificate, passport or naturalization certificate", "Acta de nacimiento, pasaporte o certificado de naturalización de su padre o madre ciudadano"],
    ["Your parents' marriage certificate", "Acta de matrimonio de sus padres", false],
  ],
  "N-336 - Request for a Hearing Denied N400": [["The N-400 denial letter", "La carta de negación del N-400"], GREEN_CARD, TALKED_ABOUT],
  "I-90 - GC Renewal": [GREEN_CARD, PHOTO_ID],
  "I-90 - GC Replacement": [PHOTO_ID, ["A copy of your old green card, if you have one", "Una copia de su tarjeta de residencia anterior, si la tiene", false], ["Police report, if it was stolen", "Reporte de policía, si se la robaron", false]],
  "I-929 - Petition for Qualifying Family Member of a U-1 Nonimmigrant": [GREEN_CARD, ["Your family member's birth certificate or marriage certificate", "Acta de nacimiento o de matrimonio de su familiar"], ["Your family member's passport", "Pasaporte de su familiar"]],
  "I-918A - Supp of UVisa Derivative": [["Your family member's passport and birth certificate", "Pasaporte y acta de nacimiento de su familiar"], MARRIAGE, PAPERS],
  "I-918B - UVisa Certification Request": [PHOTO_ID, TALKED_ABOUT],
  "I-914 - TVisa": PROTECTED,
  "I-914 + I-192 - TVisa + Waiver": PROTECTED,
  "I-539 - Extend/Change Nonimmigrant Status": [PASSPORT, ["Your I-94 and current visa", "Su I-94 y su visa actual"], ["Proof you can support yourself (bank statements)", "Prueba de que puede mantenerse (estados de cuenta)"]],
  "I-824 - Action on an Approved Application or Petition": [APPROVAL, PHOTO_ID],
  "I-102 - Replacement of I94 Entry Doc": [PASSPORT, ["A copy of your I-94, if you have one", "Una copia de su I-94, si la tiene", false]],
  "I-290B - USCIS Appeal": [["The denial letter from USCIS", "La carta de negación de USCIS"], TALKED_ABOUT],
  "I-589 - Affirmative Asylum": [...PROTECTED, ENTRY],
  "I-589 - Defensive Asylum  (c)": [...PROTECTED, COURT_NOTICE],
  "E42A - LPR Cancellation of Removal (c)": [GREEN_CARD, COURT_NOTICE, ...CANCELLATION.filter((d) => d !== PHOTO_ID)],
  "E42B -  Cancellation of Removal (c)": [COURT_NOTICE, ...CANCELLATION],
  "CVP - Consular Visa Process": [PASSPORT, BIRTH, ["Police certificates from every country you lived in", "Cartas de antecedentes penales de cada país donde vivió"], MARRIAGE, SPONSOR_TAXES, SPONSOR_JOB, APPROVAL],
  "DS-160": [PASSPORT, ["Your travel plans (dates, where you'll stay)", "Sus planes de viaje (fechas, dónde se va a quedar)"], JOB],
  "Investigation": [PHOTO_ID, PAPERS, ARRESTS],
  "USCIS RFE Response": [NOTICE, TALKED_ABOUT],
  "USCIS NOID Response": [NOTICE, TALKED_ABOUT],
  "Interview Prep + Rep": [["Your interview appointment letter", "Su carta de cita para la entrevista"], PHOTO_ID, PAPERS],
  "Interview Prep Only": [["Your interview appointment letter", "Su carta de cita para la entrevista"], PAPERS],
  "FOIA": [PHOTO_ID],
  "FOIA - OBIM": [PHOTO_ID],
  "FOIA - FBI": [PHOTO_ID, ["Fingerprint card, if we gave you one to fill", "Tarjeta de huellas, si le dimos una para llenar", false]],
  "FOIA - OBIM + FBI": [PHOTO_ID],
  "Master (c)": COURT,
  "Detained Master (c)": [COURT_NOTICE, NTA, ["ID of a family member who can help us", "Identificación de un familiar que nos pueda ayudar", false], SUPPORT_LETTERS],
  "Trial (c)": [...COURT, TALKED_ABOUT, SUPPORT_LETTERS],
  "Trial Prep  (c)": [...COURT, TALKED_ABOUT, SUPPORT_LETTERS],
  "Trial/Trial Preparation  (c)": [...COURT, TALKED_ABOUT, SUPPORT_LETTERS],
  "DETAINED TP + T (c)": [COURT_NOTICE, NTA, TALKED_ABOUT, SUPPORT_LETTERS],
  "Motion (c)": [COURT_NOTICE, TALKED_ABOUT],
  "Bond MTN  (c)": BOND,
  "Emergency Bond MTN (c)": BOND,
  "PD Request (c)": [COURT_NOTICE, PRESENCE, TAXES, CHILDREN, SUPPORT_LETTERS, ARRESTS],
  "I-601A - Waiver": [...WAIVER, APPROVAL],
  "I-601 - Waiver": WAIVER,
  "I-212 - Waiver": [PASSPORT, ["Your deportation or removal papers", "Sus papeles de deportación"], PAPERS, SUPPORT_LETTERS],
  "I-601 + I-212 - Waiver": [...WAIVER, ["Your deportation or removal papers", "Sus papeles de deportación"]],
  "Criminal Consequences": [["Your criminal court papers (charges, plea, sentence)", "Sus papeles de la corte penal (cargos, acuerdo, sentencia)"], PAPERS],
};

const toDocs = (docs: Doc[]): CaseDocument[] => {
  const seen = new Set<string>();
  return docs.flatMap(([en, es, required = true]) => (seen.has(en) ? [] : (seen.add(en), [{ en, es, required }])));
};

/** Fee K Type → suggested checklist. Exact Monday labels (some have double spaces). */
export const SUGGESTED_DOCUMENTS: Record<string, CaseDocument[]> = Object.fromEntries(
  Object.entries(lists).map(([type, docs]) => [type, toDocs(docs)]),
);
