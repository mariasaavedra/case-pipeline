// =============================================================================
// E-Files to open (P21) — the hire protocol queue + its plan
// =============================================================================
// Fee Ks that are paid and waiting for their E-File: Contract Stage "Paid needs
// action" or "Open E FILE". For each one, what opening it would do — which of
// the four paths it takes, the case number, the folder, the Monday changes,
// the ledger row. Phase 1 only shows the plan; nothing here writes.
// See docs/features/consult-to-efile.md.

import type BetterSqlite3 from "better-sqlite3";
import { feeKCaseTypeSql } from "./fee-k-case-type";
type Database = BetterSqlite3.Database;

// =============================================================================
// Types
// =============================================================================

/** efile = new E-File · court = new E-File + court folders · foia = consult folder → FOIA · existing = already has an E-File. */
export type HirePath = "efile" | "court" | "foia" | "existing";

export interface MondayChange {
  /** Where: "Fee K", "Profile", or "Appointment · <name>". */
  item: string;
  column: string;
  from: string | null;
  to: string;
}

export interface HirePlan {
  path: HirePath;
  /** Why this path, in words. */
  pathReason: string;
  /** "26-231": the client's own number (existing), the next free one (new), null (FOIA). */
  caseNo: string | null;
  caseNoIsNew: boolean;
  /** Folder to create, relative to SCAL E-Files ("D/DE LA O, Karla 26-228"); null when none is created. */
  newFolderPath: string | null;
  subfolders: string[];
  /** Where the consult folder's files go, in words. Null when there is no consult folder. */
  consultFilesTo: string | null;
  /** The consult folder is deleted after its files are copied (FOIA: moved instead). */
  deletesConsultFolder: boolean;
  mondayChanges: MondayChange[];
  /** The row added to the ledger's tab for `ledgerTab`; null = no row (FOIA, existing client). */
  ledgerRow: LedgerRow | null;
  ledgerTab: string | null;
  /** Goes through Prescheduling (documents to collect) before its board; false = PS Stage isn't set. */
  prescheduling: boolean;
  /** Anything that stops the protocol from running. */
  blockers: string[];
  /** Things to check by hand; the protocol can still run. */
  warnings: string[];
}

export interface LedgerRow {
  caseNo: string;
  /** "First LASTNAME" — the ledger's format since 2023. */
  name: string;
  dateOpened: string;
  caseType: string;
  /** Address · phone · e-mail. */
  information: string;
}

export interface EFileToOpen {
  feeKLocalId: string;
  mondayItemId: string | null;
  clientName: string;
  clientLocalId: string | null;
  feeKTypes: string[];
  itWillGoTo: string | null;
  contractStage: string;
  psStage: string | null;
  /** Hire date on the Fee K (the day it was paid). */
  hireDate: string | null;
  daysWaiting: number | null;
  /** The profile's links, as stored on Monday. */
  eFileUrl: string | null;
  consultFileUrl: string | null;
  /** The consult folder as the SharePoint catalog knows it ("2026 Consults/D/DE LA O, Karla"), when matched. */
  consultFolderPath: string | null;
  plan: HirePlan;
}

export interface EFilesToOpenResult {
  /** Oldest hire first. */
  items: EFileToOpen[];
  /** The next free case number from Monday + the E-File folder names. The ledger is checked in the browser. */
  nextCaseNo: string;
  /** The highest number already used this year, and where it was seen. */
  highestCaseNo: { caseNo: string; source: "profile" | "e_file_folder" } | null;
}

export interface EFilesToOpenOptions {
  /** ISO date to measure from (tests). Default today. */
  today?: string;
  /** Fee K Type → the board it goes to once paid (Settings → Fee K Types). Used when the Fee K's own "It will go to…" is empty. */
  boardForType?: (feeKType: string) => string | undefined;
  /** Whether a Fee K with these types goes through Prescheduling (Settings → Fee K Types). Default yes. */
  prescheduling?: (feeKTypes: string[]) => boolean;
}

