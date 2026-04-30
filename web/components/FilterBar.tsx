// =============================================================================
// FilterBar — Reusable horizontal filter controls
// =============================================================================

import { useState, useEffect } from "react";
import { fetchFilterOptions } from "../api";
import type { FilterOptions } from "../api";
import { BOARD_DISPLAY_NAMES } from "../../lib/query/types";

interface FilterValues {
  status: string;
  priority: string;
  attorney: string;
  board_type: string;
  date_from: string;
  date_to: string;
}

interface Props {
  filters: FilterValues;
  onFilterChange: (key: keyof FilterValues, value: string) => void;
  onClear: () => void;
  hasActiveFilters: boolean;
  total?: number;
}

const PRIORITY_OPTIONS = ["High", "Medium", "Low"];

export function FilterBar({ filters, onFilterChange, onClear, hasActiveFilters, total }: Props) {
  const [options, setOptions] = useState<FilterOptions | null>(null);

  useEffect(() => {
    fetchFilterOptions().then(setOptions).catch(() => {});
  }, []);

  const selectStyle: React.CSSProperties = {
    backgroundColor: "var(--color-surface-warm)",
    border: "1px solid var(--color-border)",
    borderRadius: 8,
    padding: "6px 10px",
    fontSize: 13,
    color: "var(--color-ink)",
    fontFamily: "var(--font-body)",
    outline: "none",
    cursor: "pointer",
    minWidth: 100,
  };

  const activeSelectStyle: React.CSSProperties = {
    ...selectStyle,
    borderColor: "var(--color-amber)",
    backgroundColor: "rgba(180,83,9,0.06)",
  };

  const dateStyle: React.CSSProperties = {
    ...selectStyle,
    minWidth: 130,
  };

  return (
    <div
      className="flex flex-wrap items-center gap-3 px-5 py-3 rounded-xl mb-5"
      style={{
        backgroundColor: "var(--color-surface-warm)",
        border: "1px solid var(--color-border-light)",
      }}
    >
      {/* Priority chips */}
      <div className="flex items-center gap-1.5">
        <span
          className="text-[11px] font-semibold uppercase tracking-wider mr-1"
          style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
        >
          Priority
        </span>
        {["", ...PRIORITY_OPTIONS].map((p) => (
          <button
            key={p}
            onClick={() => onFilterChange("priority", p)}
            className="px-2.5 py-1 text-xs rounded-md font-medium transition-all"
            style={{
              fontFamily: "var(--font-body)",
              backgroundColor: filters.priority === p
                ? "var(--color-amber)"
                : "transparent",
              color: filters.priority === p
                ? "#fff"
                : "var(--color-ink-muted)",
              border: filters.priority === p
                ? "1px solid var(--color-amber)"
                : "1px solid var(--color-border)",
              cursor: "pointer",
            }}
          >
            {p || "All"}
          </button>
        ))}
      </div>

      {/* Divider */}
      <div style={{ width: 1, height: 24, backgroundColor: "var(--color-border)" }} />

      {/* Status dropdown */}
      <select
        value={filters.status}
        onChange={(e) => onFilterChange("status", e.target.value)}
        style={filters.status ? activeSelectStyle : selectStyle}
      >
        <option value="">All Statuses</option>
        <option value="pending_contracts">Pending Contracts</option>
        <option value="paid_fee_ks">Paid Fee Ks</option>
        {options?.statuses.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>

      {/* Attorney dropdown */}
      <select
        value={filters.attorney}
        onChange={(e) => onFilterChange("attorney", e.target.value)}
        style={filters.attorney ? activeSelectStyle : selectStyle}
      >
        <option value="">All Attorneys</option>
        {options?.attorneys.map((a) => (
          <option key={a} value={a}>{a}</option>
        ))}
      </select>

      {/* Board Type dropdown */}
      <select
        value={filters.board_type}
        onChange={(e) => onFilterChange("board_type", e.target.value)}
        style={filters.board_type ? activeSelectStyle : selectStyle}
      >
        <option value="">All Board Types</option>
        {options?.boardTypes.map((b) => (
          <option key={b.key} value={b.key}>
            {BOARD_DISPLAY_NAMES[b.key] ?? b.key}
          </option>
        ))}
      </select>

      {/* Divider */}
      <div style={{ width: 1, height: 24, backgroundColor: "var(--color-border)" }} />

      {/* Date range */}
      <div className="flex items-center gap-2">
        <span
          className="text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
        >
          Dates
        </span>
        <input
          type="date"
          value={filters.date_from}
          onChange={(e) => onFilterChange("date_from", e.target.value)}
          style={filters.date_from ? { ...dateStyle, borderColor: "var(--color-amber)" } : dateStyle}
        />
        <span style={{ color: "var(--color-ink-faint)", fontSize: 12 }}>to</span>
        <input
          type="date"
          value={filters.date_to}
          onChange={(e) => onFilterChange("date_to", e.target.value)}
          style={filters.date_to ? { ...dateStyle, borderColor: "var(--color-amber)" } : dateStyle}
        />
      </div>

      {/* Spacer + results count + clear */}
      <div className="flex-1" />

      {total !== undefined && (
        <span
          className="text-xs font-medium"
          style={{ color: "var(--color-ink-muted)", fontFamily: "var(--font-mono)" }}
        >
          {total} client{total !== 1 ? "s" : ""}
        </span>
      )}

      {hasActiveFilters && (
        <button
          onClick={onClear}
          className="px-3 py-1 text-xs rounded-md font-medium transition-all"
          style={{
            fontFamily: "var(--font-body)",
            backgroundColor: "transparent",
            color: "var(--color-status-red)",
            border: "1px solid var(--color-status-red)",
            cursor: "pointer",
            opacity: 0.8,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.8")}
        >
          Clear Filters
        </button>
      )}
    </div>
  );
}
