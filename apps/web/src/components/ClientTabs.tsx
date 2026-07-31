export type TabId = "overview" | "appointments" | "contracts" | "active_cases" | "court_cases" | "documents" | "relations" | "debug";

interface Props {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  counts?: {
    appointments: number;
    contracts: number;
    activeCases: number;
    courtCases: number;
    relations: number;
  };
  /** Show the admin-only Debug tab. */
  showDebug?: boolean;
}

const TABS: { id: TabId; label: string; countKey?: keyof NonNullable<Props["counts"]>; adminOnly?: boolean }[] = [
  { id: "overview", label: "Overview" },
  { id: "appointments", label: "Appointments", countKey: "appointments" },
  { id: "contracts", label: "Contracts", countKey: "contracts" },
  { id: "active_cases", label: "Active Cases", countKey: "activeCases" },
  { id: "court_cases", label: "Court Cases", countKey: "courtCases" },
  { id: "documents", label: "Documents" },
  { id: "relations", label: "Relations", countKey: "relations" },
  { id: "debug", label: "Debug", adminOnly: true },
];

export function ClientTabs({ activeTab, onTabChange, counts, showDebug = false }: Props) {
  return (
    <nav className="tab-bar animate-in animate-in-delay-2" role="tablist" aria-label="Client sections">
      {TABS.filter((tab) => !tab.adminOnly || showDebug).map((tab) => {
        const count = tab.countKey && counts ? counts[tab.countKey] : undefined;
        const isActive = activeTab === tab.id;

        return (
          <button
            key={tab.id}
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={isActive}
            aria-controls={`panel-${tab.id}`}
            className="tab-button"
            onClick={() => onTabChange(tab.id)}
          >
            {tab.label}
            {count !== undefined && count > 0 && (
              <span
                className="ml-1.5 text-[11px] font-medium px-1.5 py-0.5 rounded-full"
                style={{
                  backgroundColor: isActive ? "var(--color-amber-light)" : "var(--color-surface-warm)",
                  color: isActive ? "var(--color-amber)" : "var(--color-ink-faint)",
                  fontFamily: "var(--font-mono)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
