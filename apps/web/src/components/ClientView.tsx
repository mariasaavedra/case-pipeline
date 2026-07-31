import { useState, useEffect, useMemo } from "react";
import type { ClientCaseSummary, ClientUpdate } from "../api";
import { fetchClientUpdates } from "../api";
import { BOARD_CONFIG } from "../config";
import { NoteComposer } from "./NoteComposer";
import { navigate, clientPath } from "../router";
import { ClientHeaderSticky } from "./ClientHeaderSticky";
import { ClientSnapshot } from "./ClientSnapshot";
import { ClientTabs, type TabId } from "./ClientTabs";
import { AppointmentSection } from "./AppointmentSection";
import { ContractsTab } from "./ContractsTab";
import { ActiveCasesTab } from "./ActiveCasesTab";
import { CourtCasesTab } from "./CourtCasesTab";
import { DocumentsTab } from "./DocumentsTab";
import { TimelineFilters, type TimelineFilter } from "./TimelineFilters";
import { UpdatesTimeline } from "./UpdatesTimeline";
import { RelationsView } from "./RelationsView";
import { DebugTab } from "./DebugTab";
import { useAuth } from "../auth/useAuth";

interface Props {
  data: ClientCaseSummary;
  initialTab?: TabId;
}

export function ClientView({ data, initialTab = "overview" }: Props) {
  const isAdmin = useAuth().user?.role === "admin";
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);
  const [timelineFilter, setTimelineFilter] = useState<TimelineFilter>("all");
  const [last30Days, setLast30Days] = useState(false);
  const [pendingUpdates, setPendingUpdates] = useState<ClientUpdate[]>([]);

  // Timeline feed. The 360 summary seeds the newest page for an instant paint;
  // then we fetch the COMPLETE set for the active category server-side. The old
  // behavior filtered a 50-item page client-side, so a busy inbox (emails) could
  // push activities/notes out of that window entirely — they looked "missing".
  const [timelineFeed, setTimelineFeed] = useState<ClientUpdate[]>(data.updates);
  const [timelineLoading, setTimelineLoading] = useState(false);

  // Sync activeTab when the route changes (back/forward, direct URL load)
  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  // Fetch the full timeline for the active category (complete per category, not
  // just the newest page filtered). Max updates for any one profile is well
  // under this cap, so this returns everything for that category.
  useEffect(() => {
    let cancelled = false;
    setTimelineLoading(true);
    fetchClientUpdates(data.profile.localId, { category: timelineFilter, limit: 500 })
      .then((rows) => {
        if (!cancelled) setTimelineFeed(rows);
      })
      .catch(() => {
        /* keep the seeded/previous feed on error */
      })
      .finally(() => {
        if (!cancelled) setTimelineLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [data.profile.localId, timelineFilter]);

  // Locally-posted notes belong to the "all" and "notes" views.
  const timelineUpdates = useMemo(() => {
    const showPending = timelineFilter === "all" || timelineFilter === "notes";
    return showPending ? [...pendingUpdates, ...timelineFeed] : timelineFeed;
  }, [pendingUpdates, timelineFeed, timelineFilter]);

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
          showDebug={isAdmin}
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

              <NoteComposer
                profileLocalId={data.profile.localId}
                onPosted={(update) => setPendingUpdates((prev) => [update, ...prev])}
              />

              <TimelineFilters
                activeFilter={timelineFilter}
                onFilterChange={setTimelineFilter}
                last30Days={last30Days}
                onToggle30Days={() => setLast30Days(!last30Days)}
              />

              <UpdatesTimeline
                updates={timelineUpdates}
                filter={timelineFilter}
                last30Days={last30Days}
                loading={timelineLoading}
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
            <DocumentsTab data={data} />
          )}

          {activeTab === "relations" && (
            <RelationsView profileLocalId={data.profile.localId} />
          )}

          {activeTab === "debug" && isAdmin && (
            <DebugTab data={data} />
          )}
        </div>
      </div>
    </div>
  );
}
