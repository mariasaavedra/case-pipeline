// =============================================================================
// Which folder belongs in a profile's empty link column
// =============================================================================
// consult-folders.ts starts from Calendly appointments. This starts from the
// PROFILE: every client whose E-File or Consult File column is empty, checked
// against every client folder in the three sites.
//
// Evidence, strongest first:
//
//   case_no    E-File folders end in the case number ("ABADE, Mohamed 20-089")
//              and the profile's Case No. holds the same number, usually
//              without the dash ("20089"). Number AND surname must agree.
//   name_year  A Consults folder whose name matches and whose year folder
//              agrees with the profile's Last Consult Date (±1).
//   name       Same normalised name, no corroboration.
//
// Confidence decides what --apply may write:
//
//   high    written by default
//   medium  written only with --include-medium
//   review  never written — listed for a human
//
// Only EMPTY columns are ever proposed. A link somebody entered is more
// trustworthy than anything inferred here, even when it looks wrong.
// =============================================================================

import { consultFolderName } from "./consult-naming.js";
import { buildFolderIndex, findMatch, looseCandidates, normalizeForMatch, type FolderRef } from "./match.js";
import { CONSULTS_SITE, EFILES_SITE, CLOSED_SITE } from "./scan.js";

export interface ProfileInput {
  localId: string;
  mondayId: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  caseNo: string | null;
  eFile: string | null;
  consultFile: string | null;
  /** YYYY-MM-DD, from Last Consult Date. */
  consultDate: string | null;
}

export type LinkColumn = "e_file" | "consult_file";
export type LinkMethod = "case_no" | "name_year" | "name";
export type LinkConfidence = "high" | "medium" | "review";

export interface LinkProposal {
  profile: ProfileInput;
  column: LinkColumn;
  /** The folder to record. Null only for a review row with several candidates. */
  folder: FolderRef | null;
  candidates: FolderRef[];
  method: LinkMethod;
  confidence: LinkConfidence;
  detail: string;
}

const EFILE_SITES = new Set([EFILES_SITE.toLowerCase(), CLOSED_SITE.toLowerCase()]);
/** Closed outranks E-Files: when a case finishes, the folder moves there. */
const SITE_RANK: Record<string, number> = { [EFILES_SITE.toLowerCase()]: 1, [CLOSED_SITE.toLowerCase()]: 2 };

/**
 * The case number at the end of a folder name, as "YY-NNN".
 *
 *   "ABADE, Mohamed 20-089"      → "20-089"
 *   "ABDULLAYAR Bek 22016"       → "22-016"
 *   "ABURTO HERNANDEZ, Sandra 1243" → "1243"   (older numbering)
 *
 * A trailing four-digit number that reads as a year is NOT a case number.
 */
