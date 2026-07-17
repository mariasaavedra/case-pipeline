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
import type { SharePointFolder } from "./parseLink";

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

function toResolved(item: DriveItem): ResolvedItem {
  const driveId = item.parentReference?.driveId;
  if (!driveId) throw new GraphError(500, "Graph returned an item without a driveId");
  return {
    driveId,
    itemId: item.id,
    name: item.name,
    webUrl: item.webUrl,
    isFolder: !!item.folder,
  };
}

/** Resolve either link shape into a concrete drive item we can browse. */
export async function resolveFolder(folder: SharePointFolder): Promise<ResolvedItem> {
  if (folder.kind === "sharing") {
    const item = await graphFetch<DriveItem>(`/shares/${encodeSharingUrl(folder.url)}/driveItem`);
    return toResolved(item);
  }
  // Path form: /sites/{host}:{sitePath}:/drive/root[:/{relPath}]
  const base = `/sites/${folder.host}:${folder.sitePath}:/drive/root`;
  const suffix = folder.relPath ? `:/${encodePath(folder.relPath)}` : "";
  const item = await graphFetch<DriveItem>(`${base}${suffix}`);
  return toResolved(item);
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
