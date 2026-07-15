import { useState, useEffect, useCallback } from "react";
import { getPreferences, updatePreferences } from "../api";

export type Theme = "light" | "dark" | "system";
export type DefaultPage = "/" | "/clients" | "/appointments" | "/active-cases" | "/my-cases" | "/alerts";
export type DateFormat = "MM/DD/YYYY" | "DD/MM/YYYY" | "YYYY-MM-DD" | "relative";

export interface Preferences {
  theme: Theme;
  defaultPage: DefaultPage;
  sidebarCollapsedDefault: boolean;
  dateFormat: DateFormat;
}

const STORAGE_KEY = "user-preferences";

const DEFAULTS: Preferences = {
  theme: "system",
  defaultPage: "/",
  sidebarCollapsedDefault: false,
  dateFormat: "MM/DD/YYYY",
};

function load(): Preferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) } as Preferences;
  } catch {
    return DEFAULTS;
  }
}

function save(prefs: Preferences) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {}
}

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-color-scheme: dark)").matches;
}

function applyTheme(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && systemPrefersDark());
  if (dark) {
    document.documentElement.setAttribute("data-theme", "dark");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
}

// Apply on module load to avoid a flash of the wrong theme.
applyTheme(load().theme);

export function usePreferences() {
  const [prefs, setPrefs] = useState<Preferences>(load);

  // Hydrate from the server once (source of truth across devices). Falls back to
  // the localStorage cache when unauthenticated or offline.
  useEffect(() => {
    let cancelled = false;
    getPreferences()
      .then((server) => {
        if (cancelled) return;
        const merged: Preferences = {
          theme: server.theme,
          defaultPage: server.defaultPage as DefaultPage,
          sidebarCollapsedDefault: server.sidebarCollapsedDefault,
          dateFormat: server.dateFormat,
        };
        setPrefs(merged);
        save(merged);
      })
      .catch(() => {
        /* not signed in yet / offline — keep local cache */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Apply theme + persist to cache whenever prefs change.
  useEffect(() => {
    applyTheme(prefs.theme);
    save(prefs);
  }, [prefs]);

  // Re-apply when the OS theme changes and the user is on "system".
  useEffect(() => {
    if (prefs.theme !== "system" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [prefs.theme]);

  const update = useCallback(<K extends keyof Preferences>(key: K, value: Preferences[K]) => {
    setPrefs((prev) => {
      const next = { ...prev, [key]: value };
      save(next);
      // Persist to the server (best-effort — the local cache already applied).
      updatePreferences({ [key]: value }).catch(() => {});
      return next;
    });
  }, []);

  return { prefs, update };
}

export function formatDate(dateStr: string | null | undefined, fmt: DateFormat): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr.includes("T") ? dateStr : `${dateStr}T00:00:00`);
  if (isNaN(d.getTime())) return dateStr;

  if (fmt === "relative") {
    const diffMs = Date.now() - d.getTime();
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
    return `${Math.floor(diffDays / 365)}y ago`;
  }

  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = String(d.getFullYear());

  if (fmt === "MM/DD/YYYY") return `${mm}/${dd}/${yyyy}`;
  if (fmt === "DD/MM/YYYY") return `${dd}/${mm}/${yyyy}`;
  return `${yyyy}-${mm}-${dd}`;
}
