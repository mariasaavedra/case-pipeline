// =============================================================================
// Deleting a folder we should not have created
// =============================================================================
// The only destructive operation in this codebase, and it is deliberately
// narrow. Two independent guards, both of which must pass:
//
//   1. The folder is EMPTY — verified by listing its children, not by trusting
//      the childCount Graph reports on the parent listing, which can be stale.
//   2. The folder was created within the last `maxAgeHours` — so this can only
//      ever remove something the automation just made, never a client folder
//      that has been there for years.
//
// Deletion goes to the SharePoint recycle bin, where it is recoverable for the
// site's retention period. That is a safety net, not a licence: a folder that
// fails either guard is skipped and reported, never forced.
// =============================================================================

import { graphFetch, GraphError, type GraphAuth } from "./graph-client.js";
import { getItemByPath, listChildren } from "./folders.js";

export type DeleteOutcome =
  | { kind: "deleted"; path: string }
  | { kind: "would-delete"; path: string }
  | { kind: "skipped"; path: string; reason: string };

export interface DeleteOptions {
  /** Refuse anything older than this. Defaults to 24h. */
  maxAgeHours?: number;
  apply: boolean;
}

export async function deleteEmptyFolder(
  auth: GraphAuth,
  driveId: string,
  path: string,
  options: DeleteOptions,
): Promise<DeleteOutcome> {
  const maxAgeHours = options.maxAgeHours ?? 24;

  let item;
  try {
    item = await getItemByPath(auth, driveId, path);
  } catch (err) {
    if (err instanceof GraphError && err.status === 404) return { kind: "skipped", path, reason: "not found" };
    throw err;
  }
  if (!item) return { kind: "skipped", path, reason: "not found" };
  if (!item.folder) return { kind: "skipped", path, reason: "not a folder" };

  // Guard 1: actually empty. Listing is authoritative; childCount is not.
  const children = await listChildren(auth, driveId, item.id);
  if (children.length > 0) {
    return { kind: "skipped", path, reason: `NOT EMPTY — ${children.length} item(s) inside` };
  }

  // Guard 2: we made it, and made it recently.
  const created = item.createdDateTime ? Date.parse(item.createdDateTime) : NaN;
  if (!Number.isFinite(created)) {
    return { kind: "skipped", path, reason: "no creation date — refusing" };
  }
  const ageHours = (Date.now() - created) / 3_600_000;
  if (ageHours > maxAgeHours) {
    return { kind: "skipped", path, reason: `created ${Math.round(ageHours)}h ago, older than the ${maxAgeHours}h limit` };
  }

  if (!options.apply) return { kind: "would-delete", path };

  await graphFetch<void>(auth, `/drives/${driveId}/items/${item.id}`, { method: "DELETE" });
  return { kind: "deleted", path };
}
