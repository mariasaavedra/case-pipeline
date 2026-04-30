import { useState, useEffect } from "react";
import { navigate, matchRoute } from "../router";

const COLLAPSED_KEY = "sidebar-collapsed";

interface NavItem {
  id: string;
  label: string;
  path: string;
  icon: React.ReactNode;
  disabled?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  {
    id: "home",
    label: "Home",
    path: "/",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M3 10L10 3l7 7" />
        <path d="M5 8.5V16a1 1 0 001 1h3v-4h2v4h3a1 1 0 001-1V8.5" />
      </svg>
    ),
  },
  {
    id: "clients",
    label: "Clients",
    path: "/clients",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="10" cy="7" r="3" />
        <path d="M4 17c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      </svg>
    ),
  },
  {
    id: "appointments",
    label: "Appointments",
    path: "/appointments",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="4" width="14" height="13" rx="2" />
        <path d="M3 8h14M7 2v4M13 2v4" />
      </svg>
    ),
  },
  {
    id: "calendar",
    label: "Calendar",
    path: "/calendar",
    disabled: true,
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="4" width="14" height="13" rx="2" />
        <path d="M3 8h14M7 2v4M13 2v4" />
        <circle cx="10" cy="13" r="1.5" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    id: "alerts",
    label: "Alerts",
    path: "/alerts",
    disabled: false,
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M10 2L2 18h16L10 2z" />
        <path d="M10 8v4M10 14v1" />
      </svg>
    ),
  },
];

function isActiveItem(item: NavItem, pathname: string): boolean {
  if (item.path === "/") return pathname === "/";
  return pathname.startsWith(item.path);
}

interface Props {
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export function Sidebar({ mobileOpen, onMobileClose }: Props) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [pathname, setPathname] = useState(window.location.pathname);

  useEffect(() => {
    const onNav = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", onNav);
    return () => window.removeEventListener("popstate", onNav);
  }, []);

  const toggleCollapse = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, String(next));
    } catch {}
  };

  const handleNav = (item: NavItem) => {
    if (item.disabled) return;
    navigate(item.path);
    onMobileClose();
  };

  const width = collapsed ? 60 : 220;

  return (
    <>
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div className="sidebar-backdrop" onClick={onMobileClose} />
      )}

      <aside
        className={`sidebar ${mobileOpen ? "sidebar-mobile-open" : ""}`}
        style={{ width }}
      >
        {/* Logo area */}
        <div className="sidebar-logo" style={{ padding: collapsed ? "16px 12px" : "16px 20px" }}>
          <div
            className="w-7 h-7 rounded-md flex items-center justify-center text-xs font-bold flex-shrink-0"
            style={{
              backgroundColor: "var(--color-amber)",
              color: "#fff",
              fontFamily: "var(--font-display)",
            }}
          >
            CP
          </div>
          {!collapsed && (
            <span
              className="text-sm font-semibold tracking-tight whitespace-nowrap"
              style={{ color: "#fff", fontFamily: "var(--font-body)" }}
            >
              Case Pipeline
            </span>
          )}
        </div>

        {/* Nav items */}
        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item) => {
            const active = isActiveItem(item, pathname);
            return (
              <button
                key={item.id}
                onClick={() => handleNav(item)}
                disabled={item.disabled}
                className={`sidebar-item ${active ? "sidebar-item-active" : ""}`}
                title={collapsed ? item.label : undefined}
                style={{ justifyContent: collapsed ? "center" : "flex-start" }}
              >
                <span className="sidebar-icon">{item.icon}</span>
                {!collapsed && <span className="sidebar-label">{item.label}</span>}
                {item.disabled && !collapsed && (
                  <span className="sidebar-soon">Soon</span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Collapse toggle */}
        <button
          onClick={toggleCollapse}
          className="sidebar-toggle"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            style={{
              transform: collapsed ? "rotate(180deg)" : "none",
              transition: "transform 0.2s ease",
            }}
          >
            <path d="M10 3L5 8l5 5" />
          </svg>
        </button>
      </aside>
    </>
  );
}
