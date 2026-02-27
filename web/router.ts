// =============================================================================
// SPA Router — History API based routing
// =============================================================================

import type { TabId } from "./components/ClientTabs";

export interface Route {
  page: "landing" | "clients" | "client-detail";
  params: Record<string, string>;
}

const VALID_TABS = new Set<string>(["overview", "documents", "appointments", "relations"]);

/**
 * Match a pathname to a route definition.
 */
export function matchRoute(pathname: string): Route {
  // Normalize: strip trailing slash (except root)
  const path = pathname === "/" ? "/" : pathname.replace(/\/+$/, "");

  if (path === "/") {
    return { page: "landing", params: {} };
  }

  if (path === "/clients") {
    return { page: "clients", params: {} };
  }

  // /clients/:id or /clients/:id/:tab
  const match = path.match(/^\/clients\/([^/]+)(?:\/([^/]+))?$/);
  if (match) {
    const id = decodeURIComponent(match[1]!);
    const tab = match[2] ? decodeURIComponent(match[2]) : "overview";
    return {
      page: "client-detail",
      params: { id, tab: VALID_TABS.has(tab) ? tab : "overview" },
    };
  }

  // Fallback: treat as landing
  return { page: "landing", params: {} };
}

/**
 * Navigate via pushState and dispatch popstate so listeners pick it up.
 */
export function navigate(path: string) {
  if (window.location.pathname === path) return;
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/**
 * URL builder for client detail page.
 */
export function clientPath(localId: string, tab?: TabId): string {
  const encoded = encodeURIComponent(localId);
  if (!tab || tab === "overview") return `/clients/${encoded}`;
  return `/clients/${encoded}/${tab}`;
}

/**
 * URL builder for clients list.
 */
export function clientsPath(): string {
  return "/clients";
}
