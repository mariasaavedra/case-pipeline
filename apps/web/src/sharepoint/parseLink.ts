// =============================================================================
// SharePoint link parser
// =============================================================================
// The e_file / consult columns on Monday hold SharePoint links to client folders
// in two shapes, both of which we must resolve through Microsoft Graph:
//
//   1. Sharing link (~93%):
//      https://sharmacrawford.sharepoint.com/:f:/s/scalefiles/Et3pGa…?e=INBnkV
//      → Graph: /shares/u!{base64url(url)}/driveItem
//
//   2. Web-UI link, where the server-relative path rides in ?id=:
//      https://…/sites/scalconsults/Shared%20Documents/Forms/AllItems.aspx
//        ?id=%2Fsites%2Fscalconsults%2FShared%20Documents%2F2024%20Consults%2FM%2FMENDOZA%2C%20Aaron
//      → decoded: /sites/{site}/{library}/{relPath}
//      → Graph: /sites/{host}:{sitePath}:/drive/root:/{relPath}
//
//   3. Plain library path — what the old Zapier consult automation wrote, and
//      the single most common shape in the Consult File column:
//        sharmacrawford.sharepoint.com/sites/scalconsults/Shared Documents/
//          2026 Consults/V/VENTURA, Milton
//      Same Graph call as (2). Note it is usually stored WITHOUT a scheme, so
//      normalizeSharePointUrl runs first — untouched, such a value is not a URL
//      at all and window.open would treat it as a relative path.
//
// Anything unrecognised returns null so the UI can degrade to a plain
// "Open in SharePoint ↗" link instead of pretending it can browse it.
// =============================================================================

export type SharePointFolder =
  | {
      kind: "sharing";
      /** The original sharing URL — encoded into the Graph /shares call. */
      url: string;
      site: string | null;
    }
  | {
      kind: "path";
      /** Tenant host, e.g. sharmacrawford.sharepoint.com (never the -my variant). */
      host: string;
      /** e.g. /sites/scalconsults */
      sitePath: string;
      /** Path under the document library ("" = library root). */
      relPath: string;
      site: string | null;
    };

/**
 * Bring a stored link up to a usable absolute URL, or null if it isn't one.
 *
 * The Consult File column is hand-and-automation-filled text, and most of it
 * (505 of 611 rows at the time of writing) is scheme-less
 * "sharmacrawford.sharepoint.com/sites/…". Prefixing https:// is the whole fix,
 * but it has to happen before anything treats the value as a URL.
 */
export function normalizeSharePointUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let trimmed = raw.trim();
  if (!trimmed) return null;

  // Some values hold the link twice ("<url> - <url>"), or a link followed by a
  // note. A second scheme anywhere but the start means the URL ended before it;
  // keeping the whole string gives Graph a nonsense path and a bare
  // "Invalid request" that tells the user nothing.
  const second = trimmed.slice(1).search(/https?:\/\//i);
  if (second !== -1) trimmed = trimmed.slice(0, second + 1);
  trimmed = trimmed.replace(/[\s\-–—|,;]+$/, "");
  if (!trimmed) return null;

  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  // Only add a scheme to something that actually looks like a SharePoint host,
  // so unrelated free text in the column stays unparseable rather than becoming
  // a plausible-looking link to nowhere.
  if (/^[a-z0-9-]+(-my)?\.sharepoint\.com\//i.test(trimmed)) return `https://${trimmed}`;
  return null;
}

export function parseSharePointLink(raw: unknown): SharePointFolder | null {
  const trimmed = normalizeSharePointUrl(raw);
  if (!trimmed) return null;

  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return null;
  }
  if (!/\.sharepoint\.com$/i.test(u.hostname)) return null;

  // 1) Sharing link: /:f:/s/{site}/{token}  (:f: folder, :b: file, :w:/:x: office)
  const share = u.pathname.match(/^\/:[a-z]:\/[a-z]\/([^/]+)\/[^/]+/i);
  if (share) {
    return { kind: "sharing", url: trimmed, site: decodeURIComponent(share[1]!) };
  }

  // 2) Web-UI link — the folder lives in the ?id= server-relative path.
  //    URLSearchParams already percent-decodes for us.
  const id = u.searchParams.get("id");
  if (id) {
    const path = id.startsWith("/") ? id : `/${id}`;
    // /sites/{site}/{library}[/{relPath}]
    const m = path.match(/^\/sites\/([^/]+)\/([^/]+)(?:\/(.*))?$/);
    if (m) {
      const site = m[1]!;
      const relPath = (m[3] ?? "").replace(/\/+$/, "");
      // A -my.sharepoint.com URL whose id points at /sites/... actually lives on
      // the tenant host, not the personal one.
      const host = u.hostname.replace(/-my(?=\.sharepoint\.com$)/i, "");
      return { kind: "path", host, sitePath: `/sites/${site}`, relPath, site };
    }
  }

  // 3) Plain library path, no ?id= — the shape the consult automation wrote.
  //    Skipped for the SharePoint UI's own pages (…/Forms/AllItems.aspx and
  //    friends): without an ?id= those are views or saved searches, not a
  //    folder we can resolve, and shape (2) has already had its chance at them.
  const path = decodeURIComponent(u.pathname);
  if (!/\.aspx$/i.test(path)) {
    const m = path.match(/^\/sites\/([^/]+)\/([^/]+)(?:\/(.*))?$/);
    if (m) {
      const site = m[1]!;
      const relPath = (m[3] ?? "").replace(/\/+$/, "");
      const host = u.hostname.replace(/-my(?=\.sharepoint\.com$)/i, "");
      return { kind: "path", host, sitePath: `/sites/${site}`, relPath, site };
    }
  }

  return null;
}
