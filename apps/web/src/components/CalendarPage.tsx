// =============================================================================
// Calendar Page — Hearings, Deadlines, Interviews, Appointments
// =============================================================================

import { useState, useEffect, useCallback, useMemo } from "react";
import { fetchCalendarEvents } from "../api";
import type { CalendarResult, CalendarEvent, CalendarCategory } from "../api";
import { Link } from "./Link";
import { clientPath } from "../router";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";

type ViewMode = "month" | "agenda";

// =============================================================================
// Category metadata
// =============================================================================

const ALL_CATEGORIES: CalendarCategory[] = [
  "hearing",
  "court_deadline",
  "uscis_deadline",
  "interview",
  "appointment",
];

const CATEGORY_META: Record<CalendarCategory, { label: string; short: string; color: string; bg: string }> = {
  hearing: { label: "Court Hearings", short: "Hearing", color: "var(--color-status-blue)", bg: "var(--color-status-blue-bg)" },
  court_deadline: { label: "Court Deadlines", short: "Court Deadline", color: "var(--color-status-red)", bg: "var(--color-status-red-bg)" },
  uscis_deadline: { label: "USCIS Deadlines", short: "USCIS Deadline", color: "var(--color-status-yellow)", bg: "var(--color-status-yellow-bg)" },
  interview: { label: "Interviews", short: "Interview", color: "var(--color-status-purple)", bg: "var(--color-status-purple-bg)" },
  appointment: { label: "Appointments", short: "Appointment", color: "var(--color-status-green)", bg: "var(--color-status-green-bg)" },
};

// =============================================================================
// Date helpers — local-calendar-safe (no UTC conversion, unlike Date#toISOString)
// =============================================================================

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseMonthParam(param: string | null): { year: number; month: number } {
  if (param && /^\d{4}-\d{2}$/.test(param)) {
    const [y, m] = param.split("-").map(Number);
    return { year: y!, month: m! - 1 };
  }
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() };
}

function monthParam(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

/** Fixed 6-week (42-day) grid starting the Sunday on/before the 1st of the month. */
function buildMonthGrid(year: number, month: number): Date[] {
  const firstOfMonth = new Date(year, month, 1);
  const gridStart = new Date(year, month, 1 - firstOfMonth.getDay());
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) {
    days.push(new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i));
  }
  return days;
}

