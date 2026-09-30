// =============================================================================
// SPA Router — History API based routing
// =============================================================================

import type { TabId } from "./components/ClientTabs";

export interface Route {
  page: "landing" | "clients" | "client-detail" | "appointments" | "active-cases" | "my-cases" | "calendar" | "alerts" | "call-log" | "jail-intakes" | "mail" | "court-cases" | "map" | "login" | "admin" | "settings";
  params: Record<string, string>;
}

const VALID_TABS = new Set<string>(["overview", "appointments", "contracts", "active_cases", "court_cases", "documents", "relations"]);
const SETTINGS_TABS = new Set<string>(["account", "preferences", "firm", "admin"]);

/**
 * Match a pathname to a route definition.
 */
export function matchRoute(pathname: string): Route {
  // Normalize: strip trailing slash (except root)
  const path = pathname === "/" ? "/" : pathname.replace(/\/+$/, "");

  if (path === "/login") {
    return { page: "login", params: {} };
  }

  // /settings or /settings/:tab — unknown tabs fall back to the first one.
  // Whether the user may see an admin tab is decided by the page, not here.
  const settings = path.match(/^\/settings(?:\/([^/]+))?$/);
  if (settings) {
    const tab = settings[1] ?? "";
    return { page: "settings", params: { tab: SETTINGS_TABS.has(tab) ? tab : "account" } };
  }

  // Legacy /admin → redirect handled in app.tsx
  if (path === "/admin") {
    return { page: "admin", params: {} };
  }

  if (path === "/") {
    return { page: "landing", params: {} };
  }

  if (path === "/appointments") {
    return { page: "appointments", params: {} };
  }

  if (path === "/active-cases") {
    return { page: "active-cases", params: {} };
  }

  if (path === "/my-cases") {
    return { page: "my-cases", params: {} };
  }

  if (path === "/calendar") {
    return { page: "calendar", params: {} };
  }

  if (path === "/alerts") {
    return { page: "alerts", params: {} };
  }

  if (path === "/jail-intakes") {
    return { page: "jail-intakes", params: {} };
  }

  if (path === "/mail") {
    return { page: "mail", params: {} };
  }

  if (path === "/court-cases") {
    return { page: "court-cases", params: {} };
  }

  if (path === "/map") {
    return { page: "map", params: {} };
  }

  if (path === "/call-log") {
    return { page: "call-log", params: {} };
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