// =============================================================================
// Constants
// =============================================================================

/** Contract Stage labels that put a Fee K in the queue, compared by normalizeStage. */
export const QUEUE_STAGES = ["Paid needs action", "Open E FILE"];
/** Contract Stage once the E-File is open. */
export const OPENED_STAGE = "E-file OPENED";
/** PS Stage a new hire starts at (only written when empty). */
export const FIRST_PS_STAGE = "Need to contact client";

/** What staff create on every new E-File (DE LA O, Karla 26-228, 2026-10-21). */
export const STANDARD_SUBFOLDERS = [
  "CCs",
  "COMMUNICATIONS",
  "CONSULT",
  "CRIMINAL HISTORY",
  "DRAFTS",
  "EVIDENCE",
  "FEE K's",
  "FILINGS & RESPONSES - USCIS",
  "FPs",
];
/** Added for court cases; anything else on a court E-File is made when needed (staff, 2026-10-22). */
export const COURT_SUBFOLDERS = ["NTA", "FILINGS & RESPONSES - COURT", "TRIAL FILE"];

const COURT_BOARD = /court cases|motions/i;
const FOIA = /foia/i;

// =============================================================================
// Helpers
// =============================================================================

/** "Open E-FILE", "open e file" and "E-File opened" vs "E-file OPENED" compare equal. */
export function normalizeStage(label: string | null | undefined): string {
  return (label ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** "26228", "26-228", "26 - 228" → "26-228". Legacy 4-digit numbers and anything else → null. */
export function normalizeCaseNo(raw: string | null | undefined): string | null {
  const m = /^\s*(\d{2})\s*-*\s*(\d{3})\s*$/.exec(raw ?? "");
  return m ? `${m[1]}-${m[2]}` : null;
}

/** "26-231" → "26231", how Case No. is written on Monday. */
export function caseNoForMonday(caseNo: string): string {
  return caseNo.replace("-", "");
}

/** Folder name: "DE LA O, Karla 26-228". */
export function eFileFolderName(lastName: string, firstName: string, caseNo: string): string {
  return `${lastName.trim().toUpperCase()}, ${firstName.trim()} ${caseNo}`;
}

/** Path inside SCAL E-Files: "{initial}/{folder}". */
export function eFileFolderPath(folderName: string): string {
  return `${folderName.charAt(0).toUpperCase()}/${folderName}`;
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 86_400_000);
}

function parseLabels(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const labels: unknown = JSON.parse(raw);
    return Array.isArray(labels) ? labels.filter((l): l is string => typeof l === "string" && l.trim() !== "") : [];
  } catch {
    return [];
  }
}

function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** A link compared without its query, trailing slash, case or %-encoding. */
function linkKey(url: string): string {
  let u = url.trim();
  try {
    u = decodeURIComponent(u);
  } catch {
    // keep as is
  }
  return u.split("?")[0]!.replace(/\/+$/, "").toLowerCase();
}

/**
 * The highest YY-NNN in use this year: Case No. on every profile, and the
 * suffix of every E-File folder the SharePoint catalog has seen.
 */
export function highestCaseNo(db: Database, year: string): EFilesToOpenResult["highestCaseNo"] {
  let best: EFilesToOpenResult["highestCaseNo"] = null;
  const consider = (raw: string | null, source: "profile" | "e_file_folder") => {
    const n = normalizeCaseNo(raw);
    if (!n || !n.startsWith(`${year}-`)) return;
    if (!best || n > best.caseNo) best = { caseNo: n, source };
  };
  const profiles = db
    .prepare(`SELECT json_extract(raw_column_values, '$.case_no') AS v FROM profiles WHERE deleted_at IS NULL`)
    .all() as { v: unknown }[];
  for (const p of profiles) consider(typeof p.v === "string" ? p.v : null, "profile");
  const folders = db
    .prepare(`SELECT case_no AS v FROM sp_folders WHERE site = 'scalefiles' AND missing_since IS NULL AND case_no LIKE ?`)
    .all(`${year}-%`) as { v: string | null }[];
  for (const f of folders) consider(f.v, "e_file_folder");
  return best;
}