function formatMonthLabel(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function formatDayLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function formatTime(timeStr: string | null): string {
  if (!timeStr) return "";
  const [hStr, mStr] = timeStr.split(":");
  const h = parseInt(hStr ?? "0", 10);
  const m = mStr ?? "00";
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${ampm}`;
}

// =============================================================================
// URL / preference sync (self-contained per page — matches AppointmentsPage /
// AlertsPage convention rather than a shared cross-page utility)
// =============================================================================

function getUrlParam(key: string): string | null {
  return new URL(window.location.href).searchParams.get(key);
}

function syncUrlParams(params: Record<string, string>) {
  const url = new URL(window.location.href);
  const defaults: Record<string, string> = { attorney: "all", categories: "all", view: "month" };
  for (const [k, v] of Object.entries(params)) {
    if (v && v !== defaults[k]) {
      url.searchParams.set(k, v);
    } else {
      url.searchParams.delete(k);
    }
  }
  const newPath = url.pathname + url.search;
  if (window.location.pathname + window.location.search !== newPath) {
    window.history.replaceState(null, "", newPath);
  }
}

function loadPreference(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function savePreference(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

// =============================================================================
// Category chips
// =============================================================================

function CategoryChips({
  selected,
  onToggle,
}: {
  selected: Set<CalendarCategory>;
  onToggle: (c: CalendarCategory) => void;
}) {
  const allSelected = selected.size === ALL_CATEGORIES.length;
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <button
        onClick={() => onToggle("__all__" as CalendarCategory)}
        className="text-xs font-medium px-3 py-1 rounded-full transition-colors"
        style={{
          backgroundColor: allSelected ? "var(--color-amber-light)" : "var(--color-surface-warm)",
          color: allSelected ? "var(--color-amber)" : "var(--color-ink-muted)",
          border: `1px solid ${allSelected ? "var(--color-amber)" : "var(--color-border)"}`,
          cursor: "pointer",
          fontFamily: "var(--font-body)",
        }}
      >
        All
      </button>
      {ALL_CATEGORIES.map((c) => {
        const meta = CATEGORY_META[c];
        const active = selected.has(c);
        return (
          <button
            key={c}
            onClick={() => onToggle(c)}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1 rounded-full transition-colors"
            style={{
              backgroundColor: active ? meta.bg : "var(--color-surface-warm)",
              color: active ? meta.color : "var(--color-ink-muted)",
              border: `1px solid ${active ? meta.color : "var(--color-border)"}`,
              cursor: "pointer",
              fontFamily: "var(--font-body)",
            }}
          >
            <span
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: active ? meta.color : "var(--color-ink-faint)" }}
            />
            {meta.label}
          </button>
        );
      })}
    </div>
  );
}

// =============================================================================
// Event row (shared by agenda list + day modal)
// =============================================================================

function EventRow({ event }: { event: CalendarEvent }) {
  const meta = CATEGORY_META[event.category];
  return (
    <div
      className="flex items-start gap-3 px-4 py-3 rounded-xl"
      style={{ backgroundColor: "var(--color-surface-warm)", border: "1px solid var(--color-border-light)" }}
    >
      <div
        className="w-1.5 self-stretch rounded-full flex-shrink-0"
        style={{ backgroundColor: meta.color }}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          {event.time && (
            <span
              className="text-xs font-semibold"
              style={{ fontFamily: "var(--font-mono)", color: "var(--color-ink)" }}
            >
              {formatTime(event.time)}
            </span>
          )}
          <span
            className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
            style={{ backgroundColor: meta.bg, color: meta.color, fontFamily: "var(--font-body)" }}
          >
            {event.subType ?? meta.short}
          </span>
          {event.status && (
            <span className="board-tag">{event.status}</span>
          )}
          {event.attorney && (
            <span
              className="text-[11px] font-medium"
              style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
            >
              {event.attorney}
            </span>
          )}
        </div>

        {event.clientLocalId ? (
          <Link
            href={clientPath(event.clientLocalId)}
            className="text-sm font-semibold hover:underline"
            style={{ fontFamily: "var(--font-display)", color: "var(--color-ink)" }}
          >
            {event.clientName ?? event.name}
          </Link>
        ) : (
          <span
            className="text-sm font-semibold"
            style={{ fontFamily: "var(--font-display)", color: "var(--color-ink)" }}
          >
            {event.clientName ?? event.name}
          </span>
        )}

        {event.clientLocalId && event.clientName && (
          <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-muted)", fontFamily: "var(--font-body)" }}>
            {event.name}
          </p>
        )}

        {(event.detail.judge || event.detail.method || event.detail.location || event.detail.noticeUrl) && (
          <div className="flex items-center gap-3 flex-wrap mt-1.5">
            {event.detail.judge && (
              <span className="text-[11px]" style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}>
                Judge: {event.detail.judge}
              </span>
            )}
            {event.detail.method && (
              <span className="text-[11px]" style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}>
                {event.detail.method}
              </span>
            )}
            {event.detail.location && (
              <span className="text-[11px]" style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}>
                {event.detail.location}
              </span>
            )}
            {event.detail.noticeUrl && (
              <a
                href={event.detail.noticeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] font-medium hover:underline"
                style={{ color: "var(--color-amber)", fontFamily: "var(--font-body)" }}
              >
                View Notice →
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Day agenda modal
// =============================================================================

function DayModal({
  date,
  events,
  onClose,
}: {
  date: string;
  events: CalendarEvent[];
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[80vh] flex-col gap-0 p-0 sm:max-w-lg">
        <DialogHeader className="flex-shrink-0 gap-0.5 border-b border-border px-5 py-4 pr-12">
          <DialogTitle className="text-base" style={{ fontFamily: "var(--font-display)" }}>
            {formatDayLabel(date)}
          </DialogTitle>
          {events.length > 0 && (
            <DialogDescription>
              {events.length} event{events.length !== 1 ? "s" : ""}
            </DialogDescription>
          )}
        </DialogHeader>
        <div className="flex-1 space-y-2 overflow-y-auto px-5 py-4">
          {events.length === 0 ? (
            <p
              className="py-6 text-center text-sm"
              style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
            >
              Nothing on the calendar this day.
            </p>
          ) : (
            events.map((e) => <EventRow key={`${e.boardKey}-${e.localId}`} event={e} />)
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// =============================================================================
// Main Page
// =============================================================================

export function CalendarPage() {
  const [{ year, month }, setYearMonth] = useState(() => parseMonthParam(getUrlParam("month")));
  const [viewMode, setViewMode] = useState<ViewMode>(
    () => (getUrlParam("view") as ViewMode) ?? (loadPreference("calendar-view", "month") as ViewMode),
  );
  const [categories, setCategories] = useState<Set<CalendarCategory>>(() => {
    const param = getUrlParam("categories");
    if (param && param !== "all") {
      const parsed = param.split(",").filter((c): c is CalendarCategory =>
        ALL_CATEGORIES.includes(c as CalendarCategory),
      );
      if (parsed.length > 0) return new Set(parsed);
    }
    return new Set(ALL_CATEGORIES);
  });
  const [attorney, setAttorney] = useState<string>(
    () => getUrlParam("attorney") ?? loadPreference("calendar-attorney", "all"),
  );

  const [data, setData] = useState<CalendarResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const grid = useMemo(() => buildMonthGrid(year, month), [year, month]);
  const gridFrom = useMemo(() => toISODate(grid[0]!), [grid]);
  const gridTo = useMemo(() => toISODate(grid[grid.length - 1]!), [grid]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const categoryList = categories.size === ALL_CATEGORIES.length ? undefined : [...categories];
      const attorneyFilter = attorney !== "all" ? attorney : undefined;
      const result = await fetchCalendarEvents(gridFrom, gridTo, categoryList, attorneyFilter);
      setData(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [gridFrom, gridTo, categories, attorney]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const categoriesParam = categories.size === ALL_CATEGORIES.length ? "all" : [...categories].join(",");
    syncUrlParams({ month: monthParam(year, month), attorney, categories: categoriesParam, view: viewMode });
    savePreference("calendar-attorney", attorney);
    savePreference("calendar-view", viewMode);
  }, [year, month, attorney, categories, viewMode]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of data?.events ?? []) {
      const list = map.get(e.date);
      if (list) list.push(e);
      else map.set(e.date, [e]);
    }
    return map;
  }, [data]);

  const toggleCategory = useCallback((c: CalendarCategory) => {
    setCategories((prev) => {
      if ((c as string) === "__all__") return new Set(ALL_CATEGORIES);
      const next = new Set(prev);
      if (next.has(c)) {
        next.delete(c);
        if (next.size === 0) return new Set(ALL_CATEGORIES);
      } else {
        next.add(c);
      }
      return next;
    });
  }, []);

  const goToMonth = useCallback((delta: number) => {
    setYearMonth(({ year: y, month: m }) => {
      const d = new Date(y, m + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }, []);

  const goToToday = useCallback(() => {
    const now = new Date();
    setYearMonth({ year: now.getFullYear(), month: now.getMonth() });
  }, []);

  const todayStr = toISODate(new Date());
  const attorneys = data?.attorneys.filter((a) => a.trim().length > 0) ?? [];
  const totalCount = data?.events.length ?? 0;

  return (
    <div className="animate-in">
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-2xl mb-1" style={{ fontFamily: "var(--font-display)", color: "var(--color-ink)" }}>
          Calendar
        </h1>
        <p className="text-sm" style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}>
          Court hearings, deadlines, interviews, and appointments in one place.
        </p>
      </div>

      {/* Controls */}
      <div
        className="flex items-center gap-4 flex-wrap mb-5 px-4 py-3 rounded-xl"
        style={{ backgroundColor: "var(--color-surface-warm)", border: "1px solid var(--color-border-light)" }}
      >
        {/* View toggle */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setViewMode("month")}
            className="px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{
              backgroundColor: viewMode === "month" ? "var(--color-amber)" : "transparent",
              color: viewMode === "month" ? "white" : "var(--color-ink-muted)",
              border: viewMode === "month" ? "none" : "1px solid var(--color-border-light)",
              cursor: "pointer",
              fontFamily: "var(--font-body)",
            }}
          >
            Month
          </button>
          <button
            onClick={() => setViewMode("agenda")}
            className="px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{
              backgroundColor: viewMode === "agenda" ? "var(--color-amber)" : "transparent",
              color: viewMode === "agenda" ? "white" : "var(--color-ink-muted)",
              border: viewMode === "agenda" ? "none" : "1px solid var(--color-border-light)",
              cursor: "pointer",
              fontFamily: "var(--font-body)",
            }}
          >
            Agenda
          </button>
        </div>

        <div style={{ width: 1, height: 20, backgroundColor: "var(--color-border-light)" }} />

        {/* Month navigation */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => goToMonth(-1)}
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ border: "1px solid var(--color-border-light)", background: "none", cursor: "pointer", color: "var(--color-ink-muted)" }}
            aria-label="Previous month"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M10 3L5 8l5 5" />
            </svg>
          </button>
          <span
            className="text-sm font-semibold min-w-[130px] text-center"
            style={{ fontFamily: "var(--font-display)", color: "var(--color-ink)" }}
          >
            {formatMonthLabel(year, month)}
          </span>
          <button
            onClick={() => goToMonth(1)}
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ border: "1px solid var(--color-border-light)", background: "none", cursor: "pointer", color: "var(--color-ink-muted)" }}
            aria-label="Next month"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M6 3l5 5-5 5" />
            </svg>
          </button>
          <button
            onClick={goToToday}
            className="filter-chip"
          >
            Today
          </button>
        </div>

        <div style={{ width: 1, height: 20, backgroundColor: "var(--color-border-light)" }} />

        {/* Category filters */}
        <CategoryChips selected={categories} onToggle={toggleCategory} />

        {/* Attorney filter */}
        {attorneys.length > 0 && (
          <>
            <div style={{ width: 1, height: 20, backgroundColor: "var(--color-border-light)" }} />
            <div className="flex items-center gap-1 flex-wrap">
              <button
                className={`filter-chip ${attorney === "all" ? "filter-chip-active" : ""}`}
                onClick={() => setAttorney("all")}
              >
                All Attorneys
              </button>
              {attorneys.map((a) => (
                <button
                  key={a}
                  className={`filter-chip ${attorney === a ? "filter-chip-active" : ""}`}
                  onClick={() => setAttorney(a)}
                >
                  {a}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Error */}
      {error && (
        <div
          className="px-4 py-3 rounded-lg mb-5 text-sm"
          style={{
            backgroundColor: "var(--color-status-red-bg)",
            color: "var(--color-status-red)",
            border: "1px solid rgba(153,27,27,0.15)",
            fontFamily: "var(--font-body)",
          }}
        >
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="py-20 flex flex-col items-center gap-3 animate-in">
          <div className="flex gap-1">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: "var(--color-amber)", animation: "pulse-subtle 1s ease-in-out infinite" }} />
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: "var(--color-amber)", animation: "pulse-subtle 1s ease-in-out 0.2s infinite" }} />
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: "var(--color-amber)", animation: "pulse-subtle 1s ease-in-out 0.4s infinite" }} />
          </div>
          <span className="text-sm" style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}>
            Loading calendar…
          </span>
        </div>
      )}

      {/* Month grid */}
      {!loading && data && viewMode === "month" && (
        <div>
          <div className="grid grid-cols-7 gap-1.5 mb-1.5">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div
                key={d}
                className="text-[11px] font-semibold uppercase tracking-wider text-center py-1"
                style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
              >
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1.5">
            {grid.map((d) => {
              const dateStr = toISODate(d);
              const dayEvents = eventsByDate.get(dateStr) ?? [];
              const isCurrentMonth = d.getMonth() === month;
              const isToday = dateStr === todayStr;
              const categoriesPresent = [...new Set(dayEvents.map((e) => e.category))];

              return (
                <button
                  key={dateStr}
                  onClick={() => dayEvents.length > 0 && setSelectedDate(dateStr)}
                  className="rounded-xl p-2 text-left flex flex-col transition-colors"
                  style={{
                    minHeight: 72,
                    backgroundColor: isToday ? "var(--color-amber-light)" : "var(--color-card)",
                    border: `1px solid ${isToday ? "var(--color-amber)" : "var(--color-border-light)"}`,
                    opacity: isCurrentMonth ? 1 : 0.45,
                    cursor: dayEvents.length > 0 ? "pointer" : "default",
                  }}
                >
                  <span
                    className="text-xs font-semibold mb-1"
                    style={{
                      color: isToday ? "var(--color-amber)" : "var(--color-ink)",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {d.getDate()}
                  </span>
                  <div className="flex flex-wrap gap-1 items-center">
                    {categoriesPresent.slice(0, 4).map((c) => (
                      <span
                        key={c}
                        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: CATEGORY_META[c].color }}
                        title={CATEGORY_META[c].label}
                      />
                    ))}
                    {dayEvents.length > 0 && (
                      <span
                        className="text-[10px] font-medium ml-auto"
                        style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-mono)" }}
                      >
                        {dayEvents.length}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Agenda view */}
      {!loading && data && viewMode === "agenda" && (
        <div className="space-y-5">
          {[...eventsByDate.keys()].sort().length === 0 ? (
            <div className="py-20 text-center">
              <p className="text-sm" style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}>
                Nothing on the calendar this month.
              </p>
            </div>
          ) : (
            [...eventsByDate.keys()]
              .sort()
              .map((dateStr) => (
                <div key={dateStr}>
                  <div className="flex items-center gap-3 mb-2">
                    <span
                      className="text-[11px] font-semibold uppercase tracking-wider"
                      style={{
                        color: dateStr === todayStr ? "var(--color-amber)" : "var(--color-ink-faint)",
                        fontFamily: "var(--font-body)",
                      }}
                    >
                      {formatDayLabel(dateStr)}
                    </span>
                    <div className="flex-1 h-px" style={{ backgroundColor: "var(--color-border-light)" }} />
                  </div>
                  <div className="space-y-2">
                    {eventsByDate.get(dateStr)!.map((e) => (
                      <EventRow key={`${e.boardKey}-${e.localId}`} event={e} />
                    ))}
                  </div>
                </div>
              ))
          )}
        </div>
      )}

      {/* Summary footer */}
      {!loading && data && totalCount > 0 && (
        <div className="mt-6 text-center text-xs" style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}>
          {totalCount} event{totalCount !== 1 ? "s" : ""} in {formatMonthLabel(year, month)}
          {attorney !== "all" ? ` for ${attorney}` : ""}
        </div>
      )}

      {/* Day agenda modal */}
      {selectedDate && (
        <DayModal
          date={selectedDate}
          events={eventsByDate.get(selectedDate) ?? []}
          onClose={() => setSelectedDate(null)}
        />
      )}
    </div>
  );
}
