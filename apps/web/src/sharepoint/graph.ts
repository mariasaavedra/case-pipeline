// =============================================================================
// Microsoft Graph client — SharePoint folder browsing
// =============================================================================
// Delegated, browser-direct: MSAL hands us a Graph token for the signed-in user
// and we call Graph from here. There is no server proxy and no stored token, so
// a user can only ever see what SharePoint already grants them.
//
// Consent: the Graph scope is separate from login (see msal-config.ts). The
// first call raises GraphConsentRequiredError so the UI can show a "Connect
// SharePoint" button — a popup must be user-initiated or the browser blocks it.
// =============================================================================

import { InteractionRequiredAuthError } from "@azure/msal-browser";
import { msalInstance } from "../auth/AuthProvider";
import { graphRequest } from "../auth/msal-config";
import { parseSharePointLink, type SharePointFolder } from "./parseLink";

const GRAPH = "https://graph.microsoft.com/v1.0";

/** The user hasn't consented to the Graph scope yet — prompt interactively. */
export class GraphConsentRequiredError extends Error {
  constructor() {
    super("SharePoint access has not been granted yet.");
    this.name = "GraphConsentRequiredError";
  }
}

/** A non-OK Graph response (403 = no access to that folder, 404 = dead link…). */
export class GraphError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GraphError";
  }
}

export interface DriveItem {
  id: string;
  name: string;
  webUrl: string;
  size?: number;
  lastModifiedDateTime?: string;
  folder?: { childCount?: number };
  file?: { mimeType?: string };
  parentReference?: { driveId?: string; id?: string };
  /** Short-lived pre-authenticated download URL (files only). */
  "@microsoft.graph.downloadUrl"?: string;
}

export interface ResolvedItem {
  driveId: string;
  itemId: string;
  name: string;
  webUrl: string;
  isFolder: boolean;
}

// ---- Auth -------------------------------------------------------------------

/**
 * Get a Graph access token. Silent by default; pass interactive=true from a
 * click handler to run the consent popup.
 */
export async function getGraphToken(interactive = false): Promise<string> {
  const account = msalInstance.getActiveAccount() ?? msalInstance.getAllAccounts()[0];
  if (!account) throw new Error("Not signed in");

  // Interactive path: open the popup FIRST, with no await before it. Awaiting
  // acquireTokenSilent here would spend the click's user-activation and the
  // browser would block the popup (MSAL popup_window_error). The silent attempt
  // is redundant anyway — we only get here because it already failed.
  if (interactive) {
    try {
      const result = await msalInstance.acquireTokenPopup({ ...graphRequest, account });
      return result.accessToken;
    } catch (err) {
      // Some browsers block popups outright; fall back to a full-page redirect.
      if (isPopupBlocked(err)) {
        await msalInstance.acquireTokenRedirect({ ...graphRequest, account });
        // acquireTokenRedirect navigates away; this never resolves.
        return new Promise<string>(() => {});
      }
      throw err;
    }
  }

  try {
    const result = await msalInstance.acquireTokenSilent({ ...graphRequest, account });
    return result.accessToken;
  } catch (err) {
    if (err instanceof InteractionRequiredAuthError) throw new GraphConsentRequiredError();
    throw err;
  }
}

function isPopupBlocked(err: unknown): boolean {
  const code = (err as { errorCode?: string } | null)?.errorCode;
  return code === "popup_window_error" || code === "empty_window_error";
}

