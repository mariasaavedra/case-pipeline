// =============================================================================
// Alerts Page — Smart Alerts grouped by severity
// =============================================================================

import { useState, useEffect, useCallback } from "react";
import { fetchAlerts } from "../api";
import type { AlertsResult, AlertGroup, AlertItem, AlertSeverity } from "../api";
import { Link } from "./Link";
import { BOARD_DISPLAY_NAMES } from "../../lib/query/types";
import { clientPath } from "../router";

type SeverityFilter = "all" | AlertSeverity;

const SEVERITY_LABELS: { id: SeverityFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "critical", label: "Critical" },
  { id: "warning", label: "Warning" },
  { id: "info", label: "Info" },
];

const SEVERITY_STYLES: Record<AlertSeverity, { bg: string; text: string; border: string }> = {
  critical: {
    bg: "var(--color-status-red-bg)",
    text: "var(--color-status-red)",
    border: "rgba(153,27,27,0.15)",
  },
  warning: {
    bg: "var(--color-status-yellow-bg)",
    text: "var(--color-status-yellow)",
    border: "rgba(161,98,7,0.15)",
  },
  info: {
    bg: "var(--color-amber-light)",
    text: "var(--color-amber)",
    border: "rgba(180,83,9,0.15)",
  },
};

// =============================================================================
// URL <-> State Sync
// =============================================================================

function getUrlParam(key: string): string | null {
  return new URL(window.location.href).searchParams.get(key);
}

function syncUrlParams(params: Record<string, string>) {
  const url = new URL(window.location.href);
  for (const [k, v] of Object.entries(params)) {
    if (v && v !== "all") {
      url.searchParams.set(k, v);
    } else {
      url.searchParams.delete(k);
    }
  }
  const newPath = url.pathname + url.search;
  if (window.location.pathname + window.location.search !== newPath) {
    window.history.replaceState(null, "", newPath);
  }
}

