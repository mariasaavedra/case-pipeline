import { useState, useMemo } from "react";
import type { ClientCaseSummary } from "../api";
import { BOARD_CONFIG, SECTION_LABELS, DOCUMENT_BOARD_KEYS } from "../config";
import { navigate, clientPath } from "../router";
import { ClientHeaderSticky } from "./ClientHeaderSticky";
import { ClientSnapshot } from "./ClientSnapshot";
import { ClientTabs, type TabId } from "./ClientTabs";
import { ContractsSection } from "./ContractsSection";
import { BoardSection } from "./BoardSection";
import { AppointmentSection } from "./AppointmentSection";
import { TimelineFilters, type TimelineFilter } from "./TimelineFilters";
import { UpdatesTimeline } from "./UpdatesTimeline";
import { DocumentsTab } from "./DocumentsTab";
import { RelationsView } from "./RelationsView";

interface Props {
  data: ClientCaseSummary;
  initialTab?: TabId;
}

export function ClientView({ data, initialTab = "overview" }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);
  const [timelineFilter, setTimelineFilter] = useState<TimelineFilter>("all");
  const [last30Days, setLast30Days] = useState(false);

  const handleTabChange = (tab: TabId) => {
    setActiveTab(tab);
    navigate(clientPath(data.profile.localId, tab));
  };

  const docCount = useMemo(() => {
    let count = 0;
    for (const key of DOCUMENT_BOARD_KEYS) {
      count += data.boardItems[key]?.length ?? 0;
    }
    return count;
  }, [data.boardItems]);

  // Case boards = everything except document boards
  const caseSections = useMemo(() => {
    const sections: { section: string; boards: typeof BOARD_CONFIG }[] = [];
    for (const section of ["cases", "admin"] as const) {
      const boards = BOARD_CONFIG.filter(
        (b) => b.section === section && !DOCUMENT_BOARD_KEYS.has(b.key)
      );
      const hasItems = boards.some((b) => (data.boardItems[b.key]?.length ?? 0) > 0);
      if (hasItems) sections.push({ section, boards });
    }
    return sections;
  }, [data.boardItems]);

  return (
    <div>
      <ClientHeaderSticky
        profile={data.profile}
        data={data}
        onViewRelations={() => handleTabChange("relations")}
      />

      <div className="max-w-6xl mx-auto px-6 py-4 space-y-4">
        <ClientSnapshot data={data} />

        <ClientTabs
          activeTab={activeTab}
          onTabChange={handleTabChange}
          counts={{
            documents: docCount,
            appointments: data.appointments.length,
            relations: 0,
          }}
        />

        {/* Tab panels */}
        <div
          key={activeTab}
          role="tabpanel"
          id={`panel-${activeTab}`}
          aria-labelledby={`tab-${activeTab}`}
          className="animate-in"
        >
          {activeTab === "overview" && (
            <div className="space-y-4">
              <ContractsSection contracts={data.contracts} />

              {caseSections.map(({ section, boards }) => (
                <div key={section}>
                  <div className="section-divider">
                    <span
                      className="text-[11px] font-semibold uppercase tracking-widest"
                      style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
                    >
                      {SECTION_LABELS[section]}
                    </span>
                  </div>
                  {boards.map((board) => {
                    const items = data.boardItems[board.key];
                    if (!items || items.length === 0) return null;
                    return <BoardSection key={board.key} label={board.label} items={items} />;
                  })}
                </div>
              ))}

              <div className="section-divider">
                <span
                  className="text-[11px] font-semibold uppercase tracking-widest"
                  style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
                >
                  Timeline
                </span>
              </div>

              <TimelineFilters
                activeFilter={timelineFilter}
                onFilterChange={setTimelineFilter}
                last30Days={last30Days}
                onToggle30Days={() => setLast30Days(!last30Days)}
              />

              <UpdatesTimeline
                updates={data.updates}
                filter={timelineFilter}
                last30Days={last30Days}
              />
            </div>
          )}

          {activeTab === "documents" && (
            <DocumentsTab boardItems={data.boardItems} />
          )}

          {activeTab === "appointments" && (
            <AppointmentSection appointments={data.appointments} />
          )}

          {activeTab === "relations" && (
            <RelationsView profileLocalId={data.profile.localId} />
          )}
        </div>
      </div>
    </div>
  );
}
