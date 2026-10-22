import { useState, useEffect, useMemo } from "react";
import type { ClientCaseSummary, ClientUpdate } from "../api";
import { fetchAllClientUpdates } from "../api";
import { NoteComposer } from "./NoteComposer";
import { navigate, clientPath } from "../router";
import { ClientHeaderSticky } from "./ClientHeaderSticky";
import { PageCode } from "./ScreenCode";
import { ClientSnapshot } from "./ClientSnapshot";
import { ClientTabs, type TabId } from "./ClientTabs";
import { DocumentsTab } from "./DocumentsTab";
import { ClientUploadsList } from "./ClientUploadsList";
import { CaseTimelineTab } from "./CaseTimelineTab";
import {
  TimelineFilters,
  resolveRange,
  type TimelineFilter,
  type TimelinePeriod,
  type DateRange,
} from "./TimelineFilters";
import { UpdatesTimeline } from "./UpdatesTimeline";

/** Screen codes from docs/ui-map.md — P3 is Client 360, one number per tab. */
const TAB_CODES: Record<TabId, string> = {
  overview: "P3.1",
  timeline: "P3.9",
  documents: "P3.6",
};

interface Props {
  data: ClientCaseSummary;
  initialTab?: TabId;
}

export function ClientView({ data, initialTab = "overview" }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);
  const [timelineFilter, setTimelineFilter] = useState<TimelineFilter>("notes");
  const [timelinePeriod, setTimelinePeriod] = useState<TimelinePeriod>("all");
  const [attorneysOnly, setAttorneysOnly] = useState(false);
  const [timelineRange, setTimelineRange] = useState<DateRange>({});
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
  // (fetchAllClientUpdates pages past the cap anyway.)
  // The date bound goes to the server too: `limit` caps the NEWEST rows, so
  // filtering a period in the browser would come back empty for an older range
  // on a client with a busy inbox.
  const { from: rangeFrom, to: rangeTo } = resolveRange(timelinePeriod, timelineRange);

  useEffect(() => {
    let cancelled = false;
    setTimelineLoading(true);
    fetchAllClientUpdates(data.profile.localId, {
      category: timelineFilter,
      from: rangeFrom,
      to: rangeTo,
      author: attorneysOnly ? "attorneys" : undefined,
    })
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
  }, [data.profile.localId, timelineFilter, attorneysOnly, rangeFrom, rangeTo]);

  // A note posted from here is never an email, so it belongs to both views —
  // and it is shown regardless of the period, because it was just written.
  const timelineUpdates = useMemo(
    () => [...pendingUpdates, ...timelineFeed],
    [pendingUpdates, timelineFeed],
  );

  const handleTabChange = (tab: TabId) => {
    setActiveTab(tab);
    navigate(clientPath(data.profile.localId, tab));
  };

  return (
    <div>
      <PageCode code={TAB_CODES[activeTab]} />
      <ClientHeaderSticky profile={data.profile} data={data} />

      <div className="max-w-6xl mx-auto px-6 py-4 space-y-4">
        <ClientSnapshot data={data} />

        <ClientTabs activeTab={activeTab} onTabChange={handleTabChange} />

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
                attorneysOnly={attorneysOnly}
                onAttorneysOnlyChange={setAttorneysOnly}
                period={timelinePeriod}
                customRange={timelineRange}
                onPeriodChange={(p, custom) => {
                  setTimelinePeriod(p);
                  setTimelineRange(custom);
                }}
              />

              <UpdatesTimeline
                updates={timelineUpdates}
                filter={timelineFilter}
                loading={timelineLoading}
                onReplyPosted={(reply) => setPendingUpdates((prev) => [reply, ...prev])}
              />
            </div>
          )}

          {activeTab === "timeline" && <CaseTimelineTab profileLocalId={data.profile.localId} />}

          {activeTab === "documents" && (
            <div className="space-y-4">
              <ClientUploadsList profileLocalId={data.profile.localId} />
              <DocumentsTab
                data={data}
                eFile={{ profileLocalId: data.profile.localId, firstName: data.profile.firstName, lastName: data.profile.lastName }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
