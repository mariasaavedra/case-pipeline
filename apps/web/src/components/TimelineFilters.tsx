// =============================================================================
// TimelineFilters — the Overview timeline's filter bar
// =============================================================================
// Rebuilt 2026-08-07. The previous bar had seven source/board chips (Notes,
// Emails, Activities, Documents, Notices/RFEs, Appointments) plus a "Last 30
// days" toggle. Two problems: "Notes" was an allow-list that quietly excluded
// document and appointment board entries — a chip labelled Notes hid notes —
// and a single 30-day toggle can't answer "what happened in March".
//
// Now: two categories defined by exclusion (everything, or everything that
// isn't email), and a period. Both are applied server-side, so a filtered view
// is the complete set rather than the newest page filtered down.
//
// Designed to grow. Adding a category is one entry in CATEGORIES plus one arm
// of the SQL switch in libs/query/src/updates.ts; adding a period is one entry
// in PERIODS. Nothing else needs to change.
// =============================================================================

import { useState } from "react";
import { Popover } from "./Popover";
import { rangeLabel, type DateRange, type TimelinePeriod } from "../utils/timeline-range";

export type { DateRange, TimelinePeriod };
export { resolveRange } from "../utils/timeline-range";

export type TimelineFilter = "all" | "notes";

const CATEGORIES: { id: TimelineFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "notes", label: "Notes" },
];

const PERIODS: { id: Exclude<TimelinePeriod, "custom">; label: string }[] = [
  { id: "all", label: "All time" },
  { id: "30d", label: "30 days" },
  { id: "90d", label: "90 days" },
  { id: "12m", label: "12 months" },
];

interface Props {
  activeFilter: TimelineFilter;
  onFilterChange: (filter: TimelineFilter) => void;
  period: TimelinePeriod;
  customRange: DateRange;
  onPeriodChange: (period: TimelinePeriod, custom: DateRange) => void;
}

export function TimelineFilters({
  activeFilter,
  onFilterChange,
  period,
  customRange,
  onPeriodChange,
}: Props) {
  const [rangeOpen, setRangeOpen] = useState(false);
  // Draft state so typing a half-finished range doesn't refetch on every
  // keystroke — the range only applies on Apply.
  const [draft, setDraft] = useState<DateRange>(customRange);

  const openRange = () => {
    setDraft(customRange);
    setRangeOpen(true);
  };

  const apply = () => {
    // An empty range is "all time" — treating it as a custom filter would show
    // a chip that filters nothing.
    if (!draft.from && !draft.to) onPeriodChange("all", {});
    else onPeriodChange("custom", draft);
    setRangeOpen(false);
  };

  const clear = () => {
    setDraft({});
    onPeriodChange("all", {});
    setRangeOpen(false);
  };

  return (
    <div
      className="flex items-center justify-between gap-3 py-3 flex-wrap"
      role="group"
      aria-label="Timeline filters"
    >
      <div className="flex items-center gap-2 flex-wrap">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            className={`filter-chip ${activeFilter === c.id ? "filter-chip-active" : ""}`}
            onClick={() => onFilterChange(c.id)}
            aria-pressed={activeFilter === c.id}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {PERIODS.map((p) => (
          <button
            key={p.id}
            className={`filter-chip ${period === p.id ? "filter-chip-active" : ""}`}
            onClick={() => onPeriodChange(p.id, customRange)}
            aria-pressed={period === p.id}
          >
            {p.label}
          </button>
        ))}

        <div style={{ position: "relative" }}>
          <button
            className={`filter-chip ${period === "custom" ? "filter-chip-active" : ""}`}
            onClick={() => (rangeOpen ? setRangeOpen(false) : openRange())}
            aria-expanded={rangeOpen}
            aria-haspopup="dialog"
          >
            📅 {period === "custom" ? rangeLabel(customRange) : "Range…"}
          </button>

          <Popover open={rangeOpen} onClose={() => setRangeOpen(false)}>
            <div style={{ padding: 12, minWidth: 240 }}>
              <label style={labelStyle}>
                From
                <input
                  type="date"
                  value={draft.from ?? ""}
                  max={draft.to || undefined}
                  onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value || undefined }))}
                  style={inputStyle}
                />
              </label>
              <label style={{ ...labelStyle, marginTop: 8 }}>
                To
                <input
                  type="date"
                  value={draft.to ?? ""}
                  min={draft.from || undefined}
                  onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value || undefined }))}
                  style={inputStyle}
                />
              </label>
              <div className="flex items-center gap-2" style={{ marginTop: 12 }}>
                <button onClick={apply} style={primaryBtn}>
                  Apply
                </button>
                <button onClick={clear} style={ghostBtn}>
                  Clear
                </button>
              </div>
            </div>
          </Popover>
        </div>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  fontSize: 11,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "var(--color-ink-faint)",
  fontFamily: "var(--font-body)",
};

const inputStyle: React.CSSProperties = {
  padding: "6px 8px",
  borderRadius: 6,
  border: "1px solid var(--color-border-light)",
  backgroundColor: "var(--color-surface)",
  color: "var(--color-ink)",
  fontFamily: "var(--font-body)",
  fontSize: 13,
  textTransform: "none",
  letterSpacing: "normal",
};

const primaryBtn: React.CSSProperties = {
  padding: "6px 14px",
  borderRadius: 8,
  border: "none",
  backgroundColor: "var(--color-amber)",
  color: "#fff",
  fontFamily: "var(--font-body)",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

const ghostBtn: React.CSSProperties = {
  padding: "6px 12px",
  borderRadius: 8,
  border: "1px solid var(--color-border-light)",
  backgroundColor: "transparent",
  color: "var(--color-ink-muted)",
  fontFamily: "var(--font-body)",
  fontSize: 13,
  cursor: "pointer",
};
