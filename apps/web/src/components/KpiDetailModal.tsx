// =============================================================================
// KPI card detail modal
// =============================================================================
// Click a dashboard card → every case behind that number, not just the top 5.
// The extra column shown per row is the point: which one is a two-layer setting
// (personal choice over a firm-wide default), and the picker here writes both.
// =============================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import type { KpiCardDetail, KpiDetailItem } from "../api";
import { fetchKpiCardItems, fetchGlobalKpiColumns, updateGlobalKpiColumns } from "../api";
import { formatColumnValue, isLabelValue } from "../utils/columnValue";
import { BOARD_DISPLAY_NAMES } from "@case-pipeline/query/types";
import { Link } from "./Link";
import { clientPath } from "../router";
import { ModalPortal } from "./ModalPortal";

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  const d = new Date(`${dateStr}T00:00:00`);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

interface Props {
  cardKey: string;
  cardLabel: string;
  hearingRange?: string;
  /** The column currently in effect for this card, or null when none is set. */
  columnId: string | null;
  /** True when the effective column comes from this user, not the firm default. */
  isPersonalChoice: boolean;
  isAdmin: boolean;
  /** Persist the user's own choice (null clears it, falling back to the default). */
  onSelectColumn: (columnId: string | null) => void;
  onClose: () => void;
}

export function KpiDetailModal({
  cardKey,
  cardLabel,
  hearingRange,
  columnId,
  isPersonalChoice,
  isAdmin,
  onSelectColumn,
  onClose,
}: Props) {
  const [detail, setDetail] = useState<KpiCardDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [savingGlobal, setSavingGlobal] = useState(false);
  const [globalSaved, setGlobalSaved] = useState(false);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [handleKeyDown]);

  // One fetch per card: every row arrives with ALL of its column values, so
  // switching the displayed column below is instant and offline from here on.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchKpiCardItems(cardKey, { hearingRange, ...(columnId ? { column: columnId } : {}) })
      .then((data) => {
        if (cancelled) return;
        setDetail(data);
        setError(null);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // columnId is deliberately NOT a dependency — the rows already carry every
    // column, so re-picking is a client-side re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardKey, hearingRange]);

  const columns = detail?.columns ?? [];
  const items = detail?.items ?? [];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.name?.toLowerCase().includes(q) ||
        item.clientName?.toLowerCase().includes(q) ||
        formatColumnValue(columnId ? item.columnValues[columnId] : null)
          .toLowerCase()
          .includes(q),
    );
  }, [items, query, columnId]);

  const handleSetGlobal = async () => {
    if (!columnId) return;
    setSavingGlobal(true);
    try {
      // The endpoint replaces the whole map, so merge the current defaults in.
      const current = await fetchGlobalKpiColumns();
      await updateGlobalKpiColumns({ ...current, [cardKey]: columnId });
      setGlobalSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingGlobal(false);
    }
  };

  return (
    <ModalPortal>
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(12, 18, 34, 0.55)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="relative w-full max-w-4xl rounded-2xl shadow-2xl flex flex-col animate-in"
        style={{
          backgroundColor: "var(--color-surface)",
          maxHeight: "88vh",
          border: "1px solid var(--color-border)",
        }}
        role="dialog"
        aria-modal="true"
        aria-label={`${cardLabel} — all cases`}
      >
        <div className="h-1 rounded-t-2xl flex-shrink-0" style={{ backgroundColor: "var(--color-amber)" }} />

        {/* Header */}
        <div
          className="flex items-start justify-between gap-4 px-6 py-4 flex-shrink-0"
          style={{ borderBottom: "1px solid var(--color-border-light)" }}
        >
          <div className="min-w-0">
            <h2
              className="text-lg font-semibold leading-snug"
              style={{ fontFamily: "var(--font-display)", color: "var(--color-ink)" }}
            >
              {cardLabel}
            </h2>
            <p className="text-sm mt-0.5" style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}>
              {loading ? "Loading…" : `${filtered.length} of ${items.length} case${items.length === 1 ? "" : "s"}`}
            </p>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{
              background: "none",
              border: "1px solid var(--color-border-light)",
              cursor: "pointer",
              color: "var(--color-ink-faint)",
            }}
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        {/* Controls — search + which column to display */}
        <div
          className="px-6 py-3 flex items-center gap-3 flex-wrap flex-shrink-0"
          style={{
            backgroundColor: "var(--color-surface-warm)",
            borderBottom: "1px solid var(--color-border-light)",
          }}
        >
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter these cases…"
            className="text-sm px-3 py-1.5 rounded-lg flex-1 min-w-[180px]"
            style={{
              backgroundColor: "var(--color-surface)",
              border: "1px solid var(--color-border-light)",
              color: "var(--color-ink)",
              fontFamily: "var(--font-body)",
            }}
          />

          {columns.length > 0 && (
            <label className="flex items-center gap-2 text-xs" style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}>
              Show column
              <select
                value={columnId ?? ""}
                onChange={(e) => {
                  setGlobalSaved(false);
                  onSelectColumn(e.target.value || null);
                }}
                className="text-sm px-2 py-1.5 rounded-lg"
                style={{
                  backgroundColor: "var(--color-surface)",
                  border: "1px solid var(--color-border-light)",
                  color: "var(--color-ink)",
                  fontFamily: "var(--font-body)",
                }}
              >
                <option value="">None</option>
                {columns.map((col) => (
                  <option key={col.id} value={col.id}>
                    {col.label} ({col.populatedCount})
                  </option>
                ))}
              </select>
            </label>
          )}

          {isPersonalChoice && (
            <button
              onClick={() => {
                setGlobalSaved(false);
                onSelectColumn(null);
              }}
              className="text-xs px-2.5 py-1.5 rounded-lg"
              style={{
                background: "none",
                border: "1px solid var(--color-border-light)",
                color: "var(--color-ink-faint)",
                cursor: "pointer",
                fontFamily: "var(--font-body)",
              }}
              title="Drop your personal choice and follow the firm-wide default"
            >
              Reset to default
            </button>
          )}

          {isAdmin && columnId && (
            <button
              onClick={handleSetGlobal}
              disabled={savingGlobal}
              className="text-xs px-2.5 py-1.5 rounded-lg font-medium"
              style={{
                backgroundColor: "var(--color-amber-light)",
                border: "none",
                color: "var(--color-amber)",
                cursor: savingGlobal ? "wait" : "pointer",
                fontFamily: "var(--font-body)",
              }}
              title="Make this the default column for everyone who hasn't picked their own"
            >
              {globalSaved ? "Saved as default ✓" : savingGlobal ? "Saving…" : "Set as default for everyone"}
            </button>
          )}
        </div>

        {/* Rows */}
        <div className="flex-1 overflow-y-auto">
          {error && (
            <div
              className="px-6 py-3 text-sm"
              style={{ color: "var(--color-status-red)", fontFamily: "var(--font-body)" }}
            >
              {error}
            </div>
          )}

          {loading ? (
            <p className="px-6 py-10 text-sm text-center" style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}>
              Loading cases…
            </p>
          ) : filtered.length === 0 ? (
            <p className="px-6 py-10 text-sm text-center" style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}>
              {items.length === 0 ? "Nothing on this card right now." : "No cases match that filter."}
            </p>
          ) : (
            <table className="w-full text-sm" style={{ fontFamily: "var(--font-body)", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--color-border-light)" }}>
                  <Th>Client</Th>
                  <Th>Item</Th>
                  <Th>Date</Th>
                  <Th>{columnLabelFor(columnId, columns) ?? "Status"}</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <Row key={item.localId} item={item} columnId={columnId} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}

function columnLabelFor(
  columnId: string | null,
  columns: { id: string; label: string }[],
): string | null {
  if (!columnId) return null;
  return columns.find((c) => c.id === columnId)?.label ?? columnId;
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      className="text-left text-[11px] font-semibold uppercase tracking-wider px-6 py-2"
      style={{ color: "var(--color-ink-faint)" }}
    >
      {children}
    </th>
  );
}

