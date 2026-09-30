// =============================================================================
// Scanning client folders out of a site
// =============================================================================
// Shared by consult-folders.ts (does this consult already have a folder?) and
// sharepoint-links.ts (which profiles are missing a folder link?).
// =============================================================================

import { GraphError, type GraphAuth } from "./graph-client.js";
import { resolveSiteDrive, listChildren, getItemByPath } from "./folders.js";
import type { FolderRef } from "./match.js";

export const HOST = "sharmacrawford.sharepoint.com";
/** Where a client folder can legitimately be, in lifecycle order. */
export const CONSULTS_SITE = "scalconsults";
export const EFILES_SITE = "scalefiles";
export const CLOSED_SITE = "SCALClosed";
export const CLIENT_SITES = [CONSULTS_SITE, EFILES_SITE, CLOSED_SITE];

const INITIALS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

/**
 * Collect every client folder from one site into a flat list of refs.
 *
 * Layout differs per site and is handled explicitly rather than by recursion:
 * Consults nests under {YYYY} Consults/{initial}, E-Files under {initial}, and
 * Closed is flat. A generic crawl would be slower and would wander into the
 * project folders ("EL TORO LOCO", "AIC FOIA LITIGATION") that are not clients.
 */
export async function scanSite(
  auth: GraphAuth,
  site: string,
  years: number[] = [],
): Promise<FolderRef[]> {
  const drive = await resolveSiteDrive(auth, HOST, site);
  const found: FolderRef[] = [];

  const ref = (child: { id: string; name: string; webUrl: string; lastModifiedDateTime?: string }, path: string): FolderRef => ({
    name: child.name,
    site,
    path,
    webUrl: child.webUrl,
    id: child.id,
    driveId: drive.driveId,
    modified: child.lastModifiedDateTime,
  });

  const collect = async (parentPath: string) => {
    const parent = await getItemByPath(auth, drive.driveId, parentPath);
    if (!parent?.folder) return;
    for (const child of await listChildren(auth, drive.driveId, parent.id)) {
      if (child.folder) found.push(ref(child, `${parentPath}/${child.name}`));
    }
  };

  if (site === CLOSED_SITE) {
    const root = await getItemByPath(auth, drive.driveId, "");
    if (root) {
      for (const child of await listChildren(auth, drive.driveId, root.id)) {
        if (child.folder) found.push(ref(child, child.name));
      }
    }
    return found;
  }

  // Every year folder that EXISTS, not the ones the plan happens to mention.
  // The site has 24 of them going back to 2003; indexing only the planned years
  // (2024-2026) made repeat consults look new and created 5 duplicate folders
  // on 2026-09-03. `years` is kept only to bound the work when a caller asks.
  let parents: string[];
  if (site === CONSULTS_SITE) {
    const root = await getItemByPath(auth, drive.driveId, "");
    const yearDirs = root
      ? (await listChildren(auth, drive.driveId, root.id))
          .filter((c) => c.folder && /consults$/i.test(c.name))
          .map((c) => c.name)
      : years.map((y) => `${y} Consults`);
    parents = yearDirs.flatMap((y) => INITIALS.map((i) => `${y}/${i}`));
  } else {
    parents = INITIALS.map((i) => i);
  }

  for (const parentPath of parents) {
    try {
      await collect(parentPath);
    } catch (err) {
      // A missing initial folder is normal (no 2024 consults starting with Q).
      if (err instanceof GraphError && err.status === 404) continue;
      throw err;
    }
  }
  return found;
}