export function folderCaseNo(name: string): string | null {
  const trimmed = name.trim();
  const modern = trimmed.match(/(?:^|[\s#])(\d{2})[\s-]?(\d{3,4})$/);
  if (modern) return `${modern[1]}-${modern[2]}`;
  const legacy = trimmed.match(/(?:^|\s)(\d{4})$/);
  if (legacy && !isYear(legacy[1]!)) return legacy[1]!;
  return null;
}

/**
 * The profile's Case No. in the same shape as folderCaseNo.
 *
 *   "26194" / "26-194"      → "26-194"
 *   "2024-037" / "2024020"  → "24-037" / "24-020"
 *   "1243"                  → "1243"
 *   "15191?", "DMS", an A-number → null (not trusted)
 */
export function profileCaseNo(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  const short = value.match(/^(\d{2})-?(\d{3,4})$/);
  if (short) return `${short[1]}-${short[2]}`;
  const longYear = value.match(/^(?:19|20)(\d{2})-?(\d{3})$/);
  if (longYear) return `${longYear[1]}-${longYear[2]}`;
  if (/^\d{4}$/.test(value) && !isYear(value)) return value;
  return null;
}

function isYear(four: string): boolean {
  const n = Number(four);
  return n >= 1990 && n <= 2035;
}

/** Surname tokens of a folder name. No comma → every token is a candidate. */
function folderSurnameTokens(name: string): string[] {
  const part = name.includes(",") ? name.slice(0, name.indexOf(",")) : name;
  return tokens(part);
}

function profileSurnameTokens(p: ProfileInput): string[] {
  const last = (p.lastName ?? "").replace(/\[[^\]]*\]|\([^)]*\)/g, " ");
  return tokens(last || p.name);
}

function tokens(s: string): string[] {
  return normalizeForMatch(s).split(" ").filter((t) => t.length >= 2 && !/^\d+$/.test(t));
}

function surnamesAgree(p: ProfileInput, folder: FolderRef): boolean {
  const mine = new Set(profileSurnameTokens(p));
  return folderSurnameTokens(folder.name).some((t) => mine.has(t));
}

/** "2024 Consults/G/GARCIA, Ana" → 2024. */
export function consultFolderYear(folder: FolderRef): number | null {
  const m = folder.path.match(/^(\d{4}) Consults\//i);
  return m ? Number(m[1]) : null;
}

/** "LASTNAME, Firstname" built the same way the consult automation names folders. */
function folderKeyFor(p: ProfileInput): string | null {
  const result = consultFolderName({ firstName: p.firstName, lastName: p.lastName });
  return result.ok ? result.name.folder : null;
}

/**
 * Several folders agree: prefer Closed over E-Files (the case moved on). Two
 * at the same place are a real collision and go to a human.
 */
function pickByLifecycle(folders: FolderRef[]): { folder: FolderRef | null; ambiguous: boolean } {
  const best = Math.max(...folders.map((f) => SITE_RANK[f.site.toLowerCase()] ?? 0));
  const top = folders.filter((f) => (SITE_RANK[f.site.toLowerCase()] ?? 0) === best);
  return top.length === 1 ? { folder: top[0]!, ambiguous: false } : { folder: null, ambiguous: true };
}

function describe(f: FolderRef): string {
  return `${f.site}/${f.path}`;
}

export function proposeLinks(profiles: ProfileInput[], folders: FolderRef[]): LinkProposal[] {
  const efileFolders = folders.filter((f) => EFILE_SITES.has(f.site.toLowerCase()));
  const consultFolders = folders.filter((f) => f.site.toLowerCase() === CONSULTS_SITE);

  const byCaseNo = new Map<string, FolderRef[]>();
  for (const f of efileFolders) {
    const cn = folderCaseNo(f.name);
    if (!cn) continue;
    byCaseNo.set(cn, [...(byCaseNo.get(cn) ?? []), f]);
  }
  const efIndex = buildFolderIndex(efileFolders);
  const coIndex = buildFolderIndex(consultFolders);

  const out: LinkProposal[] = [];

  const proposeEFile = (p: ProfileInput): LinkProposal | null => {
    const base = { profile: p, column: "e_file" as const };
    const cn = profileCaseNo(p.caseNo);

    if (cn) {
      const hits = byCaseNo.get(cn) ?? [];
      const agreeing = hits.filter((f) => surnamesAgree(p, f));
      if (agreeing.length) {
        const { folder, ambiguous } = pickByLifecycle(agreeing);
        if (ambiguous) {
          return { ...base, folder: null, candidates: agreeing, method: "case_no", confidence: "review",
            detail: `case no. ${cn} is on ${agreeing.length} folders: ${agreeing.map(describe).join(" | ")}` };
        }
        return { ...base, folder, candidates: agreeing, method: "case_no", confidence: "high",
          detail: `case no. ${cn} + surname` };
      }
      if (hits.length) {
        return { ...base, folder: null, candidates: hits, method: "case_no", confidence: "review",
          detail: `case no. ${cn} is on ${hits.map(describe).join(" | ")}, but the surname differs` };
      }
    }

    const key = folderKeyFor(p);
    if (!key) return null;
    const { match, ambiguous } = findMatch(efIndex, key);
    if (match) {
      const fcn = folderCaseNo(match.folder.name);
      if (cn && fcn && fcn !== cn) {
        return { ...base, folder: null, candidates: [match.folder], method: "name", confidence: "review",
          detail: `name matches ${describe(match.folder)}, but its case no. ${fcn} ≠ profile's ${cn}` };
      }
      return { ...base, folder: match.folder, candidates: [match.folder, ...match.alsoIn], method: "name",
        confidence: "medium", detail: `${match.confidence} name match` };
    }
    if (ambiguous.length) {
      return { ...base, folder: null, candidates: ambiguous, method: "name", confidence: "review",
        detail: `several folders named like this: ${ambiguous.map(describe).join(" | ")}` };
    }
    const loose = looseCandidates(efIndex, key);
    if (loose.length) {
      return { ...base, folder: null, candidates: loose, method: "name", confidence: "review",
        detail: `possible (given name shorter/longer): ${loose.map(describe).join(" | ")}` };
    }
    return null;
  };

  const proposeConsult = (p: ProfileInput): LinkProposal | null => {
    const base = { profile: p, column: "consult_file" as const };
    const key = folderKeyFor(p);
    if (!key) return null;
    const { match, ambiguous } = findMatch(coIndex, key);
    if (ambiguous.length) {
      return { ...base, folder: null, candidates: ambiguous, method: "name", confidence: "review",
        detail: `two folders with this name in the same year: ${ambiguous.map(describe).join(" | ")}` };
    }
    if (match) {
      const candidates = [match.folder, ...match.alsoIn];
      const year = p.consultDate ? Number(p.consultDate.slice(0, 4)) : null;
      if (year) {
        const exact = candidates.find((f) => consultFolderYear(f) === year);
        const near = exact ?? candidates.find((f) => Math.abs((consultFolderYear(f) ?? 0) - year) === 1);
        if (near) {
          return { ...base, folder: near, candidates, method: "name_year", confidence: "high",
            detail: `name + ${consultFolderYear(near)} folder (consult ${p.consultDate})` };
        }
        return { ...base, folder: null, candidates, method: "name", confidence: "review",
          detail: `name matches, but folder year(s) ${candidates.map(consultFolderYear).join(", ")} ≠ consult ${year}` };
      }
      return { ...base, folder: match.folder, candidates, method: "name", confidence: "medium",
        detail: `${match.confidence} name match, no consult date to confirm` };
    }
    const loose = looseCandidates(coIndex, key);
    if (loose.length) {
      return { ...base, folder: null, candidates: loose, method: "name", confidence: "review",
        detail: `possible (given name shorter/longer): ${loose.map(describe).join(" | ")}` };
    }
    return null;
  };

  for (const p of profiles) {
    let ef: LinkProposal | null = null;
    if (!p.eFile) {
      ef = proposeEFile(p);
      if (ef) out.push(ef);
    }
    // Consult File means "consulted, not hired" (see link-target.ts). A client
    // with an E-File — recorded or about to be — doesn't get one backfilled.
    const hired = !!p.eFile || (ef !== null && ef.confidence !== "review");
    if (!p.consultFile && !hired) {
      const co = proposeConsult(p);
      if (co) out.push(co);
    }
  }

  // One folder, two profiles: at least one of them is wrong, so neither is
  // written. (Family members sharing a case number land here.)
  const claims = new Map<string, LinkProposal[]>();
  for (const prop of out) {
    if (!prop.folder || prop.confidence === "review") continue;
    const key = prop.folder.id ?? describe(prop.folder);
    claims.set(key, [...(claims.get(key) ?? []), prop]);
  }
  for (const group of claims.values()) {
    if (group.length < 2) continue;
    const names = group.map((g) => g.profile.name).join(" | ");
    for (const prop of group) {
      prop.confidence = "review";
      prop.detail = `${prop.detail}; the same folder also matched: ${names}`;
    }
  }

  return out;
}
