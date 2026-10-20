// =============================================================================
// Fee K Types — the starting draft (P11.3.6)
// =============================================================================
// What Settings → Firm → Fee K Types shows until an admin first saves the
// table. Only a SAVED table is used (the auto-fill reads data/fee-k-types.json),
// so nothing here reaches Monday before someone reviews it.
//
// Boards: where Fee Ks were actually sent, from "It will go to…" on ~1,700 Fee
// Ks under their old "Contract for…" labels (2026-10-20); the clear majority,
// with "Already in board" read as the board the case already lives on. Left
// empty where staff split between boards (the waivers: Open Forms vs Waivers)
// or no board fits (address changes, PD requests, briefs, the 10th Circuit
// argument, criminal consequences).
// Spanish: reviewed by Rafael 2026-10-20. Fee sheet jobs: matched to "FINAL
// COPY OF FIRM FEES 2026.xlsx" (Sheet1, 2026-10-20); empty where no job fits.
// Picked among several (check in Settings): DACA → renewal-our client, TPS →
// initial, Deferred Action → initial, N-600 → simple, 42A / 42B → non
// emergency, Detained Master → Master Hearing, NOID → simple, Interview Prep +
// Rep → Interview (KC only).
// =============================================================================

import type { FeeKTypeRow } from "./fee-k-types.js";

const OF = "Open Forms";
const OFC = "Open Forms-Court Forms";

