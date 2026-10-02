// =============================================================================
// Where a client's Drive uploads go in SharePoint
// =============================================================================
// The CONSULT (or CONSULTS — both exist) subfolder of the client's folder, as
// reception files them by hand: the E-File if they have one, else the consult
// folder. The intake job never creates a CLIENT folder — the consult sweep does
// that when the consult is booked and records the link — so a client with no
// link yet is "waiting", and the next run tries again.
// =============================================================================

import { parseSharePointLink } from "../../apps/web/src/sharepoint/parseLink.js";
import { graphFetch, GraphError, type GraphAuth } from "../sharepoint/graph-client.js";
import { getItemByPath, getItemBySharingUrl, listChildren, resolveSiteDrive, type DriveItem } from "../sharepoint/folders.js";
import { CONSULT_SUBFOLDER } from "../sharepoint/sweep.js";

export interface ClientLinks {
  eFile: string | null;
  consultFile: string | null;
  /** The appointment's own "Consult SharePoint" column. */
  apptConsult: string | null;
}

export interface Destination {
  driveId: string;
  /** The CONSULT subfolder, or null when it does not exist yet (dry run). */
  folder: DriveItem | null;
  /** The client folder, for messages. */
  clientFolderUrl: string;
  label: "E-File" | "Consult File";
}

export type DestinationResult = { ok: true; destination: Destination } | { ok: false; reason: string };

/** Most-advanced first, like the sweep: an E-File outranks a consult folder. */
export function pickLink(links: ClientLinks): { url: string; label: Destination["label"] } | null {
  for (const [url, label] of [
    [links.eFile, "E-File"],
    [links.consultFile, "Consult File"],
    [links.apptConsult, "Consult File"],
  ] as const) {
    if (url && parseSharePointLink(url)) return { url, label };
  }
  return null;
}

export async function resolveDestination(
  auth: GraphAuth,
  links: ClientLinks,
  apply: boolean,
): Promise<DestinationResult> {
  const picked = pickLink(links);
  if (!picked) return { ok: false, reason: "no SharePoint folder recorded yet (the consult sweep creates it)" };

  const parsed = parseSharePointLink(picked.url)!;
  let driveId: string;
  let client: DriveItem | null;
  try {
    if (parsed.kind === "sharing") {
      const item = await getItemBySharingUrl(auth, parsed.url);
      driveId = item.parentReference?.driveId ?? "";
      client = item;
    } else {
      const site = parsed.sitePath.replace(/^\/sites\//, "");
      driveId = (await resolveSiteDrive(auth, parsed.host, site)).driveId;
      client = await getItemByPath(auth, driveId, parsed.relPath);
    }
  } catch (err) {
    if (err instanceof GraphError && (err.status === 404 || err.status === 403)) {
      return { ok: false, reason: `${picked.label} link does not open (${err.status}): ${picked.url}` };
    }
    throw err;
  }
  if (!client?.folder || !driveId) return { ok: false, reason: `${picked.label} link is not a folder: ${picked.url}` };

  const children = await listChildren(auth, driveId, client.id);
  let folder = children.find((c) => c.folder && /^consults?$/i.test(c.name.trim())) ?? null;
  if (!folder && apply) folder = await createChildFolder(auth, driveId, client.id, CONSULT_SUBFOLDER);

  return { ok: true, destination: { driveId, folder, clientFolderUrl: client.webUrl, label: picked.label } };
}

/** Create a folder under an item by id; an existing one is reused, never renamed. */
async function createChildFolder(auth: GraphAuth, driveId: string, parentId: string, name: string): Promise<DriveItem> {
  try {
    return await graphFetch<DriveItem>(auth, `/drives/${driveId}/items/${parentId}/children`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, folder: {}, "@microsoft.graph.conflictBehavior": "fail" }),
    });
  } catch (err) {
    if (err instanceof GraphError && err.status === 409) {
      const existing = (await listChildren(auth, driveId, parentId)).find((c) => c.name === name && c.folder);
      if (existing) return existing;
    }
    throw err;
  }
}
