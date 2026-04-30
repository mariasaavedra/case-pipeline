import { useState, useMemo } from "react";
import type { ClientUpdate } from "../api";
import { BOARD_DISPLAY_NAMES, APPOINTMENT_BOARD_KEYS } from "../../lib/query/types";
import { DOCUMENT_BOARD_KEYS } from "../config";
import type { TimelineFilter } from "./TimelineFilters";

function formatDateTime(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    time: d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
  };
}

function groupByDate(updates: ClientUpdate[]): Record<string, ClientUpdate[]> {
  const groups: Record<string, ClientUpdate[]> = {};
  for (const u of updates) {
    const key = new Date(u.createdAtSource).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    (groups[key] ??= []).push(u);
  }
  return groups;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
  return (parts[0]?.[0] ?? "?").toUpperCase();
}

const AVATAR_COLORS = [
  { bg: "#1e293b", text: "#e2e8f0" },
  { bg: "#7c3aed", text: "#ede9fe" },
  { bg: "#0369a1", text: "#e0f2fe" },
  { bg: "#b45309", text: "#fef3c7" },
  { bg: "#059669", text: "#ecfdf5" },
  { bg: "#be185d", text: "#fce7f3" },
  { bg: "#4338ca", text: "#e0e7ff" },
  { bg: "#dc2626", text: "#fef2f2" },
];

function getAvatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]!;
}

const NOTICE_KEYS = new Set(["rfes_all", "nvc_notices", "_na_originals_cards_notices"]);

function matchesFilter(u: ClientUpdate, filter: TimelineFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "notes":
      return !u.boardKey || (!DOCUMENT_BOARD_KEYS.has(u.boardKey) && !APPOINTMENT_BOARD_KEYS.has(u.boardKey));
    case "documents":
      return !!u.boardKey && DOCUMENT_BOARD_KEYS.has(u.boardKey);
    case "notices":
      return !!u.boardKey && NOTICE_KEYS.has(u.boardKey);
    case "appointments":
      return !!u.boardKey && APPOINTMENT_BOARD_KEYS.has(u.boardKey);
  }
}

function getEventBadge(u: ClientUpdate): { label: string; bg: string; text: string } {
  if (u.sourceType === "reply") return { label: "Reply", bg: "var(--color-status-purple-bg)", text: "var(--color-status-purple)" };
  if (u.boardKey && DOCUMENT_BOARD_KEYS.has(u.boardKey)) return { label: "Document", bg: "var(--color-status-blue-bg)", text: "var(--color-status-blue)" };
  if (u.boardKey && APPOINTMENT_BOARD_KEYS.has(u.boardKey)) return { label: "Appt", bg: "var(--color-status-green-bg)", text: "var(--color-status-green)" };
  if (u.boardKey && NOTICE_KEYS.has(u.boardKey)) return { label: "Notice", bg: "var(--color-status-yellow-bg)", text: "var(--color-status-yellow)" };
  return { label: "Note", bg: "var(--color-surface-warm)", text: "var(--color-ink-muted)" };
}

const PAGE_SIZE = 30;

interface Props {
  updates: ClientUpdate[];
  filter?: TimelineFilter;
  last30Days?: boolean;
}

export function UpdatesTimeline({ updates, filter = "all", last30Days = false }: Props) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const filtered = useMemo(() => {
    let result = updates;
    if (filter !== "all") {
      result = result.filter((u) => matchesFilter(u, filter));
    }
    if (last30Days) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 30);
      result = result.filter((u) => new Date(u.createdAtSource) >= cutoff);
    }
    return result;
  }, [updates, filter, last30Days]);

  const paginated = filtered.slice(0, visibleCount);
  const hasMore = filtered.length > visibleCount;

  if (filtered.length === 0) {
    return (
      <div className="py-10 text-center">
        <p className="text-sm" style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}>
          {filter === "all" ? "No updates yet." : `No ${filter} found.`}
        </p>
      </div>
    );
  }

  const grouped = groupByDate(paginated);
  const dateKeys = Object.keys(grouped);

  return (
    <div>
      {dateKeys.map((date) => (
        <div key={date} className="mb-5 last:mb-0">
          {/* Date header */}
          <div className="flex items-center gap-3 mb-3">
            <span
              className="text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--color-amber)", fontFamily: "var(--font-body)" }}
            >
              {date}
            </span>
            <div className="flex-1 h-px" style={{ backgroundColor: "var(--color-border-light)" }} />
          </div>

          {/* Updates for this date */}
          <div className="space-y-3">
            {grouped[date]!.map((u) => {
              const { time } = formatDateTime(u.createdAtSource);
              const initials = getInitials(u.authorName);
              const avatarColor = getAvatarColor(u.authorName);
              const isReply = u.sourceType === "reply";
              const badge = getEventBadge(u);

              return (
                <div
                  key={u.localId}
                  className="flex gap-3"
                  style={{ paddingLeft: isReply ? 36 : 0 }}
                >
                  {/* Avatar */}
                  <div
                    className="author-avatar"
                    style={{
                      backgroundColor: isReply ? "transparent" : avatarColor.bg,
                      color: isReply ? "var(--color-ink-faint)" : avatarColor.text,
                      border: isReply ? "1.5px solid var(--color-border)" : "none",
                      fontSize: isReply ? 10 : 11,
                      width: isReply ? 24 : 28,
                      height: isReply ? 24 : 28,
                      marginTop: 2,
                    }}
                  >
                    {initials}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center flex-wrap gap-x-2 gap-y-1 mb-1">
                      {/* Event badge */}
                      <span
                        className="event-badge"
                        style={{ backgroundColor: badge.bg, color: badge.text }}
                      >
                        {badge.label}
                      </span>
                      <span
                        className="text-sm font-medium"
                        style={{ color: "var(--color-ink)", fontFamily: "var(--font-body)" }}
                      >
                        {u.authorName}
                      </span>
                      <span
                        className="text-[11px]"
                        style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}
                      >
                        {time}
                      </span>
                      {u.boardKey && (
                        <span className="board-tag">
                          {BOARD_DISPLAY_NAMES[u.boardKey] ?? u.boardKey}
                        </span>
                      )}
                    </div>
                    <p
                      className="text-sm whitespace-pre-wrap leading-relaxed"
                      style={{
                        color: "var(--color-ink-muted)",
                        fontFamily: "var(--font-body)",
                        fontWeight: 300,
                      }}
                    >
                      {u.textBody}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {hasMore && (
        <div className="pt-3 text-center">
          <button
            onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
            className="text-sm font-medium px-4 py-2 rounded-lg"
            style={{
              color: "var(--color-amber)",
              fontFamily: "var(--font-body)",
              backgroundColor: "var(--color-amber-light)",
              border: "none",
              cursor: "pointer",
            }}
          >
            Load more ({filtered.length - visibleCount} remaining)
          </button>
        </div>
      )}
    </div>
  );
}