async function graphFetch<T>(pathOrUrl: string, init?: RequestInit): Promise<T> {
  const token = await getGraphToken();
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${GRAPH}${pathOrUrl}`;
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...((init?.headers as Record<string, string>) ?? {}) },
  });
  if (!res.ok) {
    throw new GraphError(res.status, await describeError(res));
  }
  return (await res.json()) as T;
}

async function describeError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    return body.error?.message ?? `Graph ${res.status}`;
  } catch {
    return `Graph ${res.status}`;
  }
}

// ---- Link → driveItem -------------------------------------------------------

/**
 * Encode a sharing URL for /shares/{id}: base64url of the URL, prefixed "u!".
 * TextEncoder keeps non-ASCII characters correct (btoa alone would throw).
 */
export function encodeSharingUrl(url: string): string {
  const bytes = new TextEncoder().encode(url);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  const b64 = btoa(binary).replace(/=+$/, "").replace(/\//g, "_").replace(/\+/g, "-");
  return `u!${b64}`;
}

/** Percent-encode each path segment but keep the separators. */
function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function toResolved(item: DriveItem, knownDriveId?: string): ResolvedItem {
  const driveId = item.parentReference?.driveId ?? knownDriveId;
  if (!driveId) throw new GraphError(500, "Graph returned an item without a driveId");
  return {
    driveId,
    itemId: item.id,
    name: item.name,
    webUrl: item.webUrl,
    isFolder: !!item.folder,
  };
}

/**
 * Address a site by its server-relative path: /sites/{host}:{/sites/name}
 *
 * One colon-addressed segment, and it must be the last thing in the URL.
 */
export function siteRequestPath(host: string, sitePath: string): string {
  return `/sites/${host}:${sitePath}`;
}

/**
 * Address an item by its path within a known drive: /drives/{id}/root:/{path}
 *
 * Separate from siteRequestPath on purpose. Graph cannot chain two path-based
 * addressings in one URL — /sites/{host}:{path}:/drive/root:/{itemPath} returns
 *
 *   400  Resource not found for the segment 'root:'
 *
 * so the site has to be resolved to an id first. This bug was latent while only
 * ?id= web-UI links produced a "path" folder; it became the common case once
 * plain library paths started parsing too.
 */
export function driveItemRequestPath(driveId: string, relPath: string): string {
  return relPath ? `/drives/${driveId}/root:/${encodePath(relPath)}` : `/drives/${driveId}/root`;
}

/** Site path → drive id. Cached: a client's folders often share a site. */
const driveIdCache = new Map<string, string>();

async function driveIdFor(host: string, sitePath: string): Promise<string> {
  const key = `${host}${sitePath}`;
  const cached = driveIdCache.get(key);
  if (cached) return cached;

  const site = await graphFetch<{ id: string }>(siteRequestPath(host, sitePath));
  const drive = await graphFetch<{ id: string }>(`/sites/${site.id}/drive`);
  driveIdCache.set(key, drive.id);
  return drive.id;
}

/** Resolve either link shape into a concrete drive item we can browse. */
export async function resolveFolder(folder: SharePointFolder): Promise<ResolvedItem> {
  if (folder.kind === "sharing") {
    const item = await graphFetch<DriveItem>(`/shares/${encodeSharingUrl(folder.url)}/driveItem`);
    return toResolved(item);
  }
  const driveId = await driveIdFor(folder.host, folder.sitePath);
  const item = await graphFetch<DriveItem>(driveItemRequestPath(driveId, folder.relPath));
  // A drive's own root has no parentReference.driveId, so toResolved would
  // reject it — supply the id we already looked up.
  return toResolved(item, driveId);
}

/**
 * A file (or folder) link → its full driveItem, for M12's preview. Full
 * representation (no $select) so an image keeps its download URL.
 */
export async function resolveFileLink(url: string): Promise<{ driveId: string; item: DriveItem }> {
  const link = parseSharePointLink(url);
  if (!link) throw new GraphError(400, "Not a SharePoint link");
  if (link.kind === "sharing") {
    const item = await graphFetch<DriveItem>(`/shares/${encodeSharingUrl(link.url)}/driveItem`);
    return { driveId: toResolved(item).driveId, item };
  }
  const driveId = await driveIdFor(link.host, link.sitePath);
  const item = await graphFetch<DriveItem>(driveItemRequestPath(driveId, link.relPath));
  return { driveId, item };
}

/**
 * A client folder's own name ("VENTURA, Milton", "MELO, Martin 21-153") for
 * naming its link in a note. A path link carries it as its last segment, so no
 * request is made; a sharing link (most E-File links) is opaque and asks Graph,
 * silently — null when it can't (no consent yet, no access, offline), and the
 * caller keeps its generic label.
 */
export async function folderNameOf(url: string): Promise<string | null> {
  const folder = parseSharePointLink(url);
  if (!folder) return null;
  if (folder.kind === "path") {
    const last = folder.relPath.split("/").filter(Boolean).pop();
    if (last) return last;
  }
  try {
    return (await resolveFolder(folder)).name || null;
  } catch {
    return null;
  }
}

// ---- Browsing ---------------------------------------------------------------

/**
 * List a folder's children, following pagination.
 *
 * Intentionally no $select: `@microsoft.graph.downloadUrl` is only returned on
 * the full item representation, and we need it for the Download action.
 */
export async function listChildren(driveId: string, itemId: string): Promise<DriveItem[]> {
  const items: DriveItem[] = [];
  let next: string | null = `/drives/${driveId}/items/${itemId}/children?$top=200`;
  while (next) {
    const page: { value: DriveItem[]; "@odata.nextLink"?: string } = await graphFetch(next);
    items.push(...(page.value ?? []));
    next = page["@odata.nextLink"] ?? null;
  }
  // Folders first, then files; alphabetical within each.
  return items.sort((a, b) => {
    const af = a.folder ? 0 : 1;
    const bf = b.folder ? 0 : 1;
    return af !== bf ? af - bf : a.name.localeCompare(b.name);
  });
}

// ---- Preview ----------------------------------------------------------------

/**
 * Get a short-lived, embeddable preview URL for a file (Office viewer / PDF /
 * image renderer). Meant for an <iframe src>. Uses the same delegated token, so
 * it only ever previews what the user is already allowed to open.
 *
 * Not every type is previewable; Graph returns 400 for those, which the caller
 * surfaces as "can't preview — download instead".
 */
export async function getPreviewUrl(driveId: string, itemId: string): Promise<string> {
  const res = await graphFetch<{ getUrl?: string; postUrl?: string }>(
    `/drives/${driveId}/items/${itemId}/preview`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
  );
  if (!res.getUrl) throw new GraphError(415, "This file type can't be previewed.");
  return res.getUrl;
}

/**
 * A file's bytes, for copying a SharePoint document into Monday. Graph's
 * pre-authenticated downloadUrl is fetched directly (it allows CORS); the item
 * is re-read for it because a listing's copy expires after about an hour.
 */
export async function downloadDriveFile(driveId: string, itemId: string): Promise<Blob> {
  const item = await graphFetch<DriveItem>(`/drives/${driveId}/items/${itemId}`);
  const url = item["@microsoft.graph.downloadUrl"];
  if (!url) throw new GraphError(404, "SharePoint gave no download link for this file.");
  const res = await fetch(url);
  if (!res.ok) throw new GraphError(res.status, `Download failed (${res.status})`);
  return res.blob();
}

// ---- Upload -----------------------------------------------------------------

/** Graph's cutoff for a simple content PUT. Above this, an upload session is required. */
const SIMPLE_UPLOAD_MAX = 4 * 1024 * 1024;
/** Must be a multiple of 320 KiB per the Graph spec. */
const CHUNK_SIZE = 5 * 320 * 1024; // 1.6 MiB

/**
 * Upload a file into a folder.
 *
 * Never overwrites: conflictBehavior=rename means an existing "I-589.pdf" gets a
 * sibling "I-589 1.pdf" rather than being replaced — losing a client document to
 * a same-name upload is not an acceptable failure mode.
 */
export async function uploadFile(
  driveId: string,
  parentItemId: string,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<DriveItem> {
  const name = encodeURIComponent(file.name);

  if (file.size < SIMPLE_UPLOAD_MAX) {
    const token = await getGraphToken();
    const res = await fetch(
      `${GRAPH}/drives/${driveId}/items/${parentItemId}:/${name}:/content?@microsoft.graph.conflictBehavior=rename`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": file.type || "application/octet-stream",
        },
        body: file,
      },
    );
    if (!res.ok) throw new GraphError(res.status, await describeError(res));
    onProgress?.(1);
    return (await res.json()) as DriveItem;
  }

  // Large file: create a session, then PUT sequential byte ranges.
  const session = await graphFetch<{ uploadUrl: string }>(
    `/drives/${driveId}/items/${parentItemId}:/${name}:/createUploadSession`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "rename" } }),
    },
  );

  let start = 0;
  while (start < file.size) {
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const chunk = file.slice(start, end);
    // The session URL is pre-authenticated — do NOT attach the bearer token.
    const res = await fetch(session.uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Length": String(end - start),
        "Content-Range": `bytes ${start}-${end - 1}/${file.size}`,
      },
      body: chunk,
    });
    if (res.status === 200 || res.status === 201) {
      onProgress?.(1);
      return (await res.json()) as DriveItem;
    }
    if (res.status !== 202) throw new GraphError(res.status, await describeError(res));
    start = end;
    onProgress?.(start / file.size);
  }
  throw new GraphError(500, "Upload finished without a completed item");
}

// ---- Contract templates -----------------------------------------------------

/**
 * The SharePoint folder holding the firm's contract templates (Word files with
 * {{tags}}, maintained by staff — see docs/features/contract-signing.md).
 */
export const CONTRACT_TEMPLATES_FOLDER =
  "https://sharmacrawford.sharepoint.com/sites/SCALDocs/Shared Documents/Fee Contracts/App Templates";

/** The .docx templates in that folder (not Word lock files, not the READ ME). */
export async function listContractTemplates(): Promise<{ driveId: string; items: DriveItem[] }> {
  const folder = parseSharePointLink(CONTRACT_TEMPLATES_FOLDER);
  if (!folder) throw new GraphError(400, "The contract templates folder link isn't a SharePoint folder.");
  const resolved = await resolveFolder(folder);
  const items = (await listChildren(resolved.driveId, resolved.itemId)).filter(
    (i) => !i.folder && /\.docx$/i.test(i.name) && !i.name.startsWith("~$") && !/^read ?me/i.test(i.name),
  );
  return { driveId: resolved.driveId, items };
}

// ---- Word → PDF -------------------------------------------------------------

/** Where conversions are staged in the user's own OneDrive (deleted right after). */
const CONVERT_FOLDER = "Case Pipeline (temporary)";

/**
 * Convert a Word document to PDF with Microsoft 365's own converter, so the
 * PDF looks exactly as Word shows it and the server needs no Office install.
 * The file is uploaded to the signed-in user's OneDrive, converted
 * (`/content?format=pdf`), then deleted — whether or not the conversion worked.
 */
export async function convertDocxToPdf(docx: Blob, fileName: string): Promise<Blob> {
  if (docx.size >= SIMPLE_UPLOAD_MAX) throw new GraphError(413, "This document is too large to convert (4 MB limit).");
  const token = await getGraphToken();
  const auth = { Authorization: `Bearer ${token}` };
  const name = `${Date.now()}-${fileName.replace(/[\\/:*?"<>|#%]+/g, "_")}`;
  const put = await fetch(
    `${GRAPH}/me/drive/root:/${encodeURIComponent(CONVERT_FOLDER)}/${encodeURIComponent(name)}:/content?@microsoft.graph.conflictBehavior=rename`,
    { method: "PUT", headers: { ...auth, "Content-Type": docx.type || "application/octet-stream" }, body: docx },
  );
  if (!put.ok) throw new GraphError(put.status, await describeError(put));
  const item = (await put.json()) as { id: string };
  try {
    const pdf = await fetch(`${GRAPH}/me/drive/items/${item.id}/content?format=pdf`, { headers: auth });
    if (!pdf.ok) throw new GraphError(pdf.status, await describeError(pdf));
    return await pdf.blob();
  } finally {
    await fetch(`${GRAPH}/me/drive/items/${item.id}`, { method: "DELETE", headers: auth }).catch(() => {});
  }
}

// ---- Client folders ---------------------------------------------------------

/** The firm's tenant and the three sites a client folder can live on. */
const TENANT_HOST = "sharmacrawford.sharepoint.com";
const SITE_CONSULTS = "/sites/scalconsults";
const SITE_EFILES = "/sites/scalefiles";
const SITE_CLOSED = "/sites/SCALClosed";

/** An item by path in a drive, or null when nothing is there. */
async function itemAtPath(driveId: string, path: string): Promise<DriveItem | null> {
  try {
    return await graphFetch<DriveItem>(driveItemRequestPath(driveId, path));
  } catch (err) {
    if (err instanceof GraphError && err.status === 404) return null;
    throw err;
  }
}

/**
 * Walk a folder path, creating each missing segment. conflictBehavior=fail plus
 * a re-read on 409 means a folder someone else just made is used, never renamed
 * into a "NAME 1" sibling.
 */
async function ensureFolderPath(driveId: string, path: string): Promise<DriveItem> {
  let parent = "";
  let item: DriveItem | null = null;
  for (const segment of path.split("/").filter(Boolean)) {
    const here = parent ? `${parent}/${segment}` : segment;
    item = await itemAtPath(driveId, here);
    if (!item) {
      const children = parent
        ? `/drives/${driveId}/root:/${encodePath(parent)}:/children`
        : `/drives/${driveId}/root/children`;
      try {
        item = await graphFetch<DriveItem>(children, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: segment, folder: {}, "@microsoft.graph.conflictBehavior": "fail" }),
        });
      } catch (err) {
        if (!(err instanceof GraphError && err.status === 409)) throw err;
        item = await itemAtPath(driveId, here);
        if (!item) throw err;
      }
    }
    parent = here;
  }
  if (!item) throw new GraphError(400, "Empty folder path");
  return item;
}

