import { useState, useEffect, useCallback, useRef, Component } from "react";
import type { ReactNode, ErrorInfo } from "react";
import { createRoot } from "react-dom/client";
import { ClientView } from "./components/ClientView";
import { Sidebar } from "./components/Sidebar";
import { LandingPage } from "./components/LandingPage";
import { AppointmentsPage } from "./components/AppointmentsPage";
import { ClientsPage } from "./components/ClientsPage";
import { AlertsPage } from "./components/AlertsPage";
import type { TabId } from "./components/ClientTabs";
import { matchRoute, navigate } from "./router";
import { getClient } from "./api";
import type { ClientCaseSummary } from "./api";

function App() {
  const [client, setClient] = useState<ClientCaseSummary | null>(null);
  const [initialTab, setInitialTab] = useState<TabId>("overview");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [pathname, setPathname] = useState(window.location.pathname);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem("sidebar-collapsed") === "true";
    } catch {
      return false;
    }
  });
  const currentClientId = useRef<string | null>(null);
  const clientRef = useRef<ClientCaseSummary | null>(null);
  clientRef.current = client;

  const loadFromRoute = useCallback(async () => {
    const currentPath = window.location.pathname;
    setPathname(currentPath);
    const route = matchRoute(currentPath);

    if (route.page === "client-detail") {
      const localId = route.params.id!;
      const tab = (route.params.tab as TabId) ?? "overview";

      // Same client, just switching tabs
      if (currentClientId.current === localId && clientRef.current) {
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
  }, []);

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

  const handleBack = () => {
    navigate("/clients");
  };

  const route = matchRoute(pathname);
  const isClientDetail = route.page === "client-detail";
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

          {/* Appointments page */}
          {route.page === "appointments" && !loading && <AppointmentsPage />}

          {/* Alerts page */}
          {route.page === "alerts" && !loading && <AlertsPage />}

          {/* Clients page — search + filtered browse */}
          {route.page === "clients" && !loading && !client && <ClientsPage />}

          {/* Client 360 detail view */}
          {isClientDetail && client && !loading && <ClientView data={client} initialTab={initialTab} />}
        </main>
      </div>
    </div>
  );
}

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  override state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Caught by ErrorBoundary:", error, info);
  }
  override render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: "2rem", textAlign: "center", color: "#666" }}>
          <h2>Something went wrong</h2>
          <p>Try refreshing the page.</p>
          <button onClick={() => window.location.reload()} style={{ marginTop: "1rem", padding: "0.5rem 1rem", cursor: "pointer" }}>
            Refresh
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const root = createRoot(document.getElementById("root")!);
root.render(<ErrorBoundary><App /></ErrorBoundary>);