const rows: [feeKType: string, spanish: string, board: string, feeSheetJob: string][] = [
  ["I-485 + I-130 - Full Packet", "Paquete completo: ajuste de estatus (I-485) y petición familiar (I-130)", OF, "Full Packet"],
  ["I-130 - Petition for Alien Relative", "Petición de familiar extranjero (I-130)", OF, "I-130 (Online)"],
  ["I-485 - Adjustment of Status", "Ajuste de estatus (I-485)", OF, "I-485 (adjustment only- family based)"],
  ["I-485 - In Proceedings AOS (c)", "Ajuste de estatus ante la Corte de Inmigración (I-485)", OFC, "I-485 (Adjustment of Status in Court)"],
  ["I-485 - T Visa AOS", "Ajuste de estatus por visa T (I-485)", OF, ""],
  ["I-485 - UVisa AOS", "Ajuste de estatus por visa U (I-485)", OF, "I-485 (U-Visa Adjustment)"],
  ["I-485 - VAWA AOS", "Ajuste de estatus por VAWA (I-485)", OF, ""],
  ["I-485 - SIJS AOS", "Ajuste de estatus por SIJS (I-485)", OF, "I-485 only (refugee or SIJS )"],
  ["I-485 - CAA AOS", "Ajuste de estatus por la Ley de Ajuste Cubano (I-485)", OF, "I-485 (Cuban Adjustment Act)"],
  ["I-765 - EAD Renewal", "Renovación del permiso de trabajo (I-765)", OF, "I-765 (online)- See EAD tab"],
  ["I-765 - Initial EAD", "Permiso de trabajo inicial (I-765)", OF, "I-765 (online)- See EAD tab"],
  ["I-131 - Advance Parole", "Permiso de viaje / Advance Parole (I-131)", OF, "I-131 Advance parole"],
  ["I-131 - Military PIP Advance Parole", "Permiso de viaje por Parole in Place militar (I-131)", OF, "I-131 PIP (Military based)"],
  ["I-821D - DACA - Childhood Deferred Action", "DACA: acción diferida para los llegados en la infancia (I-821D)", OF, "DACA (renewal-our client)"],
  ["I-821 - TPS Deferred Action", "Estatus de protección temporal, TPS (I-821)", OF, "TPS (initial/late initial)"],
  ["I-821 - Deferred Action", "Acción diferida (I-821)", OF, "Deferred Action Initial (non DACA)"],
  ["I-129F - K1 Petition for Alien Fiancé(e)", "Petición de visa K-1 para prometido(a) (I-129F)", OF, "I-129F (K-1)"],
  ["I-360 - VAWA", "Autopetición VAWA (I-360)", OF, "VAWA (I-360)"],
  ["I-360 - SIJS", "Petición de estatus especial de inmigrante juvenil, SIJS (I-360)", OF, "SIJS (I-360)"],
  ["I-751 - LPR Removal of Conditions", "Eliminación de condiciones de la residencia (I-751)", OF, "I-751 (Removal of Conditions)"],
  ["N-400 - Naturalization", "Ciudadanía / naturalización (N-400)", OF, "N-400"],
  ["N-600 - Certificate of Citizenship", "Certificado de ciudadanía (N-600)", OF, "N-600 (simple)"],
  ["N-336 - Request for a Hearing Denied N400", "Solicitud de audiencia por N-400 negada (N-336)", OF, ""],
  ["I-90 - GC Renewal", "Renovación de la tarjeta de residencia (I-90)", OF, "I-90"],
  ["I-90 - GC Replacement", "Reemplazo de la tarjeta de residencia (I-90)", OF, "I-90"],
  ["I-929 - Petition for Qualifying Family Member of a U-1 Nonimmigrant", "Petición para familiar calificado de titular de visa U (I-929)", OF, "I-929"],
  ["I-918A - Supp of UVisa Derivative", "Petición para familiar derivado de visa U (I-918A)", OF, ""],
  ["I-918B - UVisa Certification Request", "Solicitud de certificación para visa U (I-918B)", "I-918Bs", "I-918B"],
  ["I-914 - TVisa", "Visa T (I-914)", OF, "I-914/I-192 (T-Visa) each derivative $2500.00"],
  ["I-914 + I-192 - TVisa + Waiver", "Visa T y perdón (I-914 e I-192)", OF, "I-914/I-192 (T-Visa) each derivative $2500.00"],
  ["I-539 - Extend/Change Nonimmigrant Status", "Extensión o cambio de estatus de no inmigrante (I-539)", OF, "I-539 (Change or extension of Status )"],
  ["I-824 - Action on an Approved Application or Petition", "Acción sobre una solicitud o petición aprobada (I-824)", OF, "I-824"],
  ["I-102 - Replacement of I94 Entry Doc", "Reemplazo del registro de entrada I-94 (I-102)", OF, ""],
  ["I-290B - USCIS Appeal", "Apelación o moción ante USCIS (I-290B)", OF, "I-290B"],
  ["I-589 - Affirmative Asylum", "Asilo afirmativo (I-589)", OF, "I-589 (Asylum)"],
  ["I-589 - Defensive Asylum  (c)", "Asilo defensivo ante la Corte de Inmigración (I-589)", OFC, "I-589 (Asylum)"],
  ["E42A - LPR Cancellation of Removal (c)", "Cancelación de deportación para residentes permanentes (EOIR-42A)", OFC, "EOIR 42A(non emergency)"],
  ["E42B -  Cancellation of Removal (c)", "Cancelación de deportación para no residentes (EOIR-42B)", OFC, "EOIR 42B(non emergency)"],
  ["CVP - Consular Visa Process", "Proceso consular de visa", OF, "Consular Processing (visa Packet)"],
  ["DS-160", "Solicitud de visa de no inmigrante (DS-160)", OF, "DS-160 (NVC Non-immigrant Application)"],
  ["G28 - USCIS Entry of Appearance", "Representación ante USCIS (G-28)", OF, ""],
  ["Adams packet", "Paquete Adams", OF, ""],
  ["File Copy", "Copia del expediente", OF, "File Copy"],
  ["Investigation", "Investigación de antecedentes migratorios", OF, "Investigation Fee"],
  ["USCIS RFE Response", "Respuesta a solicitud de evidencia (RFE) de USCIS", "RFEs", "Normal RFE"],
  ["USCIS NOID Response", "Respuesta a aviso de intención de negar (NOID) de USCIS", "RFEs", "NOID (simple)"],
  ["Interview Prep + Rep", "Preparación y representación en la entrevista", "Interviews", "Interview (KC only)"],
  ["Interview Prep Only", "Preparación para la entrevista (sin representación)", "Interviews", "Interview Prep (only)"],
  ["FOIA", "Solicitud de expediente (FOIA)", "FOIA requests", "FOIA (G639)"],
  ["FOIA - EOIR", "Solicitud de expediente (FOIA) a la Corte de Inmigración (EOIR)", "FOIA requests", "FOIA (EOIR)"],
  ["FOIA - OBIM", "Solicitud de expediente (FOIA) a OBIM", "FOIA requests", ""],
  ["FOIA - FBI", "Solicitud de antecedentes al FBI (FOIA)", "FOIA requests", ""],
  ["FOIA - OBIM + FBI", "Solicitud de expediente (FOIA) a OBIM y al FBI", "FOIA requests", "FOIA (OBIM + FBI)"],
  ["Master (c)", "Audiencia preliminar (master)", "Court Cases", "Master Hearing"],
  ["Detained Master (c)", "Audiencia preliminar (master) con detención", "Court Cases", "Master Hearing"],
  ["Trial (c)", "Juicio", "Court Cases", "Trial"],
  ["Trial Prep  (c)", "Preparación del juicio", "Court Cases", "Trial Prep"],
  ["Trial/Trial Preparation  (c)", "Juicio y preparación del juicio", "Court Cases", ""],
  ["DETAINED TP + T (c)", "Preparación del juicio y juicio con detención", "Court Cases", ""],
  ["Motion (c)", "Moción ante la Corte de Inmigración", "Motions", ""],
  ["Bond MTN  (c)", "Moción de fianza", "Motions", "Motion for Bond-non emergency"],
  ["Emergency Bond MTN (c)", "Moción de fianza de emergencia", "Motions", "Motion for Bond-emergency"],
  ["E26 - BIA Appeal (c)", "Apelación ante la Junta de Apelaciones de Inmigración (EOIR-26)", "Appeals", "BIA Appeal"],
  ["BRIEF - BIA Appeal (2nd half)  (c)", "Escrito de apelación ante la Junta de Apelaciones (segunda parte)", "Appeals", ""],
  ["Habeas", "Hábeas corpus", "Litigations", ""],
  ["Mandamus", "Demanda de mandamus", "Litigations", "Mandamus/APA"],
  ["Litigation", "Litigio", "Litigations", ""],
  ["Federal Litigation", "Litigio federal", "Litigations", ""],
  ["AAF - Annual Asylum Fee", "Cuota anual de asilo", "Already in board", ""],
  // No board yet: staff split between Open Forms and Waivers.
  ["I-601A - Waiver", "Perdón provisional por presencia ilegal (I-601A)", "", "I-601A (Waiver for unlawful presence)"],
  ["I-601 - Waiver", "Perdón de inadmisibilidad (I-601)", "", "I-601 (only)"],
  ["I-212 - Waiver", "Permiso para volver a solicitar admisión (I-212)", "", "I-212, Application for Permission to Reapply for Admission into the United States After Deportation or Removal"],
  ["I-601 + I-212 - Waiver", "Perdones de inadmisibilidad (I-601 e I-212)", "", ""],
  // No board yet: none of the "It will go to…" boards fits.
  ["E33 - Address Change (c)", "Cambio de dirección ante la Corte de Inmigración (EOIR-33)", "", "Address Changes for Immigration court"],
  ["AR-11 - USCIS Address Change", "Cambio de dirección ante USCIS (AR-11)", "", "USCIS Address changes"],
  ["Address Change - E33 + AR11", "Cambio de dirección ante la Corte y USCIS (EOIR-33 y AR-11)", "", ""],
  ["PD Request (c)", "Solicitud de discreción procesal ante la Corte de Inmigración", "", "PD Requests (Immigration Court)"],
  ["Brief  (c)", "Escrito legal (brief) ante la Corte de Inmigración", "", ""],
  ["Oral Argument 10th Circuit Court", "Argumento oral ante la Corte de Apelaciones del Décimo Circuito", "", "Oral Argument"],
  ["Criminal Consequences", "Consecuencias migratorias de un caso penal", "", "Criminal Consequence letter"],
];

export const DRAFT_FEE_K_TYPES: FeeKTypeRow[] = rows.map(([feeKType, spanish, board, feeSheetJob]) => ({ feeKType, spanish, board, feeSheetJob }));
