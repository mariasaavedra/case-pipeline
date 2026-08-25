import { useState, useEffect, useCallback, useRef, Component, lazy, Suspense } from "react";
import type { ReactNode, ErrorInfo } from "react";
import { createRoot } from "react-dom/client";
import { Sidebar } from "./components/Sidebar";
import { LoginPage } from "./pages/LoginPage";

// Route-level code splitting. These used to be static imports, which meant one
// ~700 KB chunk where opening the dashboard also paid for Settings (1082 lines),
// Appointments (1243) and Calendar (721). Sidebar and LoginPage stay eager:
// Sidebar renders on every screen, and LoginPage is the first paint for a
// signed-out user, so deferring either would only add a round trip.
const ClientView = lazy(() => import("./components/ClientView").then((m) => ({ default: m.ClientView })));
const LandingPage = lazy(() => import("./components/LandingPage").then((m) => ({ default: m.LandingPage })));
const AppointmentsPage = lazy(() => import("./components/AppointmentsPage").then((m) => ({ default: m.AppointmentsPage })));
const ClientsPage = lazy(() => import("./components/ClientsPage").then((m) => ({ default: m.ClientsPage })));
const AlertsPage = lazy(() => import("./components/AlertsPage").then((m) => ({ default: m.AlertsPage })));
const ActiveCasesPage = lazy(() => import("./components/ActiveCasesPage").then((m) => ({ default: m.ActiveCasesPage })));
const MyCasesPage = lazy(() => import("./components/MyCasesPage").then((m) => ({ default: m.MyCasesPage })));
const CalendarPage = lazy(() => import("./components/CalendarPage").then((m) => ({ default: m.CalendarPage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then((m) => ({ default: m.SettingsPage })));
import type { TabId } from "./components/ClientTabs";
import { matchRoute, navigate } from "./router";
import { getClient } from "./api";
import type { ClientCaseSummary } from "./api";
import { AuthProvider } from "./auth/AuthProvider";
import { StatusOverridesProvider } from "./StatusOverridesProvider";
import { StatusOptionsProvider } from "./StatusOptionsProvider";
import { BoardColumnsProvider } from "./BoardColumnsProvider";
import { useAuth } from "./auth/useAuth";
import { usePreferences } from "./hooks/usePreferences";
import { useViewport } from "./hooks/useViewport";

// Shared loading indicator: used both for in-flight data and as the Suspense
// fallback while a route chunk downloads, so the two states look identical.
function PageLoading() {
  return (
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
  );
}

function App() {
  const { user, isLoading: authLoading, logout } = useAuth();
  const { prefs } = usePreferences();
  const { isMobile, isTabletRail } = useViewport();
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
  // Phones: drawer is off-canvas, content takes the full width.
  // Tablets (641–1024px): sidebar is a forced 60px icon rail.
  // Desktop: honour the manual collapse toggle (60 vs 220).
  const sidebarWidth = isMobile ? 0 : sidebarCollapsed || isTabletRail ? 60 : 220;

  // Auth loading — wait before showing anything to avoid flash.
  if (authLoading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "var(--color-bg)" }}>
        <div style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)", fontSize: "14px" }}>Loading…</div>
      </div>
    );
  }

  // Route guard — unauthenticated users only see /login.
  if (!user && route.page !== "login") {
    navigate("/login");
    return null;
  }

  if (user && route.page === "login") {
    navigate(prefs.defaultPage);
    return null;
  }

  // Legacy /admin → redirect to /settings
  if (route.page === "admin") {
    navigate("/settings");
    return null;
  }

  if (route.page === "login") return <LoginPage />;

  if (route.page === "settings") {
    return (
      <div className="app-layout">
        <Sidebar mobileOpen={mobileMenuOpen} onMobileClose={() => setMobileMenuOpen(false)} user={user} onLogout={logout} />
        <div className="app-content" style={{ marginLeft: sidebarWidth }}>
          <Suspense fallback={<PageLoading />}>
            <SettingsPage />
          </Suspense>
        </div>
      </div>
    );
  }

  return (
    <div className="app-layout">
      <Sidebar mobileOpen={mobileMenuOpen} onMobileClose={() => setMobileMenuOpen(false)} user={user} onLogout={logout} />

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

          {loading && <PageLoading />}

          {/* Route views are lazy chunks — one Suspense boundary covers them all,
              since exactly one renders at a time. */}
          <Suspense fallback={<PageLoading />}>
            {/* Landing page — KPI dashboard */}
            {route.page === "landing" && !loading && <LandingPage />}

            {/* Appointments page */}
            {route.page === "appointments" && !loading && <AppointmentsPage />}
            {route.page === "active-cases" && !loading && <ActiveCasesPage />}
            {route.page === "my-cases" && !loading && <MyCasesPage />}
            {route.page === "calendar" && !loading && <CalendarPage />}

            {/* Alerts page */}
            {route.page === "alerts" && !loading && <AlertsPage />}

            {/* Clients page — search + filtered browse */}
            {route.page === "clients" && !loading && !client && <ClientsPage />}

            {/* Client 360 detail view */}
            {isClientDetail && client && !loading && <ClientView data={client} initialTab={initialTab} />}
          </Suspense>
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
root.render(
  <ErrorBoundary>
    <AuthProvider>
      <StatusOverridesProvider>
        <StatusOptionsProvider>
          <BoardColumnsProvider>
            <App />
          </BoardColumnsProvider>
        </StatusOptionsProvider>
      </StatusOverridesProvider>
    </AuthProvider>
  </ErrorBoundary>
);