export type ClientFolderKind = "e_file" | "consult_file";

export interface ClientFolderResult {
  /** Which profile column the link belongs in — an existing e-file wins over a new consult folder. */
  kind: ClientFolderKind;
  url: string;
  created: boolean;
  /** "2026 Consults/E/ESTRADA, Silvia" etc., for the confirmation line. */
  path: string;
}

/**
 * Find the client's folder, or create it — the same lookups, in the same order,
 * as the consult sweep (scripts/sharepoint/sweep.ts), so the two never disagree:
 *
 *   scalefiles    {initial}/{LASTNAME, First}          → existing e-file
 *   SCALClosed    {LASTNAME, First}                    → existing (closed) e-file
 *   scalconsults  {year} Consults/{initial}/{name}      → existing consult folder
 *
 * Only when none exists is one created: under Consults for a consult, under
 * E-Files when the e-file is what was asked for. Creating a consult folder for
 * someone who already has an e-file would put a duplicate in the wrong place.
 */
export async function findOrCreateClientFolder(opts: {
  want: ClientFolderKind;
  folder: string;
  initial: string;
  year: number;
}): Promise<ClientFolderResult> {
  const efiles = await driveIdFor(TENANT_HOST, SITE_EFILES);
  const efilePath = `${opts.initial}/${opts.folder}`;
  const efile = await itemAtPath(efiles, efilePath);
  if (efile?.folder) return { kind: "e_file", url: efile.webUrl, created: false, path: `E-Files/${efilePath}` };

  const closed = await driveIdFor(TENANT_HOST, SITE_CLOSED);
  const closedItem = await itemAtPath(closed, opts.folder);
  if (closedItem?.folder) return { kind: "e_file", url: closedItem.webUrl, created: false, path: `Closed/${opts.folder}` };

  const consults = await driveIdFor(TENANT_HOST, SITE_CONSULTS);
  const consultPath = `${opts.year} Consults/${opts.initial}/${opts.folder}`;
  const consult = await itemAtPath(consults, consultPath);
  if (consult?.folder && opts.want === "consult_file") {
    return { kind: "consult_file", url: consult.webUrl, created: false, path: `Consults/${consultPath}` };
  }

  if (opts.want === "e_file") {
    const made = await ensureFolderPath(efiles, efilePath);
    return { kind: "e_file", url: made.webUrl, created: true, path: `E-Files/${efilePath}` };
  }
  const made = await ensureFolderPath(consults, consultPath);
  return { kind: "consult_file", url: made.webUrl, created: true, path: `Consults/${consultPath}` };
}
