export type TimelineFilter = "all" | "notes" | "documents" | "notices" | "appointments";

interface Props {
  activeFilter: TimelineFilter;
  onFilterChange: (filter: TimelineFilter) => void;
  last30Days: boolean;
  onToggle30Days: () => void;
}

const FILTERS: { id: TimelineFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "notes", label: "Notes" },
  { id: "documents", label: "Documents" },
  { id: "notices", label: "Notices / RFEs" },
  { id: "appointments", label: "Appointments" },
];

export function TimelineFilters({ activeFilter, onFilterChange, last30Days, onToggle30Days }: Props) {
  return (
    <div className="flex items-center justify-between gap-3 py-3" role="group" aria-label="Timeline filters">
      <div className="flex items-center gap-2 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            className={`filter-chip ${activeFilter === f.id ? "filter-chip-active" : ""}`}
            onClick={() => onFilterChange(f.id)}
            aria-pressed={activeFilter === f.id}
          >
            {f.label}
          </button>
        ))}
      </div>
      <button
        className={`filter-chip flex-shrink-0 ${last30Days ? "filter-chip-active" : ""}`}
        onClick={onToggle30Days}
        aria-pressed={last30Days}
      >
        Last 30 days
      </button>
    </div>
  );
}