/** The number after `caseNo` ("26-230" → "26-231"); the year's first when none. */
export function nextCaseNo(highest: string | null, year: string): string {
  const n = highest ? Number(highest.slice(3)) + 1 : 1;
  return `${year}-${String(n).padStart(3, "0")}`;
}

// =============================================================================
// Plan
// =============================================================================

export interface PlanInput {
  feeKTypes: string[];
  itWillGoTo: string | null;
  contractStage: string;
  psStage: string | null;
  hireDate: string | null;
  firstName: string | null;
  lastName: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  caseNo: string | null;
  eFileUrl: string | null;
  /** E-File folder found by case number when the profile has no link. */
  eFileFolderPath: string | null;
  consultFileUrl: string | null;
  consultFolderPath: string | null;
  /** Appointments whose Consult SharePoint column holds a link. */
  appointmentsWithConsultLink: { name: string; link: string }[];
  /** Goes through Prescheduling first. Missing = yes. */
  prescheduling?: boolean;
}

/** What opening this hire would do. Pure: the same input gives the same plan. */
export function buildHirePlan(input: PlanInput, freeCaseNo: string, today: string): HirePlan {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const hasEFile = !!input.eFileUrl || !!input.eFileFolderPath;
  const isFoia = input.feeKTypes.some((t) => FOIA.test(t)) || FOIA.test(input.itWillGoTo ?? "");
  const isCourt = COURT_BOARD.test(input.itWillGoTo ?? "");
  const hasConsult = !!input.consultFileUrl;

  const path: HirePath = hasEFile ? "existing" : isFoia ? "foia" : isCourt ? "court" : "efile";
  const pathReason =
    path === "existing"
      ? input.eFileUrl
        ? "The client already has an E-File"
        : `An E-File folder already has their case number (${input.eFileFolderPath})`
      : path === "foia"
        ? "FOIA hire: no E-File, no case number"
        : path === "court"
          ? `Goes to ${input.itWillGoTo}: E-File + court folders`
          : `Goes to ${input.itWillGoTo ?? "a board not set yet"}: new E-File`;

  if (input.feeKTypes.length === 0) warnings.push("The Fee K has no Fee K Type");
  if (!input.itWillGoTo && path !== "existing" && path !== "foia") warnings.push('"It will go to…" is empty, so court folders can\'t be decided');

  const newFile = path === "efile" || path === "court";
  const caseNo = path === "existing" ? normalizeCaseNo(input.caseNo) : newFile ? freeCaseNo : null;
  if (path === "existing" && !caseNo) warnings.push("The client has an E-File but no Case No. on the profile");
  if (newFile && input.caseNo) {
    warnings.push(`The profile already has Case No. ${input.caseNo} but no E-File: check before giving a new number`);
  }

  let newFolderPath: string | null = null;
  if (newFile) {
    if (!input.lastName || !input.firstName) blockers.push("First Name and Last Name are needed on the profile to name the folder");
    else newFolderPath = eFileFolderPath(eFileFolderName(input.lastName, input.firstName, freeCaseNo));
  }
  if (path === "foia" && !hasConsult) blockers.push("No consult folder on the profile to move to FOIA");
  if (newFile && !hasConsult) warnings.push("No consult folder on the profile: the E-File starts empty");
  if (hasConsult && !input.consultFolderPath) warnings.push("The consult folder link isn't in the SharePoint catalog yet: checked again when it runs");

  const subfolders = newFile ? [...STANDARD_SUBFOLDERS, ...(path === "court" ? COURT_SUBFOLDERS : [])] : [];
  const consultFilesTo = !hasConsult
    ? null
    : path === "foia"
      ? "The whole consult folder moves to SCAL Consults / FOIA"
      : path === "existing"
        ? "Into CONSULT in the client's E-File"
        : "Into CONSULT in the new E-File";

  // Monday: the new link replaces the consult folder everywhere it is stored.
  const target = path === "foia" ? "the folder in FOIA" : newFolderPath ? "the new E-File" : "the E-File";
  const mondayChanges: MondayChange[] = [
    { item: "Fee K", column: "Contract Stage", from: input.contractStage, to: OPENED_STAGE },
  ];
  const prescheduling = input.prescheduling !== false;
  if (prescheduling && !input.psStage) mondayChanges.push({ item: "Fee K", column: "PS Stage", from: null, to: FIRST_PS_STAGE });
  if (newFile) {
    mondayChanges.push({ item: "Profile", column: "E-File", from: input.eFileUrl, to: `Link to ${target}` });
    mondayChanges.push({ item: "Profile", column: "Case No.", from: input.caseNo, to: caseNoForMonday(freeCaseNo) });
  }
  if (hasConsult) {
    mondayChanges.push({ item: "Profile", column: "Consult File", from: input.consultFileUrl, to: `Link to ${target}` });
    const consultKey = linkKey(input.consultFileUrl!);
    for (const a of input.appointmentsWithConsultLink) {
      if (linkKey(a.link) !== consultKey) continue;
      mondayChanges.push({ item: `Appointment · ${a.name}`, column: "Consult SharePoint", from: a.link, to: `Link to ${target}` });
    }
  }

  const ledgerRow: LedgerRow | null =
    newFile && caseNo
      ? {
          caseNo,
          name: [input.firstName?.trim(), input.lastName?.trim().toUpperCase()].filter(Boolean).join(" "),
          dateOpened: input.hireDate ?? today,
          caseType: input.feeKTypes.join(", "),
          information: [input.address, input.phone, input.email].map((v) => v?.trim()).filter(Boolean).join(" · "),
        }
      : null;
  if (ledgerRow && !input.hireDate) warnings.push("No hire date on the Fee K: the ledger gets today's date");

  return {
    path,
    pathReason,
    caseNo,
    caseNoIsNew: newFile,
    newFolderPath,
    subfolders,
    consultFilesTo,
    deletesConsultFolder: hasConsult && path !== "foia",
    mondayChanges,
    ledgerRow,
    ledgerTab: ledgerRow ? `20${ledgerRow.caseNo.slice(0, 2)}` : null,
    prescheduling,
    blockers,
    warnings,
  };
}

