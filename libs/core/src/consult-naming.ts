// =============================================================================
// Consult folder naming
// =============================================================================
// Reproduces the convention the old Calendly→Zapier automation used, read back
// off the folders it left behind in SCAL Consults:
//
//   {YYYY} Consults / {initial} / {LASTNAME, Firstname}
//   2026 Consults / V / VENTURA, Milton
//
// Surname upper-cased, given name as typed ("SERRANO, annifesof" is a real
// folder). Pure and side-effect free so the whole rule is testable without a
// SharePoint call — which matters, because a wrong name here does not fail
// loudly, it silently creates a SECOND folder next to a client's real one.
//
// Zapier had clean first/last fields straight from Calendly. We have Monday's
// First Name / Last Name columns, which people also use to park notes:
//
//   last_name = "Ventura Corado [A221-455-213] (Det In Core Civic)"
//
// So anything bracketed is stripped. Whatever survives that and still looks
// wrong is REFUSED rather than guessed at — an unnamed row on a report costs
// somebody a minute, a wrong folder costs a cleanup nobody notices is needed.
// =============================================================================

export interface NameParts {
  firstName?: string | null;
  lastName?: string | null;
}

export interface ConsultFolderName {
  /** "VENTURA, Milton" */
  folder: string;
  /** "V" — the initial folder that sits between the year and the client. */
  initial: string;
  surname: string;
  given: string;
}

/** Why a profile can't be given a folder name automatically. */
export type NameRefusal =
  | "missing-first-name"
  | "missing-last-name"
  | "surname-not-alphabetic"
  | "given-name-looks-reversed"
  | "illegal-character";

export type NameResult =
  | { ok: true; name: ConsultFolderName }
  | { ok: false; reason: NameRefusal; detail: string };

/** Bracketed asides: "[A221-455-213]", "(Det In Core Civic)". */
const BRACKETED = /[[(][^\])]*[\])]/g;
/** SharePoint's own forbidden set, checked again here for a clear refusal. */
const ILLEGAL = /["*:<>?/\\|]/;

function clean(value: string | null | undefined): string {
  return (value ?? "")
    .replace(BRACKETED, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Derive the folder name for a consult, or refuse with a reason.
 *
 * The surname must be alphabetic once cleaned: a digit or a stray A-number
 * fragment surviving the strip means the column holds something other than a
 * name, and the row belongs on the review list.
 */
export function consultFolderName(parts: NameParts): NameResult {
  const given = clean(parts.firstName);
  const surname = clean(parts.lastName).toUpperCase();

  if (!given) return { ok: false, reason: "missing-first-name", detail: "First Name is empty" };
  if (!surname) return { ok: false, reason: "missing-last-name", detail: "Last Name is empty" };

  // A comma in the GIVEN name means the columns hold a reversed entry — the
  // profile "RAKHIMOV, SHUKHRAT" fills First Name with "RAKHIMOV," and Last Name
  // with "SHUKHRAT", which would build the folder "SHUKHRAT, RAKHIMOV,": a real
  // folder, in the wrong place, under a backwards name.
  if (given.includes(",")) {
    return {
      ok: false,
      reason: "given-name-looks-reversed",
      detail: `First Name reads "${given}" — the columns look swapped`,
    };
  }

  // Letters, spaces, hyphens and apostrophes only — covers "MONTES DE OCA",
  // "O'BRIEN", "GARCIA-LOPEZ", and rejects "A221-455-213" style leftovers.
  if (!/^[\p{L}][\p{L}\s'-]*$/u.test(surname)) {
    return { ok: false, reason: "surname-not-alphabetic", detail: `Last Name reads "${surname}"` };
  }

  const folder = `${surname}, ${given}`;
  if (ILLEGAL.test(folder)) {
    return { ok: false, reason: "illegal-character", detail: `"${folder}" contains " * : < > ? / \\ |` };
  }

  return { ok: true, name: { folder, initial: surname[0]!, surname, given } };
}

/** "2026 Consults/V/VENTURA, Milton" — the path under the document library. */
export function consultFolderPath(year: number, name: ConsultFolderName): string {
  return `${year} Consults/${name.initial}/${name.folder}`;
}
