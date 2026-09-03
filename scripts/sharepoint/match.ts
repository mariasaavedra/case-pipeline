// =============================================================================
// Matching a client to an existing SharePoint folder
// =============================================================================
// Before creating anything, find out whether the folder is already there — in
// Consults, or in E-Files/Closed if the client has since hired or closed. A
// folder that exists under a slightly different name and is not matched becomes
// a DUPLICATE, which is the failure this whole stage exists to prevent.
//
// The names in SharePoint are twenty years of human typing:
//
//   ABBURI, Nalini 21-225      case number appended
//   ABDULLAYAR Bek 22016       no comma, case number run together
//   ABDI ESSA, Suad 22-183     multi-word surname AND a case number
//
// So matching is done on a normalised key, and anything that is not an exact
// or normalised hit is reported for a human rather than guessed at.
// =============================================================================

export interface FolderRef {
  /** Folder name as it appears in SharePoint. */
  name: string;
  /** Which site it was found on. */
  site: string;
  /** Path under the library, for reporting. */
  path: string;
  /** Graph's own webUrl — what gets recorded in Monday. */
  webUrl?: string;
}

export type MatchConfidence = "exact" | "normalized";

export interface Match {
  folder: FolderRef;
  confidence: MatchConfidence;
  /** Every folder found for this person, when there was more than one. */
  alsoIn: FolderRef[];
}

/**
 * Lifecycle order. A person legitimately appears in more than one site as their
 * case progresses — Consults when they book, E-Files when they hire, Closed
 * when it finishes — and the folder that matters is the furthest along.
 */
const SITE_RANK: Record<string, number> = { scalconsults: 1, scalefiles: 2, SCALClosed: 3 };

function rank(site: string): number {
  return SITE_RANK[site] ?? SITE_RANK[Object.keys(SITE_RANK).find((k) => k.toLowerCase() === site.toLowerCase()) ?? ""] ?? 0;
}

/**
 * Reduce a folder or client name to a comparable key.
 *
 * Drops the comma (so "ABDULLAYAR Bek" meets "ABDULLAYAR, Bek"), drops trailing
 * case numbers, strips accents and punctuation, and upper-cases. Deliberately
 * NOT fuzzy: two different people must never collide, so nothing here tolerates
 * a spelling difference.
 */
export function normalizeForMatch(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")           // strip accents: MUÑOZ → MUNOZ
    .toUpperCase()
    // Trailing case numbers: "21-225", "22016", "#21-225". Anchored to the end
    // so a digit inside a real name is left alone.
    .replace(/[#\s-]*\b\d{2}[\s-]?\d{3,4}\b\s*$/g, "")
    .replace(/[^A-Z0-9]+/g, " ")               // commas, periods, extra spaces
    .trim()
    .replace(/\s+/g, " ");
}

/** Index folders by normalised key. Collisions keep every candidate. */
export function buildFolderIndex(folders: FolderRef[]): Map<string, FolderRef[]> {
  const index = new Map<string, FolderRef[]>();
  for (const folder of folders) {
    const key = normalizeForMatch(folder.name);
    if (!key) continue;
    const bucket = index.get(key);
    if (bucket) bucket.push(folder);
    else index.set(key, [folder]);
  }
  return index;
}

/**
 * Find the existing folder for a client, if there is one.
 *
 * Several hits usually mean progression, not ambiguity: the same person in
 * Consults and E-Files because they hired. Those resolve to the furthest-along
 * folder. Genuine ambiguity is two DIFFERENT folders in the SAME place — two
 * real people can be "GARCIA, Jose", and picking one would attach a client to
 * a stranger's file, so those are refused for a human to look at.
 */
export function findMatch(
  index: Map<string, FolderRef[]>,
  folderName: string,
): { match: Match | null; ambiguous: FolderRef[] } {
  const key = normalizeForMatch(folderName);
  const candidates = dedupe(index.get(key) ?? []);

  if (candidates.length === 0) return { match: null, ambiguous: [] };

  // Two folders on the same site, under the same parent, are a real collision:
  // either a duplicate someone should merge, or two different people.
  for (const site of new Set(candidates.map((c) => c.site))) {
    const here = candidates.filter((c) => c.site === site);
    const parents = new Set(here.map((c) => parentOf(c.path)));
    if (here.length > 1 && parents.size < here.length) return { match: null, ambiguous: candidates };
  }

  // Otherwise take the furthest along; within a site, the latest path wins
  // (a repeat consult in "2026 Consults" sorts above "2025 Consults").
  const sorted = [...candidates].sort(
    (a, b) => rank(b.site) - rank(a.site) || b.path.localeCompare(a.path),
  );
  const chosen = sorted[0]!;

  return {
    match: {
      folder: chosen,
      confidence: chosen.name === folderName ? "exact" : "normalized",
      alsoIn: sorted.slice(1),
    },
    ambiguous: [],
  };
}

/** Parent path, or "" for a folder at the library root (SCAL Closed is flat). */
function parentOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? "" : path.slice(0, cut);
}

function dedupe(folders: FolderRef[]): FolderRef[] {
  const seen = new Set<string>();
  return folders.filter((f) => {
    const key = `${f.site}::${f.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
