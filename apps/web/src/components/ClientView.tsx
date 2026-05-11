import { useState, useEffect, useMemo } from "react";
import type { ClientCaseSummary } from "../api";
import { BOARD_CONFIG, DOCUMENT_BOARD_KEYS } from "../config";
import { navigate, clientPath } from "../router";
import { ClientHeaderSticky } from "./ClientHeaderSticky";
import { ClientSnapshot } from "./ClientSnapshot";
import { ClientTabs, type TabId } from "./ClientTabs";
import { AppointmentSection } from "./AppointmentSection";
import { ContractsTab } from "./ContractsTab";
import { ActiveCasesTab } from "./ActiveCasesTab";
import { CourtCasesTab } from "./CourtCasesTab";
import { SharePointPlaceholder } from "./SharePointPlaceholder";
import { TimelineFilters, type TimelineFilter } from "./TimelineFilters";
import { UpdatesTimeline } from "./UpdatesTimeline";
import { RelationsView } from "./RelationsView";

interface Props {
  data: ClientCaseSummary;
  initialTab?: TabId;
}

export function ClientView({ data, initialTab = "overview" }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);
  const [timelineFilter, setTimelineFilter] = useState<TimelineFilter>("all");
  const [last30Days, setLast30Days] = useState(false);

  // Sync activeTab when the route changes (back/forward, direct URL load)
  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const handleTabChange = (tab: TabId) => {
    setActiveTab(tab);
    navigate(clientPath(data.profile.localId, tab));
  };

  const courtLinkedItemIds = useMemo(
    () => new Set(data.courtLinkedItemIds ?? []),
    [data.courtLinkedItemIds]
  );

  // Count active cases (case boards minus court_cases, minus court-linked items)
  const activeCaseCount = useMemo(() => {
    let count = 0;
    for (const b of BOARD_CONFIG) {
      if (b.section !== "cases" || b.key === "court_cases") continue;
      for (const item of data.boardItems[b.key] ?? []) {
        if (!courtLinkedItemIds.has(item.localId)) count++;
      }
    }
    return count;
  }, [data.boardItems, courtLinkedItemIds]);

  // Count court cases (court_cases board items + court-linked items)
  const courtCaseCount = useMemo(() => {
    let count = data.boardItems["court_cases"]?.length ?? 0;
    count += courtLinkedItemIds.size;
    return count;
  }, [data.boardItems, courtLinkedItemIds]);

  const contractCount = data.contracts.active.length + data.contracts.closed.length;

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
            appointments: data.appointments.length,
            contracts: contractCount,
            activeCases: activeCaseCount,
            courtCases: courtCaseCount,
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

          {activeTab === "appointments" && (
            <AppointmentSection appointments={data.appointments} />
          )}

          {activeTab === "contracts" && (
            <ContractsTab contracts={data.contracts} />
          )}

          {activeTab === "active_cases" && (
            <ActiveCasesTab
              boardItems={data.boardItems}
              courtLinkedItemIds={courtLinkedItemIds}
            />
          )}

          {activeTab === "court_cases" && (
            <CourtCasesTab
              boardItems={data.boardItems}
              courtLinkedItemIds={courtLinkedItemIds}
            />
          )}

          {activeTab === "documents" && (
            <SharePointPlaceholder />
          )}

          {activeTab === "relations" && (
            <RelationsView profileLocalId={data.profile.localId} />
          )}
        </div>
      </div>
    </div>
  );
}
