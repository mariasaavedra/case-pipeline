// =============================================================================
// Appointments Page — Attorney Daily View
// =============================================================================
//
// TODO(monday-write): When editing is enabled, add to each appointment card:
//   - "Update Status" dropdown (sends PATCH to Monday.com API)
//   - "Add Note" text input (creates update via Monday.com API)
//   - "Reschedule" date picker (updates consult_date via Monday.com API)
// These actions should optimistically update the local UI, then sync to Monday.com.
// =============================================================================

import { useState, useEffect, useCallback } from "react";
import { fetchAppointments } from "../api";
import type { AppointmentsResult, AppointmentEntry, ClientUpdate } from "../api";
import { Link } from "./Link";
import { UpdatesTimeline } from "./UpdatesTimeline";
import { NotesModal } from "./NotesModal";
import { AppointmentModal } from "./AppointmentModal";
import { BOARD_DISPLAY_NAMES } from "@case-pipeline/query/types";
import { clientPath } from "../router";

type DetailLevel = "minimal" | "snapshot" | "full";
type DateRange = "day" | "week" | "upcoming" | "all" | "calendar";
type ViewMode = "board" | "list";

const DETAIL_LABELS: { id: DetailLevel; label: string }[] = [
  { id: "minimal", label: "Minimal" },
  { id: "snapshot", label: "Snapshot" },
  { id: "full", label: "Full" },
];

const RANGE_LABELS: { id: DateRange; label: string }[] = [
  { id: "day", label: "Today" },
  { id: "week", label: "This Week" },
  { id: "upcoming", label: "Upcoming" },
  { id: "all", label: "All" },
  { id: "calendar", label: "Pick Date" },
];

// Color palette cycles for dynamically registered attorney boards.
// Known boards get a stable slot; unknown ones cycle through the palette.
const ATTORNEY_PALETTE = [
  { color: "var(--color-amber)",        bg: "var(--color-amber-light)" },
  { color: "var(--color-status-blue)",  bg: "var(--color-status-blue-bg)" },
  { color: "var(--color-status-green)", bg: "var(--color-status-green-bg)" },
  { color: "var(--color-status-red)",   bg: "var(--color-status-red-bg)" },
];

function getAttorneyMeta(boardKey: string, index: number) {
  const slot = ATTORNEY_PALETTE[index % ATTORNEY_PALETTE.length]!;
  const initial = boardKey.replace("appointments_", "").toUpperCase();
  return { initial, ...slot };
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
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

function getPriorityStyle(priority: string | null): { bg: string; text: string } {
  switch (priority?.toLowerCase()) {
    case "high":
      return { bg: "var(--color-status-red-bg)", text: "var(--color-status-red)" };
    case "medium":
      return { bg: "var(--color-status-yellow-bg)", text: "var(--color-status-yellow)" };
    case "low":
      return { bg: "var(--color-status-green-bg)", text: "var(--color-status-green)" };
    default:
      return { bg: "var(--color-surface-warm)", text: "var(--color-ink-muted)" };
  }
}

function getStatusStyle(status: string | null): { bg: string; text: string } {
  const s = status?.toLowerCase() ?? "";
  if (s.includes("done") || s.includes("complete")) {
    return { bg: "var(--color-status-green-bg)", text: "var(--color-status-green)" };
  }
  if (s.includes("cancel") || s.includes("no show")) {
    return { bg: "var(--color-status-red-bg)", text: "var(--color-status-red)" };
  }
  if (s.includes("confirm") || s.includes("scheduled")) {
    return { bg: "var(--color-status-blue-bg)", text: "var(--color-status-blue)" };
  }
  return { bg: "var(--color-status-yellow-bg)", text: "var(--color-status-yellow)" };
}

// =============================================================================
// URL ↔ State Sync
// =============================================================================

function getUrlParam(key: string): string | null {
  return new URL(window.location.href).searchParams.get(key);
}

function syncUrlParams(params: Record<string, string>) {
  const url = new URL(window.location.href);
  const defaults: Record<string, string> = { attorney: "all", range: "day", focus: "all" };
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
// Compact Card (Board Mode)
// =============================================================================

function CompactStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center gap-1">
      <span
        className="text-[10px]"
        style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
      >
        {label}
      </span>
      <span
        className="text-[11px] font-semibold"
        style={{ color: "var(--color-ink)", fontFamily: "var(--font-mono)" }}
      >
        {value}
      </span>
    </div>
  );
}

