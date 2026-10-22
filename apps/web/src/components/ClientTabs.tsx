export type TabId = "overview" | "timeline" | "documents";

export const TAB_IDS: readonly TabId[] = ["overview", "timeline", "documents"];

interface Props {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "timeline", label: "Timeline" },
  { id: "documents", label: "Documents" },
];

export function ClientTabs({ activeTab, onTabChange }: Props) {
  return (
    <nav className="tab-bar animate-in animate-in-delay-2" role="tablist" aria-label="Client sections">
      {TABS.map((tab) => {
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
          </button>
        );
      })}
    </nav>
  );
}
