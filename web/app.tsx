import { useState, useEffect, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { SearchBar } from "./components/SearchBar";
import { SearchResults } from "./components/SearchResults";
import { ClientView } from "./components/ClientView";
import type { TabId } from "./components/ClientTabs";
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
  const currentClientId = useRef<string | null>(null);

  const loadFromHash = useCallback(async () => {
    const hash = window.location.hash;
    const match = hash.match(/^#client\/([^/]+)(?:\/(overview|documents|appointments|relations))?$/);
    if (match) {
      const localId = decodeURIComponent(match[1]!);
      const tab = (match[2] as TabId) ?? "overview";

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
    loadFromHash();
    window.addEventListener("hashchange", loadFromHash);
    return () => window.removeEventListener("hashchange", loadFromHash);
  }, [loadFromHash]);

  const handleSelect = (localId: string) => {
    window.location.hash = `#client/${localId}`;
  };

  const handleBack = () => {
    window.location.hash = "";
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

  const showingList = !client && !loading;

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--color-surface)" }}>
      {/* Header */}
      <header
        className="sticky top-0 z-50"
        style={{
          backgroundColor: "var(--color-navy)",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center gap-5">
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

          <div className="flex items-center gap-3">
            <div
              className="w-7 h-7 rounded-md flex items-center justify-center text-xs font-bold"
              style={{
                backgroundColor: "var(--color-amber)",
                color: "#fff",
                fontFamily: "var(--font-display)",
              }}
            >
              CP
            </div>
            <h1
              className="text-base font-semibold tracking-tight whitespace-nowrap"
              style={{ color: "#fff", fontFamily: "var(--font-body)" }}
            >
              Case Pipeline
            </h1>
          </div>

          {!client && view === "search" && (
            <div className="flex-1 ml-4">
              <SearchBar onResults={setResults} />
            </div>
          )}

          {!client && (
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

        {showingList && view === "search" && results.length === 0 && (
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

        {showingList && view === "search" && (
          <SearchResults results={results} onSelect={handleSelect} />
        )}

        {showingList && view === "browse" && (
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
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
