// =============================================================================
// Consult document lists (P11.3.8) — the Buzón for consultations (docs/features/buzon.md, Phase 5)
// =============================================================================
// Named lists ("Consult – detained", "Consult – family petition"…) staff pick
// on a consult (P17 / M18 → Buzón → M30). Not tied to a Fee K Type: there is no
// Fee K yet. Their documents file to the client's Consult File → CONSULT, the
// same place Drive intake puts consult uploads.
//
// Stored in data/consult-lists.json, admin-only, audited. Until an admin saves,
// the starting lists below are used — unlike Fee K Types, nothing is written to
// Monday from them, and staff pick a list by hand each time.
// The client sees the document names (see fee-k-type-documents-draft.ts on
// plain, neutral wording).
// =============================================================================

import fs from "node:fs";
import path from "node:path";
import { sanitizeDocuments, type CaseDocument } from "./fee-k-types.js";

export interface ConsultList {
  /** Stable id, kept when the name changes: "detained". */
  key: string;
  name: string;
  documents: CaseDocument[];
}

const d = (en: string, es: string, required = true): CaseDocument => ({ en, es, required });
const PHOTO_ID = d("Photo ID (passport, consular ID or driver's license)", "Identificación con foto (pasaporte, matrícula consular o licencia)");
const PAPERS = d("All your immigration papers (I-94, visas, USCIS or court notices)", "Todos sus papeles de inmigración (I-94, visas, cartas de USCIS o de la corte)");
const ARRESTS = d("Police and court records, if you were ever arrested", "Records de policía y de corte, si alguna vez lo arrestaron", false);

export const DEFAULT_CONSULT_LISTS: ConsultList[] = [
  { key: "general", name: "Consult – general", documents: [PHOTO_ID, PAPERS, ARRESTS] },
  {
    key: "family",
    name: "Consult – family petition",
    documents: [
      PHOTO_ID, PAPERS,
      d("Proof your family member is a U.S. citizen or resident", "Prueba de que su familiar es ciudadano o residente"),
      d("Marriage or birth certificate that shows the relationship", "Acta de matrimonio o de nacimiento que muestre el parentesco"),
      ARRESTS,
    ],
  },
  {
    key: "court",
    name: "Consult – immigration court",
    documents: [
      PHOTO_ID,
      d("Your latest notice from immigration court", "Su aviso más reciente de la corte de inmigración"),
      d("Notice to Appear (NTA), if you have it", "Aviso de comparecencia (NTA), si lo tiene", false),
      PAPERS, ARRESTS,
    ],
  },
  {
    key: "detained",
    name: "Consult – detained",
    documents: [
      d("Photo ID of the family member we are talking to", "Identificación con foto del familiar con quien hablamos"),
      d("Any papers from ICE or the detention center", "Cualquier papel de ICE o del centro de detención"),
      d("Your family member's immigration papers, if you have them", "Papeles de inmigración de su familiar, si los tiene", false),
      d("Letters of support from family, church or work", "Cartas de apoyo de familia, iglesia o trabajo", false),
    ],
  },
  {
    key: "protected",
    name: "Consult – documents we talked about",
    documents: [PHOTO_ID, PAPERS, d("Other documents we talked about", "Otros documentos de los que hablamos")],
  },
];

const MAX_LISTS = 30;
let configPath: string | null = null;

export function initConsultLists(dataDir: string): void {
  configPath = path.join(dataDir, "consult-lists.json");
}

export function consultListsSaved(): boolean {
  return !!configPath && fs.existsSync(configPath);
}

/** The saved lists, else the starting ones. */
export function loadConsultLists(): ConsultList[] {
  if (!configPath || !fs.existsSync(configPath)) return structuredClone(DEFAULT_CONSULT_LISTS);
  try {
    return sanitizeConsultLists(JSON.parse(fs.readFileSync(configPath, "utf-8")));
  } catch {
    return structuredClone(DEFAULT_CONSULT_LISTS);
  }
}

export function saveConsultLists(input: unknown): ConsultList[] {
  if (!configPath) throw new Error("consult-lists path not initialized");
  const clean = sanitizeConsultLists(input);
  fs.writeFileSync(configPath, JSON.stringify(clean, null, 2));
  return clean;
}

const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

/** A list needs a name and a document; keys are unique (made from the name when missing). */
export function sanitizeConsultLists(input: unknown): ConsultList[] {
  const seen = new Set<string>();
  return (Array.isArray(input) ? input : []).flatMap((raw) => {
    const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name.replace(/\s+/g, " ").trim().slice(0, 80) : "";
    const documents = sanitizeDocuments(o.documents);
    if (!name || !documents.length) return [];
    let key = (typeof o.key === "string" && /^[a-z0-9-]{1,40}$/.test(o.key) ? o.key : slug(name)) || "list";
    for (let n = 2; seen.has(key); n++) key = `${key.replace(/-\d+$/, "")}-${n}`;
    seen.add(key);
    return [{ key, name, documents }];
  }).slice(0, MAX_LISTS);
}