// =============================================================================
// Query
// =============================================================================

interface RawRow {
  localId: string;
  mondayItemId: string | null;
  name: string;
  clientLocalId: string | null;
  clientName: string | null;
  profileRaw: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  contractStage: string | null;
  psStage: string | null;
  itWillGoTo: string | null;
  feeKTypes: string | null;
  hireDate: string | null;
}

export function getEFilesToOpen(db: Database, options: EFilesToOpenOptions = {}): EFilesToOpenResult {
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const year = today.slice(2, 4);
  const highest = highestCaseNo(db, year);
  const free = nextCaseNo(highest?.caseNo ?? null, year);
  const queue = new Set(QUEUE_STAGES.map(normalizeStage));

  const rows = (
    db.prepare(`
      SELECT
        c.local_id       AS localId,
        c.monday_item_id AS mondayItemId,
        c.name,
        p.local_id       AS clientLocalId,
        p.name           AS clientName,
        p.raw_column_values AS profileRaw,
        p.address, p.phone, p.email,
        json_extract(c.raw_column_values, '$.contract_stage.label') AS contractStage,
        json_extract(c.raw_column_values, '$.ps_stage.label')       AS psStage,
        json_extract(c.raw_column_values, '$.it_will_go_to.label')  AS itWillGoTo,
        ${feeKCaseTypeSql()}                                        AS feeKTypes,
        json_extract(c.raw_column_values, '$.hire_date.date')       AS hireDate
      FROM contracts c
      LEFT JOIN profiles p ON p.local_id = c.profile_local_id
      WHERE c.deleted_at IS NULL
    `).all() as RawRow[]
  ).filter((r) => queue.has(normalizeStage(r.contractStage)));

  const consultFolders = db
    .prepare(`SELECT path, web_url AS url FROM sp_folders WHERE site = 'scalconsults' AND missing_since IS NULL`)
    .all() as { path: string; url: string }[];
  const consultByLink = new Map(consultFolders.map((f) => [linkKey(f.url), f.path]));
  const eFileByCaseNo = db.prepare(
    `SELECT path FROM sp_folders WHERE site = 'scalefiles' AND missing_since IS NULL AND case_no = ? LIMIT 1`,
  );
  const appointments = db.prepare(`
    SELECT name, json_extract(column_values, '$.consult_sharepoint') AS link
    FROM board_items
    WHERE profile_local_id = ? AND board_key LIKE 'appointments_%' AND deleted_at IS NULL
  `);

  const items = rows.map((r): EFileToOpen => {
    let cvs: Record<string, unknown> = {};
    try {
      cvs = r.profileRaw ? (JSON.parse(r.profileRaw) as Record<string, unknown>) : {};
    } catch {
      // unreadable profile columns: treated as empty
    }
    const eFileUrl = text(cvs.e_file);
    const consultFileUrl = text(cvs.consult_file);
    const caseNo = text(cvs.case_no);
    const normalized = normalizeCaseNo(caseNo);
    const eFileFolder = !eFileUrl && normalized ? ((eFileByCaseNo.get(normalized) as { path: string } | undefined)?.path ?? null) : null;
    const consultFolderPath = consultFileUrl ? (consultByLink.get(linkKey(consultFileUrl)) ?? null) : null;
    const appts = r.clientLocalId
      ? (appointments.all(r.clientLocalId) as { name: string; link: unknown }[]).flatMap((a) => {
          const link = text(a.link);
          return link ? [{ name: a.name, link }] : [];
        })
      : [];
    const feeKTypes = parseLabels(r.feeKTypes);
    const itWillGoTo = text(r.itWillGoTo) ?? feeKTypes.map((t) => options.boardForType?.(t)).find(Boolean) ?? null;
    const contractStage = r.contractStage ?? "";

    const plan = buildHirePlan(
      {
        feeKTypes,
        itWillGoTo,
        contractStage,
        psStage: text(r.psStage),
        hireDate: r.hireDate,
        firstName: text(cvs.first_name),
        lastName: text(cvs.last_name),
        address: r.address,
        phone: r.phone,
        email: r.email,
        caseNo,
        eFileUrl,
        eFileFolderPath: eFileFolder,
        consultFileUrl,
        consultFolderPath,
        appointmentsWithConsultLink: appts,
        prescheduling: options.prescheduling?.(feeKTypes) ?? true,
      },
      free,
      today,
    );
    if (!r.clientLocalId) plan.blockers.unshift("The Fee K isn't connected to a profile");

    return {
      feeKLocalId: r.localId,
      mondayItemId: r.mondayItemId,
      clientName: r.clientName ?? r.name,
      clientLocalId: r.clientLocalId,
      feeKTypes,
      itWillGoTo,
      contractStage,
      psStage: text(r.psStage),
      hireDate: r.hireDate,
      daysWaiting: r.hireDate ? daysBetween(r.hireDate, today) : null,
      eFileUrl,
      consultFileUrl,
      consultFolderPath,
      plan,
    };
  });

  items.sort(
    (a, b) => (b.daysWaiting ?? -1) - (a.daysWaiting ?? -1) || a.clientName.localeCompare(b.clientName),
  );

  return { items, nextCaseNo: free, highestCaseNo: highest };
}
