// =============================================================================
// FilterBar — Reusable horizontal filter controls
// =============================================================================

import { useState, useEffect } from "react";
import { fetchFilterOptions } from "../api";
import type { FilterOptions } from "../api";
import { BOARD_DISPLAY_NAMES } from "@case-pipeline/query/types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Button } from "./ui/button";

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

  // A filter that is actually filtering reads as active — amber border over a
  // faint amber wash, the same signal the priority chips use.
  const triggerClass = (active: boolean) =>
    `min-w-25 bg-secondary text-[13px] ${active ? "border-primary bg-primary/6" : ""}`;

  // One list per dropdown, fed to both `items` and the rendered options. `items`
  // is what lets the closed trigger show a label: without it Base UI has no
  // value→label map until the popup has been opened once, and every trigger
  // renders blank.
  const statusItems = [
    { value: "", label: "All Statuses" },
    { value: "pending_contracts", label: "Pending Contracts" },
    { value: "paid_fee_ks", label: "Prescheduling" },
    ...(options?.statuses ?? []).map((s) => ({ value: s, label: s })),
  ];

  const attorneyItems = [
    { value: "", label: "All Attorneys" },
    ...(options?.attorneys ?? []).map((a) => ({ value: a, label: a })),
  ];

  const boardTypeItems = [
    { value: "", label: "All Board Types" },
    ...(options?.boardTypes ?? []).map((b) => ({
      value: b.key,
      label: BOARD_DISPLAY_NAMES[b.key] ?? b.key,
    })),
  ];

  const dateStyle: React.CSSProperties = {
    backgroundColor: "var(--color-surface-warm)",
    border: "1px solid var(--color-border)",
    borderRadius: 8,
    padding: "6px 10px",
    fontSize: 13,
    color: "var(--color-ink)",
    fontFamily: "var(--font-body)",
    outline: "none",
    cursor: "pointer",
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
      <Select
        items={statusItems}
        value={filters.status}
        onValueChange={(v) => onFilterChange("status", v ?? "")}
      >
        <SelectTrigger size="sm" className={triggerClass(!!filters.status)} aria-label="Status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {statusItems.map((i) => (
            <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Attorney dropdown */}
      <Select
        items={attorneyItems}
        value={filters.attorney}
        onValueChange={(v) => onFilterChange("attorney", v ?? "")}
      >
        <SelectTrigger size="sm" className={triggerClass(!!filters.attorney)} aria-label="Attorney">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {attorneyItems.map((i) => (
            <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Board Type dropdown */}
      <Select
        items={boardTypeItems}
        value={filters.board_type}
        onValueChange={(v) => onFilterChange("board_type", v ?? "")}
      >
        <SelectTrigger size="sm" className={triggerClass(!!filters.board_type)} aria-label="Board type">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {boardTypeItems.map((i) => (
            <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

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
        <Button size="xs" variant="destructive" onClick={onClear}>
          Clear Filters
        </Button>
      )}
    </div>
  );
}
