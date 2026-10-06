// =============================================================================
// Document settings — firm-wide, admin-editable
// =============================================================================
// What generated forms (the G-28 first) need that Monday doesn't hold:
//   - firm: the office address / phone / fax every attorney shares
//   - attorneys: name, e-mail, USCIS online account no., bar admissions (one
//     marked default — Michael is admitted in KS and MO, MO goes on the form)
//   - facilities: the mailing address of each detention facility, keyed by the
//     Det. Facility label on the court case ("Greene Co. (MO)"), so a detained
//     client's address fills itself in
//
// Stored in data/document-settings.json. The defaults below are what the firm
// gave on 2026-10-06; the file overrides them once an admin saves. Readable by
// any authed user (the G-28 popup needs it); writable only by admins.
// =============================================================================

import fs from "node:fs";
import path from "node:path";

export interface FirmInfo {
  name: string;
  street: string;
  suite: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  fax: string;
}

export interface BarAdmission {
  /** Licensing authority as it goes on the form: "MO", "KS". */
  state: string;
  number: string;
}

export interface AttorneyInfo {
  /** Stable key — survives a rename. */
  id: string;
  givenName: string;
  familyName: string;
  email: string;
  mobile: string;
  uscisAccount: string;
  bars: BarAdmission[];
  /** Which of `bars` goes on the form by default (its `state`). */
  defaultBar: string;
}

export interface FacilityInfo {
  /** The Det. Facility label exactly as Monday has it. */
  label: string;
  /** Full name, for the street line ("Greene County Jail"). */
  name: string;
  street: string;
  city: string;
  state: string;
  zip: string;
}

export interface DocumentSettings {
  firm: FirmInfo;
  attorneys: AttorneyInfo[];
  facilities: FacilityInfo[];
}

export const DEFAULT_DOCUMENT_SETTINGS: DocumentSettings = {
  firm: {
    name: "Sharma-Crawford Attorneys at Law",
    street: "515 Avenida Cesar E. Chavez",
    suite: "",
    city: "Kansas City",
    state: "MO",
    zip: "64108",
    phone: "8169942300",
    fax: "8169942310",
  },
  attorneys: [
    {
      id: "michael",
      givenName: "Michael",
      familyName: "Sharma-Crawford",
      email: "michael@sharma-crawford.com",
      mobile: "",
      uscisAccount: "014168698175",
      bars: [{ state: "MO", number: "57287" }, { state: "KS", number: "20857" }],
      defaultBar: "MO",
    },
    {
      id: "lucy",
      givenName: "Lucy",
      familyName: "Betteridge",
      email: "lucy@sharma-crawford.com",
      mobile: "",
      uscisAccount: "036471776779",
      bars: [{ state: "MO", number: "62586" }],
      defaultBar: "MO",
    },
    {
      id: "rekha",
      givenName: "Rekha",
      familyName: "Sharma-Crawford",
      email: "",
      mobile: "",
      uscisAccount: "072332050022",
      bars: [{ state: "MO", number: "58404" }],
      defaultBar: "MO",
    },
  ],
  // Public addresses (ICE facility directory / sheriff's offices), except Core
  // Civic, which is the address the firm's own G-28s use. Check before relying.
  facilities: [
    { label: "Greene Co. (MO)", name: "Greene County Jail", street: "1199 N Haseltine Rd", city: "Springfield", state: "MO", zip: "65802" },
    { label: "Chase Co. (KS)", name: "Chase County Jail", street: "301 S Walnut St", city: "Cottonwood Falls", state: "KS", zip: "66845" },
    { label: "Ste. Genevieve (MO)", name: "Ste. Genevieve County Detention Center", street: "5 Basler Dr", city: "Ste. Genevieve", state: "MO", zip: "63670" },
    { label: "Phelps Co. (MO)", name: "Phelps County Jail", street: "500 W 2nd St", city: "Rolla", state: "MO", zip: "65401" },
    { label: "Kay Co. (MO)", name: "Kay County Detention Center", street: "1101 W Dry Rd", city: "Newkirk", state: "OK", zip: "74647" },
    { label: "Core Civic", name: "CoreCivic Leavenworth", street: "831 Sabalu Rd", city: "Leavenworth", state: "KS", zip: "66027" },
  ],
};

let configPath: string | null = null;

export function initDocumentSettings(dataDir: string): void {
  configPath = path.join(dataDir, "document-settings.json");
}

export function loadDocumentSettings(): DocumentSettings {
  if (!configPath) return structuredClone(DEFAULT_DOCUMENT_SETTINGS);
  try {
    return sanitizeDocumentSettings(JSON.parse(fs.readFileSync(configPath, "utf-8")));
  } catch {
    return structuredClone(DEFAULT_DOCUMENT_SETTINGS);
  }
}

export function saveDocumentSettings(input: unknown): DocumentSettings {
  if (!configPath) throw new Error("document-settings path not initialized");
  const clean = sanitizeDocumentSettings(input);
  fs.writeFileSync(configPath, JSON.stringify(clean, null, 2));
  return clean;
}

const str = (v: unknown, max = 200): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const obj = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/**
 * Coerce untrusted input into valid settings. A missing section falls back to
 * the default; a present one is taken as given (an admin may empty a list).
 * Attorneys without a name and facilities without a label are dropped.
 */
export function sanitizeDocumentSettings(input: unknown): DocumentSettings {
  const o = obj(input);
  const d = DEFAULT_DOCUMENT_SETTINGS;

  const f = obj(o.firm);
  const firm: FirmInfo = "firm" in o
    ? { name: str(f.name), street: str(f.street), suite: str(f.suite), city: str(f.city), state: str(f.state, 2).toUpperCase(), zip: str(f.zip, 10), phone: str(f.phone, 30), fax: str(f.fax, 30) }
    : { ...d.firm };

  const seen = new Set<string>();
  const attorneys: AttorneyInfo[] = "attorneys" in o
    ? arr(o.attorneys).flatMap((raw) => {
        const a = obj(raw);
        const givenName = str(a.givenName);
        const familyName = str(a.familyName);
        if (!givenName && !familyName) return [];
        let id = str(a.id, 60) || `${givenName}-${familyName}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        while (seen.has(id)) id += "-2";
        seen.add(id);
        const bars = arr(a.bars)
          .map((b) => ({ state: str(obj(b).state, 2).toUpperCase(), number: str(obj(b).number, 30) }))
          .filter((b) => b.state || b.number);
        const defaultBar = bars.some((b) => b.state === str(a.defaultBar, 2).toUpperCase())
          ? str(a.defaultBar, 2).toUpperCase()
          : bars[0]?.state ?? "";
        return [{ id, givenName, familyName, email: str(a.email), mobile: str(a.mobile, 30), uscisAccount: str(a.uscisAccount, 20), bars, defaultBar }];
      })
    : structuredClone(d.attorneys);

  const facilities: FacilityInfo[] = "facilities" in o
    ? arr(o.facilities).flatMap((raw) => {
        const x = obj(raw);
        const label = str(x.label);
        if (!label) return [];
        return [{ label, name: str(x.name), street: str(x.street), city: str(x.city), state: str(x.state, 2).toUpperCase(), zip: str(x.zip, 10) }];
      })
    : structuredClone(d.facilities);

  return { firm, attorneys, facilities };
}
