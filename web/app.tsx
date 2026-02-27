import { useState, useEffect, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { SearchBar } from "./components/SearchBar";
import { SearchResults } from "./components/SearchResults";
import { ClientView } from "./components/ClientView";
import { Sidebar } from "./components/Sidebar";
import { LandingPage } from "./components/LandingPage";
import type { TabId } from "./components/ClientTabs";
import { matchRoute, navigate } from "./router";
import { getClient, listClients } from "./api";
import type { ClientCaseSummary, SearchResult } from "./api";

type View = "search" | "browse";

function App() {
  const [view, setView] = useState<View>("search");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [allProfiles, setAllProfiles] = useState<SearchResult[]>([]);
  const [client, setClient] = useState<ClientCaseSummary | null>(null);
  const [initialTab, setInitialTab] = useState<TabId>("overview");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem("sidebar-collapsed") === "true";
    } catch {
      return false;
    }
  });
  const currentClientId = useRef<string | null>(null);

  const loadFromRoute = useCallback(async () => {
    const route = matchRoute(window.location.pathname);

    if (route.page === "client-detail") {
      const localId = route.params.id!;
      const tab = (route.params.tab as TabId) ?? "overview";

      // Same client, just switching tabs
      if (currentClientId.current === localId && client) {
        setInitialTab(tab);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const data = await getClient(localId);
        setClient(data);
        setInitialTab(tab);
        currentClientId.current = localId;
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    } else {
      setClient(null);
      currentClientId.current = null;
    }
  }, [client]);

  useEffect(() => {
    loadFromRoute();
    window.addEventListener("popstate", loadFromRoute);
    return () => window.removeEventListener("popstate", loadFromRoute);
  }, [loadFromRoute]);

  // Track sidebar collapsed state for layout margin
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "sidebar-collapsed") {
        setSidebarCollapsed(e.newValue === "true");
      }
    };
    // Also listen to our own sidebar changes via a MutationObserver on the sidebar width
    const interval = setInterval(() => {
      try {
        const val = localStorage.getItem("sidebar-collapsed") === "true";
        if (val !== sidebarCollapsed) setSidebarCollapsed(val);
      } catch {}
    }, 200);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
      clearInterval(interval);
    };
  }, [sidebarCollapsed]);

  const handleSelect = (localId: string) => {
    navigate(`/clients/${encodeURIComponent(localId)}`);
  };

  const handleBack = () => {
    navigate("/clients");
  };

  const handleBrowse = async () => {
    if (view === "browse") {
      setView("search");
      return;
    }
    setView("browse");
    if (allProfiles.length === 0) {
      setLoading(true);
      try {
        const profiles = await listClients();
        setAllProfiles(profiles);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    }
  };

  const route = matchRoute(window.location.pathname);
  const showingList = !client && !loading;
  const isClientPage = route.page === "clients" || route.page === "client-detail";
  const sidebarWidth = sidebarCollapsed ? 60 : 220;

  return (
    <div className="app-layout">
      <Sidebar mobileOpen={mobileMenuOpen} onMobileClose={() => setMobileMenuOpen(false)} />

      <div className="app-content" style={{ marginLeft: sidebarWidth }}>
        {/* Header */}
        <header
          className="sticky top-0 z-50"
          style={{
            backgroundColor: "var(--color-navy)",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <div className="max-w-6xl mx-auto px-6 py-3 flex items-center gap-5">
            {/* Mobile hamburger */}
            <button
              className="mobile-menu-btn items-center justify-center p-1"
              onClick={() => setMobileMenuOpen(true)}
              style={{ color: "rgba(255,255,255,0.6)", background: "none", border: "none", cursor: "pointer" }}
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M3 5h14M3 10h14M3 15h14" />
              </svg>
            </button>

            {client ? (
              <button
                onClick={handleBack}
                className="flex items-center gap-2 text-sm transition-colors"
                style={{ color: "rgba(255,255,255,0.5)", fontFamily: "var(--font-body)" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.9)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.5)")}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M10 3L5 8l5 5" />
                </svg>
                Back
              </button>
            ) : null}

            {!client && isClientPage && view === "search" && (
              <div className="flex-1 ml-4">
                <SearchBar onResults={setResults} />
              </div>
            )}

            {!client && isClientPage && (
              <button
                onClick={handleBrowse}
                className="px-4 py-1.5 text-sm rounded-lg whitespace-nowrap transition-all"
                style={{
                  fontFamily: "var(--font-body)",
                  fontWeight: 500,
                  border: view === "browse"
                    ? "1px solid var(--color-amber)"
                    : "1px solid rgba(255,255,255,0.15)",
                  color: view === "browse" ? "var(--color-amber)" : "rgba(255,255,255,0.6)",
                  backgroundColor: view === "browse" ? "rgba(180,83,9,0.1)" : "transparent",
                }}
              >
                {view === "browse" ? "Back to Search" : "Browse All"}
              </button>
            )}
          </div>
        </header>

        {/* Main content */}
        <main className={client ? "" : "max-w-6xl mx-auto px-6 py-6"}>
          {error && (
            <div
              className="animate-in px-4 py-3 rounded-lg mb-5 text-sm"
              style={{
                backgroundColor: "var(--color-status-red-bg)",
                color: "var(--color-status-red)",
                border: "1px solid rgba(153,27,27,0.15)",
                fontFamily: "var(--font-body)",
                maxWidth: "72rem",
                marginLeft: "auto",
                marginRight: "auto",
                ...(client ? { paddingLeft: "1.5rem", paddingRight: "1.5rem" } : {}),
              }}
            >
              {error}
            </div>
          )}

          {loading && (
            <div className="py-20 flex flex-col items-center gap-3 animate-in">
              <div className="flex gap-1">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: "var(--color-amber)", animation: "pulse-subtle 1s ease-in-out infinite" }}
                />
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: "var(--color-amber)", animation: "pulse-subtle 1s ease-in-out 0.2s infinite" }}
                />
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: "var(--color-amber)", animation: "pulse-subtle 1s ease-in-out 0.4s infinite" }}
                />
              </div>
              <span className="text-sm" style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}>
                Loading…
              </span>
            </div>
          )}

          {/* Landing page — KPI dashboard */}
          {route.page === "landing" && !loading && <LandingPage />}

          {/* Client list page */}
          {isClientPage && showingList && view === "search" && results.length === 0 && (
            <div className="py-24 flex flex-col items-center gap-4 animate-in">
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center"
                style={{ backgroundColor: "var(--color-amber-light)" }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-amber)" strokeWidth="1.5">
                  <circle cx="11" cy="11" r="8" />
                  <path d="M21 21l-4.35-4.35" />
                </svg>
              </div>
              <div className="text-center">
                <p
                  className="text-lg mb-1"
                  style={{ fontFamily: "var(--font-display)", color: "var(--color-ink)" }}
                >
                  Search for a client
                </p>
                <p className="text-sm" style={{ color: "var(--color-ink-faint)" }}>
                  Type a name, email, or phone number to view their 360 case summary.
                </p>
              </div>
            </div>
          )}

          {isClientPage && showingList && view === "search" && (
            <SearchResults results={results} onSelect={handleSelect} />
          )}

          {isClientPage && showingList && view === "browse" && (
            <div className="animate-in">
              <div className="section-divider mb-5">
                <span
                  className="text-xs font-semibold uppercase tracking-widest"
                  style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
                >
                  All Profiles
                </span>
                <span
                  className="text-xs font-medium px-2 py-0.5 rounded-full"
                  style={{
                    backgroundColor: "var(--color-amber-light)",
                    color: "var(--color-amber)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {allProfiles.length}
                </span>
              </div>
              <SearchResults results={allProfiles} onSelect={handleSelect} />
            </div>
          )}

          {client && !loading && <ClientView data={client} initialTab={initialTab} />}
        </main>
      </div>
    </div>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
