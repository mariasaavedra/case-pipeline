// =============================================================================
// SharePoint folder creation — idempotent primitives
// =============================================================================
// Everything here is safe to re-run. A folder that already exists is REUSED,
// never replaced: creation uses conflictBehavior=fail and treats the resulting
// 409 as "already there, fetch it". The alternative (rename) would quietly
// scatter "Correspondence 1", "Correspondence 2" through client e-files on a
// second run, which is worse than an error.
//
// Nothing here deletes or moves anything. There is deliberately no such helper.
// =============================================================================

import { graphFetch, GraphError, type GraphAuth } from "./graph-client.js";

export interface DriveItem {
  id: string;
  name: string;
  webUrl: string;
  folder?: { childCount?: number };
  file?: { mimeType?: string };
  size?: number;
  /** Used by delete-empty.ts to refuse anything the automation did not just make. */
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  /** Who touched it last — used to avoid overwriting a person's edits. */
  lastModifiedBy?: { user?: { displayName?: string; email?: string } };
}

export interface SiteDrive {
  siteId: string;
  driveId: string;
  siteName: string;
  webUrl: string;
}

/** What ensureFolder actually did — the caller reports it, and dry runs need it. */
export type FolderOutcome = "created" | "existed" | "would-create";

export interface EnsureResult {
  outcome: FolderOutcome;
  path: string;
  /** Absent on a would-create: there is no item to point at yet. */
  item?: DriveItem;
}

// ---- Name validation --------------------------------------------------------

// SharePoint/OneDrive rejects these outright. Worth catching before the call so
// a bad client name fails with a clear message instead of a Graph 400.
const ILLEGAL_CHARS = /["*:<>?/\\|]/;
const RESERVED = new Set([".", "..", "_vti_", "desktop.ini"]);

export function validateFolderName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "empty name";
  if (ILLEGAL_CHARS.test(trimmed)) return `illegal character in "${trimmed}" (one of " * : < > ? / \\ |)`;
  if (trimmed.endsWith(".")) return `"${trimmed}" ends with a period`;
  if (RESERVED.has(trimmed.toLowerCase())) return `"${trimmed}" is a reserved name`;
  if (trimmed.startsWith("~$")) return `"${trimmed}" starts with ~$`;
  if (trimmed.length > 255) return `"${trimmed.slice(0, 40)}…" is longer than 255 characters`;
  return null;
}

/** Percent-encode each segment but keep the separators (mirrors graph.ts). */
function encodePath(path: string): string {
  return path.split("/").filter(Boolean).map(encodeURIComponent).join("/");
}

// ---- Site / drive resolution ------------------------------------------------

/**
 * Resolve a site by its host + name (e.g. "scalefiles") to its default
 * document library. One round trip each, cached per process because a bulk run
 * hits the same handful of sites thousands of times.
 */
const siteCache = new Map<string, SiteDrive>();

export async function resolveSiteDrive(
  auth: GraphAuth,
  host: string,
  siteName: string,
): Promise<SiteDrive> {
  const key = `${host}/${siteName}`;
  const hit = siteCache.get(key);
  if (hit) return hit;

  const site = await graphFetch<{ id: string; name?: string; displayName?: string; webUrl: string }>(
    auth,
    `/sites/${host}:/sites/${encodeURIComponent(siteName)}`,
  );
  const drive = await graphFetch<{ id: string }>(auth, `/sites/${site.id}/drive`);

  const resolved: SiteDrive = {
    siteId: site.id,
    driveId: drive.id,
    siteName: site.displayName ?? site.name ?? siteName,
    webUrl: site.webUrl,
  };
  siteCache.set(key, resolved);
  return resolved;
}

// ---- Lookup -----------------------------------------------------------------

/** Fetch an item by its path under the library root, or null if absent. */
export async function getItemByPath(
  auth: GraphAuth,
  driveId: string,
  path: string,
): Promise<DriveItem | null> {
  const suffix = path ? `:/${encodePath(path)}` : "";
  try {
    return await graphFetch<DriveItem>(auth, `/drives/${driveId}/root${suffix}`);
  } catch (err) {
    if (err instanceof GraphError && err.status === 404) return null;
    throw err;
  }
}

// ---- Creation ---------------------------------------------------------------

/**
 * Ensure ONE folder exists directly under `parentPath` ("" = library root).
 *
 * `apply=false` (the default everywhere) resolves and reports without writing,
 * so a run can be inspected before it touches a live client e-file.
 */
export async function ensureFolder(
  auth: GraphAuth,
  driveId: string,
  parentPath: string,
  name: string,
  apply: boolean,
): Promise<EnsureResult> {
  const problem = validateFolderName(name);
  if (problem) throw new Error(`Cannot create folder: ${problem}`);

  const trimmed = name.trim();
  const fullPath = parentPath ? `${parentPath}/${trimmed}` : trimmed;

  const existing = await getItemByPath(auth, driveId, fullPath);
  if (existing) {
    if (!existing.folder) {
      throw new Error(`"${fullPath}" already exists but is a FILE, not a folder — refusing to touch it.`);
    }
    return { outcome: "existed", path: fullPath, item: existing };
  }

  if (!apply) return { outcome: "would-create", path: fullPath };

  const parentRef = parentPath ? `root:/${encodePath(parentPath)}:` : "root";
  try {
    const created = await graphFetch<DriveItem>(auth, `/drives/${driveId}/${parentRef}/children`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: trimmed,
        folder: {},
        "@microsoft.graph.conflictBehavior": "fail",
      }),
    });
    return { outcome: "created", path: fullPath, item: created };
  } catch (err) {
    // Lost a race with another run (or a person in the SharePoint UI) between
    // the existence check and the POST. That is the good outcome, not an error.
    if (err instanceof GraphError && err.status === 409) {
      const found = await getItemByPath(auth, driveId, fullPath);
      if (found) return { outcome: "existed", path: fullPath, item: found };
    }
    throw err;
  }
}