function loadPreference(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function savePreference(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

// =============================================================================
// Alert Item Row
// =============================================================================

function AlertItemRow({ item, severity }: { item: AlertItem; severity: AlertSeverity }) {
  const style = SEVERITY_STYLES[severity];

  return (
    <div
      className="flex items-start justify-between gap-3 px-4 py-3"
      style={{ borderBottom: "1px solid var(--color-border-light)" }}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          {/* Item name */}
          <span
            className="text-sm font-medium"
            style={{ fontFamily: "var(--font-body)", color: "var(--color-ink)" }}
          >
            {item.name}
          </span>

          {/* Board tag */}
          {item.boardKey && (
            <span className="board-tag">
              {BOARD_DISPLAY_NAMES[item.boardKey] ?? item.boardKey}
            </span>
          )}

          {/* Status badge */}
          {item.status && (
            <span
              className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
              style={{
                backgroundColor: style.bg,
                color: style.text,
                fontFamily: "var(--font-body)",
              }}
            >
              {item.status}
            </span>
          )}
        </div>

        {/* Client name */}
        <div className="flex items-center gap-2">
          {item.clientLocalId ? (
            <Link
              href={clientPath(item.clientLocalId)}
              className="text-xs hover:underline"
              style={{ color: "var(--color-amber)", fontFamily: "var(--font-body)" }}
            >
              {item.clientName}
            </Link>
          ) : (
            <span className="text-xs" style={{ color: "var(--color-ink-muted)" }}>
              Unknown client
            </span>
          )}

          {item.attorney && (
            <span
              className="text-[10px] font-medium px-1.5 py-0.5 rounded"
              style={{
                backgroundColor: "var(--color-surface-warm)",
                color: "var(--color-ink-faint)",
                fontFamily: "var(--font-body)",
              }}
            >
              {item.attorney}
            </span>
          )}
        </div>
      </div>

      {/* Days overdue / stale / date */}
      <div className="flex-shrink-0 text-right">
        {item.daysOverdue != null && (
          <span
            className="text-xs font-semibold"
            style={{ color: "var(--color-status-red)", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}
          >
            {item.daysOverdue}d overdue
          </span>
        )}
        {item.daysSinceUpdate != null && (
          <span
            className="text-xs font-semibold"
            style={{ color: "var(--color-status-yellow)", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}
          >
            {item.daysSinceUpdate}d since update
          </span>
        )}
        {item.daysOverdue == null && item.daysSinceUpdate == null && item.date && (
          <span
            className="text-xs"
            style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}
          >
            {item.date.slice(0, 10)}
          </span>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Alert Group Section
// =============================================================================

function AlertGroupSection({ group }: { group: AlertGroup }) {
  const [collapsed, setCollapsed] = useState(false);
  const style = SEVERITY_STYLES[group.severity];

  if (group.count === 0) return null;

  return (
    <div className="card card-elevated mb-4 overflow-hidden">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-4 py-3 transition-colors"
        style={{
          backgroundColor: style.bg,
          borderBottom: collapsed ? "none" : `1px solid ${style.border}`,
          cursor: "pointer",
          border: "none",
        }}
      >
        <div className="flex items-center gap-2.5">
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill={style.text}
            className={`toggle-chevron ${!collapsed ? "toggle-chevron-open" : ""}`}
          >
            <path d="M4.5 2l4 4-4 4" />
          </svg>
          <h4
            className="text-sm font-semibold"
            style={{ color: style.text, fontFamily: "var(--font-body)" }}
          >
            {group.label}
          </h4>
          <span
            className="text-[11px]"
            style={{ color: style.text, fontFamily: "var(--font-body)", opacity: 0.7 }}
          >
            — {group.description}
          </span>
        </div>
        <span
          className="text-xs font-semibold px-2.5 py-0.5 rounded-full"
          style={{
            backgroundColor: style.text,
            color: "#fff",
            fontFamily: "var(--font-mono)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {group.count}
        </span>
      </button>

      {!collapsed && (
        <div>
          {group.items.map((item) => (
            <AlertItemRow key={item.localId} item={item} severity={group.severity} />
          ))}
          {group.count > group.items.length && (
            <div
              className="px-4 py-2 text-center text-[11px]"
              style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
            >
              Showing {group.items.length} of {group.count}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Main Page
// =============================================================================

export function AlertsPage() {
  const [attorney, setAttorney] = useState<string>(() =>
    getUrlParam("attorney") ?? loadPreference("alerts-attorney", "all"),
  );
  const [severity, setSeverity] = useState<SeverityFilter>(() =>
    (getUrlParam("severity") as SeverityFilter) ?? "all",
  );

  const [data, setData] = useState<AlertsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchAlerts(attorney !== "all" ? attorney : undefined);
      setData(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [attorney]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    syncUrlParams({ attorney, severity });
    savePreference("alerts-attorney", attorney);
  }, [attorney, severity]);

  const attorneys = data?.attorneys ?? [];
  const filteredGroups = data?.groups.filter(
    (g) => severity === "all" || g.severity === severity,
  ) ?? [];
  const totalFiltered = filteredGroups.reduce((sum, g) => sum + g.count, 0);

  return (
    <div className="animate-in">
      {/* Page header */}
      <div className="mb-5">
        <h1
          className="text-2xl mb-1"
          style={{ fontFamily: "var(--font-display)", color: "var(--color-ink)" }}
        >
          Alerts
        </h1>
        <p className="text-sm" style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}>
          {data ? `${data.totalCount} total alert${data.totalCount !== 1 ? "s" : ""}` : "Loading…"}
          {attorney !== "all" ? ` — filtered for ${attorney}` : ""}
        </p>
      </div>

      {/* Controls */}
      <div
        className="flex items-center gap-4 flex-wrap mb-5 px-4 py-3 rounded-xl"
        style={{
          backgroundColor: "var(--color-surface-warm)",
          border: "1px solid var(--color-border-light)",
        }}
      >
        {/* Attorney selector */}
        <div className="flex items-center gap-2">
          <span
            className="text-[11px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
          >
            Attorney
          </span>
          <div className="flex gap-1">
            <button
              className={`filter-chip ${attorney === "all" ? "filter-chip-active" : ""}`}
              onClick={() => setAttorney("all")}
            >
              All
            </button>
            {attorneys.map((a) => (
              <button
                key={a}
                className={`filter-chip ${attorney === a ? "filter-chip-active" : ""}`}
                onClick={() => setAttorney(a)}
              >
                {a}
              </button>
            ))}
          </div>
        </div>

        {/* Severity filter */}
        <div className="flex items-center gap-2">
          <span
            className="text-[11px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
          >
            Severity
          </span>
          <div className="flex gap-1">
            {SEVERITY_LABELS.map((s) => (
              <button
                key={s.id}
                className={`filter-chip ${severity === s.id ? "filter-chip-active" : ""}`}
                onClick={() => setSeverity(s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div
          className="px-4 py-3 rounded-lg mb-5 text-sm"
          style={{
            backgroundColor: "var(--color-status-red-bg)",
            color: "var(--color-status-red)",
            border: "1px solid rgba(153,27,27,0.15)",
            fontFamily: "var(--font-body)",
          }}
        >
          {error}
        </div>
      )}

      {/* Loading */}
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
            Scanning for alerts…
          </span>
        </div>
      )}

      {/* Empty state — all clear */}
      {!loading && data && data.totalCount === 0 && (
        <div className="py-20 flex flex-col items-center gap-4 animate-in">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center"
            style={{ backgroundColor: "var(--color-status-green-bg)" }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-status-green)" strokeWidth="2">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </div>
          <div className="text-center">
            <p
              className="text-lg mb-1"
              style={{ fontFamily: "var(--font-display)", color: "var(--color-ink)" }}
            >
              All clear
            </p>
            <p className="text-sm" style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}>
              No overdue deadlines, stale cases, or pending contracts without activity.
            </p>
          </div>
        </div>
      )}

      {/* Filtered empty */}
      {!loading && data && data.totalCount > 0 && totalFiltered === 0 && (
        <div className="py-16 flex flex-col items-center gap-3 animate-in">
          <p className="text-sm" style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}>
            No alerts match the selected filters.
          </p>
        </div>
      )}

      {/* Alert groups */}
      {!loading && data && totalFiltered > 0 && (
        <div className="space-y-1">
          {filteredGroups.map((group) => (
            <AlertGroupSection key={group.severity} group={group} />
          ))}
        </div>
      )}

      {/* Summary footer */}
      {!loading && data && totalFiltered > 0 && (
        <div
          className="mt-4 text-center text-xs"
          style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
        >
          {totalFiltered} alert{totalFiltered !== 1 ? "s" : ""}
          {severity !== "all" ? ` (${severity})` : ""}
          {attorney !== "all" ? ` for ${attorney}` : ""}
        </div>
      )}
    </div>
  );
}
