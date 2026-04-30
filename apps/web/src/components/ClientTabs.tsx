export type TabId = "overview" | "appointments" | "contracts" | "active_cases" | "court_cases" | "documents" | "relations";

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
}

const TABS: { id: TabId; label: string; countKey?: keyof NonNullable<Props["counts"]> }[] = [
  { id: "overview", label: "Overview" },
  { id: "appointments", label: "Appointments", countKey: "appointments" },
  { id: "contracts", label: "Contracts", countKey: "contracts" },
  { id: "active_cases", label: "Active Cases", countKey: "activeCases" },
  { id: "court_cases", label: "Court Cases", countKey: "courtCases" },
  { id: "documents", label: "Documents & Notices" },
  { id: "relations", label: "Relations", countKey: "relations" },
];

export function ClientTabs({ activeTab, onTabChange, counts }: Props) {
  return (
    <nav className="tab-bar animate-in animate-in-delay-2" role="tablist" aria-label="Client sections">
      {TABS.map((tab) => {
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
