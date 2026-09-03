// =============================================================================
// Collect a client's SharePoint folders
// =============================================================================
// A client's folder links are scattered: the profile carries its own e_file
// (~44% of profiles) AND its own consult_file (~20%), and every board item
// mirrors e_file / consult — often the same folder repeated, sometimes extra
// ones on other sites (scalconsults, SCALClosed…). We gather them all,
// de-duplicate, and label.
//
// A client can legitimately show BOTH: when a consult hires the firm, their
// folder is moved from SCAL Consults to SCAL E-Files by hand, and the stale
// Consult File value is usually left behind on the profile. Showing both is
// correct — the e-file is the live one, and the consult link is history.
//
// Pure function — no Graph, no network. Tested in collectFolders.test.ts.
// =============================================================================

import { parseSharePointLink, normalizeSharePointUrl, type SharePointFolder } from "./parseLink";

export interface ClientFolder {
  /** Human label, e.g. "e-file", "Consult", "Archived". */
  label: string;
  site: string | null;
  /** The original link — used for the "Open in SharePoint ↗" fallback. */
  url: string;
  /** null when the link isn't browsable (e.g. a saved search) → external link only. */
  parsed: SharePointFolder | null;
}

/** Site → label. Keyed lowercase; sites are matched case-insensitively. */
const SITE_LABELS: Record<string, string> = {
  scalefiles: "e-file",
  scalconsults: "Consult",
  scalclosed: "Archived",
  clinicefiles: "Clinic e-file",
  backups: "Backups",
};

/** Fallback label from the Monday column the link came from. */
const COLUMN_LABELS: Record<string, string> = {
  e_file: "e-file",
  consult: "Consult",
};

function labelFor(site: string | null, column: string): string {
  const bySite = site ? SITE_LABELS[site.toLowerCase()] : undefined;
  return bySite ?? COLUMN_LABELS[column] ?? "Files";
}

interface ItemLike {
  columnValues?: Record<string, unknown>;
}

/** Structural input — a ClientCaseSummary satisfies this. */
export interface FolderSource {
  profile?: { eFile?: string | null; consultFile?: string | null } | null;
  boardItems?: Record<string, ItemLike[]> | null;
  /**
   * Appointments are a SEPARATE field on ClientCaseSummary, not part of
   * boardItems — and they are where the consult folder actually lands for a
   * Calendly consult (the "Consult SharePoint" text column). Leaving them out
   * hid the only link 170 clients had.
   */
  appointments?: ItemLike[] | null;
}

/** Column keys on a board item that can hold a SharePoint folder link. */
const ITEM_LINK_COLUMNS: Array<[key: string, label: string]> = [
  ["e_file", "e_file"],
  ["consult", "consult"],
  ["consult_sharepoint", "consult"],
];

export function collectClientFolders(data: FolderSource): ClientFolder[] {
  const out: ClientFolder[] = [];
  const seen = new Set<string>();

  const add = (raw: unknown, column: string) => {
    // Normalise first: most Consult File values are stored scheme-less, and an
    // "Open in SharePoint" link without a scheme is a relative path, not a link.
    const url = normalizeSharePointUrl(raw);
    if (!url || seen.has(url)) return;
    seen.add(url);
    const parsed = parseSharePointLink(url);
    // Not a SharePoint URL at all → not ours to show.
    if (!parsed && !/\.sharepoint\.com/i.test(url)) return;
    out.push({ label: labelFor(parsed?.site ?? siteFromUrl(url), column), site: parsed?.site ?? siteFromUrl(url), url, parsed });
  };

  // Profile first — it's the most authoritative link for the client.
  add(data.profile?.eFile, "e_file");
  add(data.profile?.consultFile, "consult");

  // Then anything mirrored onto the client's board items and appointments.
  const itemGroups = [...Object.values(data.boardItems ?? {}), data.appointments ?? []];
  for (const items of itemGroups) {
    for (const item of items ?? []) {
      for (const [key, column] of ITEM_LINK_COLUMNS) {
        add(item.columnValues?.[key], column);
      }
    }
  }

  return disambiguate(out);
}

/**
 * A client can legitimately have two different folders that land on the same
 * label and site (e.g. two "e-file" links on scalefiles). Rendering two
 * identical rows leaves the user guessing, and we only learn the real folder
 * name once it's resolved on click — so number the repeats up front.
 */
function disambiguate(folders: ClientFolder[]): ClientFolder[] {
  const counts = new Map<string, number>();
  for (const f of folders) counts.set(f.label, (counts.get(f.label) ?? 0) + 1);

  const seen = new Map<string, number>();
  return folders.map((f) => {
    if ((counts.get(f.label) ?? 0) <= 1) return f;
    const n = (seen.get(f.label) ?? 0) + 1;
    seen.set(f.label, n);
    return { ...f, label: `${f.label} (${n})` };
  });
}

/** Best-effort site name for links the parser rejected (used only for labelling). */
function siteFromUrl(url: string): string | null {
  const m = url.match(/sharepoint\.com\/(?::[a-z]:\/[a-z]|sites)\/([^/?&]+)/i);
  return m ? decodeURIComponent(m[1]!) : null;
}