/**
 * Ensure every segment of a nested path exists, creating from the top down.
 * "2026 Consults/M/MENDOZA, Aaron" → three ensureFolder calls.
 *
 * Returns one result per segment so a caller can report exactly what was new.
 */
export async function ensureFolderPath(
  auth: GraphAuth,
  driveId: string,
  path: string,
  apply: boolean,
): Promise<EnsureResult[]> {
  const segments = path.split("/").map((s) => s.trim()).filter(Boolean);
  const results: EnsureResult[] = [];
  let parent = "";

  for (let i = 0; i < segments.length; i++) {
    const result = await ensureFolder(auth, driveId, parent, segments[i]!, apply);
    results.push(result);
    parent = result.path;

    // In a dry run the parent doesn't exist, so no child of it can be checked.
    // Report the rest as would-create rather than 404-ing our way down.
    // (Index-based, not indexOf — a path can legitimately repeat a segment
    // name, e.g. "Motions/2026/Motions".)
    if (result.outcome === "would-create") {
      for (const rest of segments.slice(i + 1)) {
        parent = `${parent}/${rest}`;
        results.push({ outcome: "would-create", path: parent });
      }
      break;
    }
  }

  return results;
}

/**
 * List a folder's children, following pagination. Read-only.
 *
 * No $select: the match stage wants names and folder-ness, and Graph only
 * returns the full item representation without one.
 */
export async function listChildren(
  auth: GraphAuth,
  driveId: string,
  itemId: string,
): Promise<DriveItem[]> {
  const items: DriveItem[] = [];
  let next: string | null = `/drives/${driveId}/items/${itemId}/children?$top=999`;
  while (next) {
    const page: { value: DriveItem[]; "@odata.nextLink"?: string } = await graphFetch(auth, next);
    items.push(...(page.value ?? []));
    next = page["@odata.nextLink"] ?? null;
  }
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Search a drive for folders matching a term. Used to check a flat library —
 * SCAL Closed holds 5,200+ folders at its root, so listing it on every sweep
 * would be wasteful where one search answers the question.
 *
 * Search is best-effort by nature (indexing lags, matching is fuzzy), so it is
 * only ever used to WIDEN a check, never as the sole evidence a folder exists.
 */
export async function searchFolders(
  auth: GraphAuth,
  driveId: string,
  term: string,
): Promise<DriveItem[]> {
  const q = encodeURIComponent(term.replace(/'/g, "''"));
  const page = await graphFetch<{ value: DriveItem[] }>(
    auth,
    `/drives/${driveId}/root/search(q='${q}')?$top=200`,
  );
  return (page.value ?? []).filter((item) => item.folder);
}

/** Graph's cutoff for a simple content PUT. Generated documents are far below it. */
const SIMPLE_UPLOAD_MAX = 4 * 1024 * 1024;

/**
 * Upload a small generated file into a folder.
 *
 * `conflictBehavior` is the caller's decision and deliberately has no default:
 * "fail" for something that must not overwrite, "replace" only where the caller
 * has established the existing file is one it wrote itself.
 */
export async function uploadSmallFile(
  auth: GraphAuth,
  driveId: string,
  parentItemId: string,
  name: string,
  content: Buffer,
  conflictBehavior: "fail" | "replace" | "rename",
): Promise<DriveItem> {
  if (content.length >= SIMPLE_UPLOAD_MAX) {
    throw new Error(`${name} is ${content.length} bytes — too large for a simple upload`);
  }
  const token = await auth.getToken();
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${parentItemId}:/${encodeURIComponent(name)}:/content` +
      `?@microsoft.graph.conflictBehavior=${conflictBehavior}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      },
      body: new Uint8Array(content),
    },
  );
  if (!res.ok) {
    let message = `Graph ${res.status}`;
    try {
      message = ((await res.json()) as { error?: { message?: string } }).error?.message ?? message;
    } catch { /* body was not JSON */ }
    throw new GraphError(res.status, message);
  }
  return (await res.json()) as DriveItem;
}

/**
 * Whether a file still looks untouched by a person since the automation wrote
 * it. Regenerating a document is fine; overwriting something an attorney edited
 * in SharePoint is not, and there is no undo for that.
 *
 * Errs towards NOT overwriting: an unknown or unreadable editor counts as a
 * person.
 */
export function isUnmodifiedBy(item: DriveItem, account: string | null): boolean {
  if (!account) return false;
  const by = item.lastModifiedBy?.user;
  const who = (by?.email ?? by?.displayName ?? "").trim().toLowerCase();
  if (!who) return false;
  return who === account.trim().toLowerCase();
}
