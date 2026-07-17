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
//   2. Web-UI link (~299), where the server-relative path rides in ?id=:
//      https://…/sites/scalconsults/Shared%20Documents/Forms/AllItems.aspx
//        ?id=%2Fsites%2Fscalconsults%2FShared%20Documents%2F2024%20Consults%2FM%2FMENDOZA%2C%20Aaron
//      → decoded: /sites/{site}/{library}/{relPath}
//      → Graph: /sites/{host}:{sitePath}:/drive/root:/{relPath}
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

export function parseSharePointLink(raw: unknown): SharePointFolder | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;

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

  return null;
}
