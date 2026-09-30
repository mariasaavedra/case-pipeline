// =============================================================================
// SPA Router — History API based routing
// =============================================================================

import type { TabId } from "./components/ClientTabs";

export interface Route {
  page: "landing" | "clients" | "client-detail" | "appointments" | "contracts" | "prescheduling" | "active-cases" | "my-cases" | "calendar" | "alerts" | "call-log" | "jail-intakes" | "mail" | "login" | "admin" | "settings";
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

  if (path === "/contracts") {
    return { page: "contracts", params: {} };
  }

  if (path === "/prescheduling") {
    return { page: "prescheduling", params: {} };
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

// -----------------------------------------------------------------------------
// Client peek — M3 opened over the current page via ?client=<localId>
// -----------------------------------------------------------------------------
// A client name outside P2 opens the case in a popup instead of leaving the
// page: people click a name to check a note or a document, then carry on with
// the list they were working through. The peek lives in the URL so Back closes
// it and a copied link reopens it.

const PEEK_PARAM = "client";

interface PeekState {
  clientPeek?: boolean;
  clientPeekName?: string;
}

export interface ClientPeek {
  localId: string;
  name?: string;
}

export function readClientPeek(): ClientPeek | null {
  const localId = new URLSearchParams(window.location.search).get(PEEK_PARAM);
  if (!localId) return null;
  const state = (window.history.state ?? {}) as PeekState;
  return { localId, name: state.clientPeekName };
}

function urlWithPeek(localId: string | null): string {
  const url = new URL(window.location.href);
  if (localId) url.searchParams.set(PEEK_PARAM, localId);
  else url.searchParams.delete(PEEK_PARAM);
  return url.pathname + url.search + url.hash;
}

/**
 * Open a client's case over the current page. One history entry per peek, so
 * Back closes it; peeking at another client from inside one replaces it rather
 * than stacking.
 */
export function openClientPeek(localId: string, name?: string) {
  const state: PeekState = { clientPeek: true, clientPeekName: name };
  if (readClientPeek()) window.history.replaceState(state, "", urlWithPeek(localId));
  else window.history.pushState(state, "", urlWithPeek(localId));
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/**
 * Close the peek. When we pushed its history entry, go back over it so Forward
 * doesn't reopen it; when the page was loaded with ?client= (a shared link),
 * there's nothing to go back to, so just drop the param.
 */
export function closeClientPeek() {
  if (!readClientPeek()) return;
  if ((window.history.state as PeekState | null)?.clientPeek) {
    window.history.back();
    return;
  }
  window.history.replaceState(null, "", urlWithPeek(null));
  window.dispatchEvent(new PopStateEvent("popstate"));
}