function AppointmentCardCompact({
  entry,
  onFocus,
}: {
  entry: AppointmentEntry;
  onFocus: (entry: AppointmentEntry) => void;
}) {
  const { appointment, profile, snapshot } = entry;
  const priorityStyle = profile ? getPriorityStyle(profile.priority) : null;
  const statusStyle = getStatusStyle(appointment.status);

  return (
    <div
      className="card"
      style={{
        padding: "12px 14px",
        overflow: "hidden",
        borderLeft: "3px solid transparent",
        borderLeftColor: statusStyle.text,
      }}
    >
      {/* Status + priority row */}
      <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
        {appointment.status && (
          <span
            className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
            style={{
              backgroundColor: statusStyle.bg,
              color: statusStyle.text,
              fontFamily: "var(--font-body)",
            }}
          >
            {appointment.status}
          </span>
        )}
        {profile?.priority && priorityStyle && (
          <span
            className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
            style={{
              backgroundColor: priorityStyle.bg,
              color: priorityStyle.text,
              fontFamily: "var(--font-body)",
            }}
          >
            {profile.priority}
          </span>
        )}
        {appointment.nextDate && (
          <span
            className="text-[10px] ml-auto"
            style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-mono)" }}
          >
            {formatDate(appointment.nextDate)}
            {appointment.nextTime && (
              <span
                className="ml-1 font-semibold"
                style={{ color: "var(--color-amber)" }}
              >
                · {formatTime(appointment.nextTime)}
              </span>
            )}
          </span>
        )}
      </div>

      {/* Client name */}
      {profile ? (
        <Link
          href={clientPath(profile.localId)}
          className="block text-sm font-semibold hover:underline leading-snug"
          style={{ fontFamily: "var(--font-display)", color: "var(--color-ink)" }}
        >
          {profile.name}
        </Link>
      ) : (
        <span
          className="block text-sm font-semibold leading-snug"
          style={{ fontFamily: "var(--font-display)", color: "var(--color-ink-muted)" }}
        >
          Unknown Client
        </span>
      )}

      {/* Appointment type */}
      <p
        className="text-xs mt-0.5 leading-snug"
        style={{ color: "var(--color-ink-muted)", fontFamily: "var(--font-body)" }}
      >
        {appointment.name}
      </p>

      {/* Snapshot stats */}
      <div
        className="flex items-center gap-3 mt-2 flex-wrap px-2 py-1.5 rounded-lg"
        style={{ backgroundColor: "var(--color-surface-warm)" }}
      >
        <CompactStat label="Cases" value={snapshot.activeCaseCount} />
        <CompactStat label="Contracts" value={snapshot.pendingContractCount} />
        {snapshot.nextDeadline && (
          <CompactStat label="Deadline" value={formatDate(snapshot.nextDeadline)} />
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 mt-2.5">
        <button
          onClick={() => onFocus(entry)}
          className="text-[11px] font-medium px-2.5 py-1 rounded-lg transition-colors"
          style={{
            color: "var(--color-ink-muted)",
            backgroundColor: "var(--color-surface-warm)",
            border: "1px solid var(--color-border-light)",
            cursor: "pointer",
            fontFamily: "var(--font-body)",
          }}
        >
          Focus
        </button>
        {profile && (
          <Link
            href={clientPath(profile.localId)}
            className="text-[11px] font-medium px-2.5 py-1 rounded-lg"
            style={{
              color: "var(--color-amber)",
              backgroundColor: "var(--color-amber-light)",
              textDecoration: "none",
              fontFamily: "var(--font-body)",
            }}
          >
            View 360 →
          </Link>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Attorney Column (Board Mode)
// =============================================================================

function AttorneyColumn({
  boardKey,
  index,
  entries,
  onFocus,
}: {
  boardKey: string;
  index: number;
  entries: AppointmentEntry[];
  onFocus: (entry: AppointmentEntry) => void;
}) {
  const meta = getAttorneyMeta(boardKey, index);
  const displayName = (BOARD_DISPLAY_NAMES[boardKey] ?? boardKey)
    .replace("Appointments (", "")
    .replace(")", "");

  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
      {/* Column header */}
      <div
        className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl mb-3"
        style={{
          backgroundColor: meta?.bg ?? "var(--color-surface-warm)",
          border: "1px solid var(--color-border-light)",
        }}
      >
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: meta?.color ?? "var(--color-ink-faint)" }}
        >
          <span
            className="font-bold text-white"
            style={{ fontSize: "10px", fontFamily: "var(--font-body)" }}
          >
            {meta?.initial ?? boardKey.toUpperCase()}
          </span>
        </div>
        <span
          className="text-sm font-semibold flex-1"
          style={{ fontFamily: "var(--font-display)", color: "var(--color-ink)" }}
        >
          {displayName}
        </span>
        <span
          className="text-[11px] font-bold px-2 py-0.5 rounded-full"
          style={{
            backgroundColor: "white",
            color: meta?.color ?? "var(--color-ink-faint)",
            fontFamily: "var(--font-mono)",
            boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
          }}
        >
          {entries.length}
        </span>
      </div>

      {/* Cards */}
      <div className="space-y-2">
        {entries.length > 0 ? (
          entries.map((entry, i) => (
            <div
              key={entry.appointment.localId}
              className={`animate-in animate-in-delay-${Math.min(i + 1, 5)}`}
            >
              <AppointmentCardCompact entry={entry} onFocus={onFocus} />
            </div>
          ))
        ) : (
          <div
            className="px-4 py-8 text-center rounded-xl"
            style={{
              backgroundColor: "var(--color-surface-warm)",
              border: "1px dashed var(--color-border-light)",
            }}
          >
            <p
              className="text-xs"
              style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
            >
              No appointments
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Full Appointment Card (List Mode)
// =============================================================================

function AppointmentCard({
  entry,
  detail,
  defaultExpanded,
  onOpenNotesModal,
  onFocus,
}: {
  entry: AppointmentEntry;
  detail: DetailLevel;
  defaultExpanded: boolean;
  onOpenNotesModal: (updates: ClientUpdate[], title: string) => void;
  onFocus: (entry: AppointmentEntry) => void;
}) {
  const [timelineOpen, setTimelineOpen] = useState(defaultExpanded);
  const [showAllNotes, setShowAllNotes] = useState(false);
  const { appointment, profile, snapshot, updates, caseSummary } = entry;
  const priorityStyle = profile ? getPriorityStyle(profile.priority) : null;
  const statusStyle = getStatusStyle(appointment.status);

  return (
    <div className="card card-elevated" style={{ overflow: "hidden" }}>
      {/* Card header */}
      <div
        className="flex items-start justify-between gap-4 px-5 py-4"
        style={{ borderBottom: "1px solid var(--color-border-light)" }}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            {/* Date + Time */}
            {appointment.nextDate && (
              <span
                className="text-xs font-medium"
                style={{
                  fontFamily: "var(--font-mono)",
                  color: "var(--color-ink-muted)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {formatDate(appointment.nextDate)}
                {appointment.nextTime && (
                  <span
                    className="ml-1.5 font-semibold"
                    style={{ color: "var(--color-amber)" }}
                  >
                    · {formatTime(appointment.nextTime)}
                  </span>
                )}
              </span>
            )}

            {/* Status badge */}
            {appointment.status && (
              <span
                className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                style={{
                  backgroundColor: statusStyle.bg,
                  color: statusStyle.text,
                  fontFamily: "var(--font-body)",
                }}
              >
                {appointment.status}
              </span>
            )}

            {/* Attorney board tag */}
            <span className="board-tag">
              {BOARD_DISPLAY_NAMES[appointment.boardKey] ?? appointment.boardKey}
            </span>
          </div>

          {/* Client name + priority */}
          <div className="flex items-center gap-2">
            {profile ? (
              <Link
                href={clientPath(profile.localId)}
                className="text-base font-semibold hover:underline"
                style={{ fontFamily: "var(--font-display)", color: "var(--color-ink)" }}
              >
                {profile.name}
              </Link>
            ) : (
              <span
                className="text-base font-semibold"
                style={{ fontFamily: "var(--font-display)", color: "var(--color-ink-muted)" }}
              >
                Unknown Client
              </span>
            )}

            {profile?.priority && priorityStyle && (
              <span
                className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
                style={{
                  backgroundColor: priorityStyle.bg,
                  color: priorityStyle.text,
                  fontFamily: "var(--font-body)",
                }}
              >
                {profile.priority}
              </span>
            )}
          </div>

          {/* Appointment type / name */}
          <p
            className="text-sm mt-0.5"
            style={{ color: "var(--color-ink-muted)", fontFamily: "var(--font-body)" }}
          >
            {appointment.name}
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => onFocus(entry)}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
            style={{
              color: "var(--color-ink-muted)",
              backgroundColor: "var(--color-surface-warm)",
              fontFamily: "var(--font-body)",
              border: "1px solid var(--color-border-light)",
              cursor: "pointer",
            }}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="8" cy="8" r="5" />
              <circle cx="8" cy="8" r="1.5" fill="currentColor" />
            </svg>
            Focus
          </button>

          {profile && (
            <Link
              href={clientPath(profile.localId)}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
              style={{
                color: "var(--color-amber)",
                backgroundColor: "var(--color-amber-light)",
                fontFamily: "var(--font-body)",
                border: "none",
                textDecoration: "none",
              }}
            >
              View 360
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M6 3l5 5-5 5" />
              </svg>
            </Link>
          )}
        </div>
      </div>

      {/* Snapshot section — visible in "snapshot" and "full" modes */}
      {detail !== "minimal" && (
        <div
          className="px-5 py-3 flex items-center gap-4 flex-wrap"
          style={{
            backgroundColor: "var(--color-surface-warm)",
            borderBottom: "1px solid var(--color-border-light)",
          }}
        >
          <SnapshotStat label="Active Cases" value={snapshot.activeCaseCount} />
          <SnapshotStat label="Pending Contracts" value={snapshot.pendingContractCount} />
          {snapshot.nextDeadline && (
            <SnapshotStat label="Next Deadline" value={formatDate(snapshot.nextDeadline)} />
          )}
          {profile?.phone && (
            <SnapshotStat label="Phone" value={profile.phone} />
          )}
          {profile?.email && (
            <SnapshotStat label="Email" value={profile.email} />
          )}
        </div>
      )}

      {/* Full case summary — only in "full" mode */}
      {detail === "full" && caseSummary && (
        <div
          className="px-5 py-3"
          style={{ borderBottom: "1px solid var(--color-border-light)" }}
        >
          <div className="flex flex-wrap gap-4">
            {/* Active contracts */}
            {caseSummary.contracts.active.length > 0 && (
              <div className="flex-1 min-w-[200px]">
                <h4
                  className="text-[11px] font-semibold uppercase tracking-wider mb-2"
                  style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
                >
                  Active Contracts ({caseSummary.contracts.active.length})
                </h4>
                {caseSummary.contracts.active.map((c) => (
                  <div key={c.localId} className="flex items-center gap-2 mb-1">
                    <span
                      className="text-xs"
                      style={{ fontFamily: "var(--font-body)", color: "var(--color-ink)" }}
                    >
                      {c.caseType}
                    </span>
                    <span className="board-tag">{c.status}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Board items by type */}
            {Object.entries(caseSummary.boardItems).map(([boardKey, items]) => (
              <div key={boardKey} className="flex-1 min-w-[200px]">
                <h4
                  className="text-[11px] font-semibold uppercase tracking-wider mb-2"
                  style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
                >
                  {BOARD_DISPLAY_NAMES[boardKey] ?? boardKey} ({items.length})
                </h4>
                {items.slice(0, 3).map((item) => (
                  <div key={item.localId} className="flex items-center gap-2 mb-1">
                    <span
                      className="text-xs"
                      style={{ fontFamily: "var(--font-body)", color: "var(--color-ink)" }}
                    >
                      {item.name}
                    </span>
                    {item.status && <span className="board-tag">{item.status}</span>}
                  </div>
                ))}
                {items.length > 3 && (
                  <span
                    className="text-[11px]"
                    style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
                  >
                    +{items.length - 3} more
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Timeline toggle */}
      {updates.length > 0 && (
        <div>
          <div
            className="flex items-center"
            style={{
              borderBottom: timelineOpen ? "1px solid var(--color-border-light)" : "none",
            }}
          >
            <button
              onClick={() => setTimelineOpen(!timelineOpen)}
              className="flex items-center gap-2 px-5 py-2.5 text-left flex-1"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
              }}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                style={{
                  transform: timelineOpen ? "rotate(90deg)" : "none",
                  transition: "transform 0.15s ease",
                  color: "var(--color-ink-faint)",
                }}
              >
                <path d="M6 3l5 5-5 5" />
              </svg>
              <span
                className="text-xs font-medium"
                style={{ color: "var(--color-ink-muted)", fontFamily: "var(--font-body)" }}
              >
                Recent Notes ({updates.length})
              </span>
            </button>

            {timelineOpen && updates.length > 2 && (
              <div className="flex items-center gap-2 pr-5">
                <button
                  onClick={() => setShowAllNotes(!showAllNotes)}
                  className="text-[11px] font-medium px-2 py-1 rounded transition-colors"
                  style={{
                    color: "var(--color-amber)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    fontFamily: "var(--font-body)",
                  }}
                >
                  {showAllNotes ? "Collapse" : "Show all"}
                </button>
                <button
                  onClick={() =>
                    onOpenNotesModal(updates, profile?.name ?? "Client Notes")
                  }
                  className="text-[11px] font-medium px-2 py-1 rounded transition-colors"
                  style={{
                    color: "var(--color-amber)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    fontFamily: "var(--font-body)",
                  }}
                >
                  Open in modal
                </button>
              </div>
            )}
          </div>

          {timelineOpen && (
            <div
              className="px-5 py-3"
              style={showAllNotes ? {} : { maxHeight: 400, overflowY: "auto" }}
            >
              <UpdatesTimeline updates={updates} last30Days />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SnapshotStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col">
      <span
        className="text-[10px] font-semibold uppercase tracking-wider"
        style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
      >
        {label}
      </span>
      <span
        className="text-sm font-medium"
        style={{ color: "var(--color-ink)", fontFamily: "var(--font-mono)" }}
      >
        {value}
      </span>
    </div>
  );
}

// =============================================================================
// View Mode Toggle Icons
// =============================================================================

function IconBoard() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1" y="1" width="6" height="14" rx="1" />
      <rect x="9" y="1" width="6" height="14" rx="1" />
    </svg>
  );
}

function IconList() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 4h10M3 8h10M3 12h10" />
    </svg>
  );
}

// =============================================================================
// Main Page
// =============================================================================

export function AppointmentsPage() {
  const [viewMode, setViewMode] = useState<ViewMode>(
    () => (loadPreference("appointments-view", "board") as ViewMode),
  );
  const [attorney, setAttorney] = useState<string>(() =>
    getUrlParam("attorney") ?? loadPreference("appointments-attorney", "all"),
  );
  const [range, setRange] = useState<DateRange>(() =>
    (getUrlParam("range") as DateRange) ?? "day",
  );
  const [calendarDate, setCalendarDate] = useState<string>(() => {
    const today = new Date();
    return today.toISOString().slice(0, 10);
  });
  const [detail, setDetail] = useState<DetailLevel>(() =>
    (loadPreference("appointments-detail", "snapshot") as DetailLevel),
  );
  // Which attorney board is in focus. "all" = overview (big picture, current
  // multi-column layout); a boardKey = dedicated full-width view of that board.
  const [focusBoard, setFocusBoard] = useState<string>(() =>
    getUrlParam("focus") ?? loadPreference("appointments-focus", "all"),
  );

  const [data, setData] = useState<AppointmentsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Notes modal state
  const [modalNotes, setModalNotes] = useState<ClientUpdate[] | null>(null);
  const [modalTitle, setModalTitle] = useState("");

  // Focus modal state
  const [focusedEntry, setFocusedEntry] = useState<AppointmentEntry | null>(null);

  const openNotesModal = useCallback((updates: ClientUpdate[], title: string) => {
    setModalNotes(updates);
    setModalTitle(title);
  }, []);

  const closeNotesModal = useCallback(() => {
    setModalNotes(null);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Board mode always fetches all attorneys so all columns can be populated
      const attorneyFilter = viewMode === "list" && attorney !== "all" ? attorney : undefined;
      // Calendar mode sends the picked date as "day" range
      const apiRange = range === "calendar" ? "day" : range;
      const apiDate = range === "calendar" ? calendarDate : undefined;
      const result = await fetchAppointments(attorneyFilter, apiRange, apiDate);
      setData(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [attorney, range, calendarDate, viewMode]);

  useEffect(() => {
    load();
  }, [load]);

  // Sync state → URL + localStorage
  useEffect(() => {
    syncUrlParams({ attorney, range, focus: focusBoard });
    savePreference("appointments-attorney", attorney);
    savePreference("appointments-detail", detail);
    savePreference("appointments-view", viewMode);
    savePreference("appointments-focus", focusBoard);
  }, [attorney, range, detail, viewMode, focusBoard]);

  const attorneys = data?.attorneys ?? [];

  // Group entries by date for list mode (week view)
  const entriesByDate: Record<string, AppointmentEntry[]> = {};
  if (data) {
    for (const entry of data.entries) {
      const dateKey = entry.appointment.nextDate ?? "No Date";
      (entriesByDate[dateKey] ??= []).push(entry);
    }
  }
  const dateKeys = Object.keys(entriesByDate).sort();

  // Group entries by boardKey for board mode
  const entriesByBoard: Record<string, AppointmentEntry[]> = {};
  if (data) {
    for (const entry of data.entries) {
      const key = entry.appointment.boardKey;
      (entriesByBoard[key] ??= []).push(entry);
    }
  }

  const totalCount = data?.entries.length ?? 0;

  return (
    <div className="animate-in">
      {/* Page header */}
      <div className="mb-5">
        <h1
          className="text-2xl mb-1"
          style={{ fontFamily: "var(--font-display)", color: "var(--color-ink)" }}
        >
          Appointments
        </h1>
        <p className="text-sm" style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}>
          {range === "day" ? "Today's" : range === "week" ? "This week's" : range === "upcoming" ? "Upcoming" : range === "calendar" ? formatDate(calendarDate) : "All"} schedule
          {viewMode === "list" && attorney !== "all" ? ` for ${attorney}` : ""}.
        </p>
      </div>

      {/* Controls */}
      <div
        className="flex items-center gap-4 flex-wrap mb-5 px-4 py-3 rounded-xl"
        style={{
          backgroundColor: "var(--color-surface-warm)",
          border: "1px solid var(--color-border-light)",
        }}
      >
        {/* View mode toggle */}
        <div className="flex items-center gap-1 mr-1">
          <button
            onClick={() => setViewMode("board")}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{
              backgroundColor: viewMode === "board" ? "var(--color-amber)" : "transparent",
              color: viewMode === "board" ? "white" : "var(--color-ink-muted)",
              border: viewMode === "board" ? "none" : "1px solid var(--color-border-light)",
              cursor: "pointer",
              fontFamily: "var(--font-body)",
            }}
            title="Board view — all attorneys"
          >
            <IconBoard />
            Board
          </button>
          <button
            onClick={() => setViewMode("list")}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{
              backgroundColor: viewMode === "list" ? "var(--color-amber)" : "transparent",
              color: viewMode === "list" ? "white" : "var(--color-ink-muted)",
              border: viewMode === "list" ? "none" : "1px solid var(--color-border-light)",
              cursor: "pointer",
              fontFamily: "var(--font-body)",
            }}
            title="List view — filter by attorney"
          >
            <IconList />
            List
          </button>
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 20, backgroundColor: "var(--color-border-light)" }} />

        {/* Attorney focus — Overview (all) or one attorney's board full-width */}
        {data && data.boardKeys.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap">
            <button
              onClick={() => setFocusBoard("all")}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
              style={{
                backgroundColor: focusBoard === "all" ? "var(--color-amber)" : "transparent",
                color: focusBoard === "all" ? "white" : "var(--color-ink-muted)",
                border: focusBoard === "all" ? "none" : "1px solid var(--color-border-light)",
                cursor: "pointer",
                fontFamily: "var(--font-body)",
              }}
              title="Overview — all attorneys"
            >
              Overview
            </button>
            {data.boardKeys.map((bk, i) => {
              const meta = getAttorneyMeta(bk, i);
              const selected = focusBoard === bk;
              return (
                <button
                  key={bk}
                  onClick={() => setFocusBoard(bk)}
                  className="w-8 h-8 rounded-lg text-xs font-bold transition-colors flex items-center justify-center"
                  style={{
                    backgroundColor: selected ? meta.color : "transparent",
                    color: selected ? "white" : "var(--color-ink-muted)",
                    border: selected ? "none" : "1px solid var(--color-border-light)",
                    cursor: "pointer",
                    fontFamily: "var(--font-body)",
                  }}
                  title={(BOARD_DISPLAY_NAMES[bk] ?? bk).replace("Appointments (", "").replace(")", "")}
                >
                  {meta.initial}
                </button>
              );
            })}
          </div>
        )}

        {/* Divider */}
        <div style={{ width: 1, height: 20, backgroundColor: "var(--color-border-light)" }} />

        {/* Attorney selector — list mode only */}
        {viewMode === "list" && (
          <div className="flex items-center gap-2">
            <span
              className="text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
            >
              Attorney
            </span>
            <div className="flex gap-1">
              <button
                className={`filter-chip ${attorney === "all" ? "filter-chip-active" : ""}`}
                onClick={() => setAttorney("all")}
              >
                All
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
          </div>
        )}

        {/* Range toggle */}
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="text-[11px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
          >
            Range
          </span>
          <div className="flex gap-1 flex-wrap">
            {RANGE_LABELS.map((r) => (
              <button
                key={r.id}
                className={`filter-chip ${range === r.id ? "filter-chip-active" : ""}`}
                onClick={() => setRange(r.id)}
              >
                {r.label}
              </button>
            ))}
          </div>
          {range === "calendar" && (
            <input
              type="date"
              value={calendarDate}
              onChange={(e) => setCalendarDate(e.target.value)}
              style={{
                padding: "4px 10px",
                borderRadius: "8px",
                border: "1px solid var(--color-amber)",
                backgroundColor: "var(--color-card)",
                color: "var(--color-ink)",
                fontFamily: "var(--font-mono)",
                fontSize: "12px",
                cursor: "pointer",
                outline: "none",
              }}
            />
          )}
        </div>

        {/* Detail level — list mode only */}
        {viewMode === "list" && (
          <div className="flex items-center gap-2">
            <span
              className="text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
            >
              Detail
            </span>
            <div className="flex gap-1">
              {DETAIL_LABELS.map((d) => (
                <button
                  key={d.id}
                  className={`filter-chip ${detail === d.id ? "filter-chip-active" : ""}`}
                  onClick={() => setDetail(d.id)}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
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
            <div
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: "var(--color-amber)", animation: "pulse-subtle 1s ease-in-out infinite" }}
            />
            <div
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: "var(--color-amber)", animation: "pulse-subtle 1s ease-in-out 0.2s infinite" }}
            />
            <div
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: "var(--color-amber)", animation: "pulse-subtle 1s ease-in-out 0.4s infinite" }}
            />
          </div>
          <span className="text-sm" style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}>
            Loading appointments…
          </span>
        </div>
      )}

      {/* Empty state */}
      {!loading && data && totalCount === 0 && (
        <div className="py-20 flex flex-col items-center gap-4 animate-in">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center"
            style={{ backgroundColor: "var(--color-amber-light)" }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-amber)" strokeWidth="1.5">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <path d="M3 10h18M8 2v4M16 2v4" />
            </svg>
          </div>
          <div className="text-center">
            <p
              className="text-lg mb-1"
              style={{ fontFamily: "var(--font-display)", color: "var(--color-ink)" }}
            >
              No appointments found
            </p>
            <p className="text-sm" style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}>
              {viewMode === "list" && attorney !== "all"
                ? `No appointments for ${attorney} ${range === "day" ? "today" : range === "calendar" ? `on ${formatDate(calendarDate)}` : range === "week" ? "this week" : ""}.`
                : `No appointments ${range === "day" ? "today" : range === "calendar" ? `on ${formatDate(calendarDate)}` : range === "week" ? "this week" : "found"}.`}
            </p>
          </div>
        </div>
      )}

      {/* ── Dedicated Mode — one attorney's board, full width ──────────────── */}
      {!loading && data && focusBoard !== "all" && (
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <AttorneyColumn
            boardKey={focusBoard}
            index={Math.max(0, data.boardKeys.indexOf(focusBoard))}
            entries={entriesByBoard[focusBoard] ?? []}
            onFocus={setFocusedEntry}
          />
        </div>
      )}

      {/* ── Board Mode ─────────────────────────────────────────────────────── */}
      {!loading && data && focusBoard === "all" && viewMode === "board" && (
        <div style={{ overflowX: "auto", paddingBottom: 8 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${data.boardKeys.length || 1}, minmax(280px, 1fr))`,
              gap: "16px",
              alignItems: "start",
              minWidth: `${(data.boardKeys.length || 1) * 296}px`,
            }}
          >
            {data.boardKeys.map((boardKey, index) => (
              <AttorneyColumn
                key={boardKey}
                boardKey={boardKey}
                index={index}
                entries={entriesByBoard[boardKey] ?? []}
                onFocus={setFocusedEntry}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── List Mode ──────────────────────────────────────────────────────── */}
      {!loading && data && focusBoard === "all" && viewMode === "list" && totalCount > 0 && (
        <div className="space-y-6">
          {dateKeys.map((dateKey) => (
            <div key={dateKey}>
              {/* Date group header (shown when multiple dates) */}
              {dateKeys.length > 1 && (
                <div className="flex items-center gap-3 mb-3">
                  <span
                    className="text-[11px] font-semibold uppercase tracking-wider"
                    style={{ color: "var(--color-amber)", fontFamily: "var(--font-body)" }}
                  >
                    {formatDate(dateKey)}
                  </span>
                  <span
                    className="text-[11px] font-medium px-2 py-0.5 rounded-full"
                    style={{
                      backgroundColor: "var(--color-amber-light)",
                      color: "var(--color-amber)",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {entriesByDate[dateKey]!.length}
                  </span>
                  <div className="flex-1 h-px" style={{ backgroundColor: "var(--color-border-light)" }} />
                </div>
              )}

              {/* Cards */}
              <div className="space-y-3">
                {entriesByDate[dateKey]!.map((entry, i) => (
                  <div key={entry.appointment.localId} className={`animate-in animate-in-delay-${Math.min(i + 1, 5)}`}>
                    <AppointmentCard
                      entry={entry}
                      detail={detail}
                      defaultExpanded={false}
                      onOpenNotesModal={openNotesModal}
                      onFocus={setFocusedEntry}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Summary footer */}
      {!loading && data && totalCount > 0 && (
        <div
          className="mt-6 text-center text-xs"
          style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
        >
          {totalCount} appointment{totalCount !== 1 ? "s" : ""}
          {viewMode === "list" && attorney !== "all" ? ` for ${attorney}` : ""}
          {range === "day" ? " today" : range === "week" ? " this week" : range === "upcoming" ? " upcoming" : range === "calendar" ? ` on ${formatDate(calendarDate)}` : ""}
        </div>
      )}

      {/* Notes modal */}
      {modalNotes && (
        <NotesModal
          updates={modalNotes}
          title={modalTitle}
          onClose={closeNotesModal}
        />
      )}

      {/* Focus modal */}
      {focusedEntry && (
        <AppointmentModal
          entry={focusedEntry}
          onClose={() => setFocusedEntry(null)}
        />
      )}
    </div>
  );
}