function Row({ item, columnId }: { item: KpiDetailItem; columnId: string | null }) {
  // Fall back to the row's own status when no column is configured, so the
  // column is never a dead space.
  const raw = columnId ? item.columnValues[columnId] : item.status;
  const display = formatColumnValue(raw);

  return (
    <tr style={{ borderBottom: "1px solid var(--color-border-light)" }}>
      <td className="px-6 py-2.5 align-top">
        {item.clientName && item.clientLocalId ? (
          <Link href={clientPath(item.clientLocalId)} style={{ color: "var(--color-amber)", textDecoration: "none" }}>
            {item.clientName}
          </Link>
        ) : (
          <span style={{ color: "var(--color-ink-faint)" }}>—</span>
        )}
      </td>
      <td className="px-6 py-2.5 align-top" style={{ color: "var(--color-ink)" }}>
        <span>{item.name}</span>
        {item.boardKey && (
          <span className="board-tag ml-2">{BOARD_DISPLAY_NAMES[item.boardKey] ?? item.boardKey}</span>
        )}
      </td>
      <td className="px-6 py-2.5 align-top whitespace-nowrap" style={{ color: "var(--color-ink-muted)", fontFamily: "var(--font-mono)" }}>
        {formatDate(item.date)}
      </td>
      <td className="px-6 py-2.5 align-top">
        {display ? (
          isLabelValue(raw) || !columnId ? (
            <span className="board-tag">{display}</span>
          ) : (
            <span style={{ color: "var(--color-ink)" }}>{display}</span>
          )
        ) : (
          <span style={{ color: "var(--color-ink-faint)" }}>—</span>
        )}
      </td>
    </tr>
  );
}
