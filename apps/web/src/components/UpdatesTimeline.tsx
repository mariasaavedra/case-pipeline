import { useState, useMemo, useEffect, useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";
import type { ClientUpdate, ClientUpdateAttachment } from "../api";
import {
  BOARD_DISPLAY_NAMES,
  APPOINTMENT_BOARD_KEYS,
  DOCUMENT_BOARD_KEYS,
  NOTICE_BOARD_KEYS as NOTICE_KEYS,
} from "@case-pipeline/query/types";
import type { TimelineFilter } from "./TimelineFilters";
import { Button } from "./ui/button";
import { ReplyComposer } from "./ReplyComposer";
import { renderNoteHtml } from "../utils/note-html";
import { mondayItemUrl, MONDAY_PROFILES_BOARD_ID } from "../config";

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

// E&A source types that come from the Emails & Activities timeline.
const EA_ACTIVITY_TYPES = new Set(["activity", "custom"]);

// Turn bare http(s) URLs in note/email text into clickable links. Emails often
// carry attachment/download links inline as plain text; this makes them usable.
const URL_RE = /(https?:\/\/[^\s<>"')]+)/g;
const URL_TEST = /^https?:\/\//;
function renderTextWithLinks(text: string): ReactNode[] {
  const parts = text.split(URL_RE);
  return parts.map((part, i) =>
    URL_TEST.test(part) ? (
      <a
        key={i}
        href={part}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: "var(--color-status-blue)", textDecoration: "underline", wordBreak: "break-word" }}
      >
        {part}
      </a>
    ) : (
      part
    )
  );
}

function formatFileSize(bytes: number | null): string {
  if (bytes == null || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Attachments({ items }: { items: ClientUpdateAttachment[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {items.map((a, i) => {
        const size = formatFileSize(a.fileSize);
        return (
          <a
            key={i}
            href={a.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs"
            style={{
              backgroundColor: "var(--color-surface-warm)",
              border: "1px solid var(--color-border-light)",
              color: "var(--color-ink-muted)",
              fontFamily: "var(--font-body)",
              maxWidth: 260,
            }}
            title={size ? `${a.name} · ${size}` : a.name}
          >
            <span aria-hidden>📎</span>
            <span className="truncate">{a.name}</span>
            {size && <span style={{ color: "var(--color-ink-faint)" }}>· {size}</span>}
          </a>
        );
      })}
    </div>
  );
}

/**
 * Mirrors `categoryFilter` in libs/query/src/updates.ts. The server already
 * applies this, so it only bites on entries the server never saw — locally
 * posted notes still queued for Monday, which ClientView prepends to the feed.
 */
function matchesFilter(u: ClientUpdate, filter: TimelineFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "notes":
      return u.sourceType !== "email";
  }
}

function getEventBadge(u: ClientUpdate): { label: string; bg: string; text: string } {
  // Source-type badges first, so E&A entries read as what they are while still
  // sharing one chronological stream.
  if (u.sourceType === "email") return { label: "Email", bg: "var(--color-status-blue-bg)", text: "var(--color-status-blue)" };
  if (EA_ACTIVITY_TYPES.has(u.sourceType)) return { label: u.activityTypeName ?? "Activity", bg: "var(--color-amber-light)", text: "var(--color-amber)" };
  if (u.sourceType === "note") return { label: "Note", bg: "var(--color-surface-warm)", text: "var(--color-ink-muted)" };
  if (u.sourceType === "reply") return { label: "Reply", bg: "var(--color-status-purple-bg)", text: "var(--color-status-purple)" };
  if (u.boardKey && DOCUMENT_BOARD_KEYS.has(u.boardKey)) return { label: "Document", bg: "var(--color-status-blue-bg)", text: "var(--color-status-blue)" };
  if (u.boardKey && APPOINTMENT_BOARD_KEYS.has(u.boardKey)) return { label: "Appt", bg: "var(--color-status-green-bg)", text: "var(--color-status-green)" };
  if (u.boardKey && NOTICE_KEYS.has(u.boardKey)) return { label: "Notice", bg: "var(--color-status-yellow-bg)", text: "var(--color-status-yellow)" };
  return { label: "Note", bg: "var(--color-surface-warm)", text: "var(--color-ink-muted)" };
}

// Collapsed height of a long note: about six lines of body text.
const COLLAPSED_PX = 140;

const linkButtonStyle: React.CSSProperties = {
  color: "var(--color-status-blue)",
  fontFamily: "var(--font-body)",
  background: "none",
  border: "none",
  padding: 0,
  cursor: "pointer",
};

/**
 * The note body: formatted HTML when Monday gave us some (sanitized), else the
 * plain text. Long notes clamp to ~6 lines behind "Show full note"; an email's
 * quoted earlier messages fold behind their own toggle.
 */
function NoteBody({ u }: { u: ClientUpdate }) {
  const [expanded, setExpanded] = useState(false);
  const [showQuoted, setShowQuoted] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const html = useMemo(
    () => (u.bodyHtml ? renderNoteHtml(u.bodyHtml, { splitQuoted: u.sourceType === "email" }) : null),
    [u.bodyHtml, u.sourceType],
  );

  // Measured while collapsed only: once expanded the toggle must stay visible.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !expanded) setOverflows(el.scrollHeight > COLLAPSED_PX + 8 || !!html?.quoted);
  }, [html, u.textBody, expanded]);

  const clamped = !expanded && overflows;
  const fade = clamped ? "linear-gradient(to bottom, black 70%, transparent)" : undefined;

  return (
    <div>
      <div
        ref={ref}
        className="text-sm leading-relaxed"
        style={{
          color: "var(--color-ink-muted)",
          fontFamily: "var(--font-body)",
          fontWeight: 300,
          maxHeight: clamped ? COLLAPSED_PX : undefined,
          overflow: clamped ? "hidden" : undefined,
          maskImage: fade,
          WebkitMaskImage: fade,
        }}
      >
        {html ? (
          <div className="note-html" dangerouslySetInnerHTML={{ __html: html.main }} />
        ) : (
          <p className="whitespace-pre-wrap">{renderTextWithLinks(u.textBody)}</p>
        )}
        {expanded && html?.quoted && (
          <div className="mt-2">
            <button type="button" className="text-xs" style={linkButtonStyle} onClick={() => setShowQuoted((v) => !v)}>
              {showQuoted ? "Hide earlier messages" : "Show earlier messages in this thread"}
            </button>
            {showQuoted && (
              <div className="note-html note-quoted mt-2" dangerouslySetInnerHTML={{ __html: html.quoted }} />
            )}
          </div>
        )}
      </div>
      {overflows && (
        <button
          type="button"
          className="text-xs font-medium mt-1"
          style={linkButtonStyle}
          aria-expanded={expanded}
          onClick={() => {
            setExpanded((v) => !v);
            setShowQuoted(false);
          }}
        >
          {expanded ? "Show less" : "Show full note"}
        </button>
      )}
    </div>
  );
}

function mondayLinkFor(u: ClientUpdate): string | null {
  if (!u.mondayItemId) return null;
  return mondayItemUrl(u.mondayBoardId ?? MONDAY_PROFILES_BOARD_ID, u.mondayItemId);
}

interface EntryProps {
  u: ClientUpdate;
  replies: ClientUpdate[];
  onReplyPosted?: (reply: ClientUpdate) => void;
}

function TimelineEntry({ u, replies, onReplyPosted }: EntryProps) {
  const [replying, setReplying] = useState(false);
  const { time } = formatDateTime(u.createdAtSource);
  const initials = getInitials(u.authorName);
  const avatarColor = getAvatarColor(u.authorName);
  const isReply = u.sourceType === "reply";
  const badge = getEventBadge(u);
  const mondayUrl = mondayLinkFor(u);
  const canReply = !!onReplyPosted && u.canReply;

  return (
    <div>
      <div className="flex gap-3">
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
            <span className="event-badge" style={{ backgroundColor: badge.bg, color: badge.text }}>
              {badge.label}
            </span>
            <span className="text-sm font-medium" style={{ color: "var(--color-ink)", fontFamily: "var(--font-body)" }}>
              {u.authorName}
            </span>
            <span
              className="text-[11px]"
              style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}
            >
              {time}
            </span>
            {u.boardKey && <span className="board-tag">{BOARD_DISPLAY_NAMES[u.boardKey] ?? u.boardKey}</span>}
          </div>
          {u.title && (
            <p className="text-sm font-medium mb-0.5" style={{ color: "var(--color-ink)", fontFamily: "var(--font-body)" }}>
              {u.title}
            </p>
          )}
          <NoteBody u={u} />
          <Attachments items={u.attachments} />

          {(canReply || mondayUrl) && (
            <div className="flex items-center flex-wrap gap-x-4 gap-y-1 mt-1.5 text-xs">
              {canReply && !replying && (
                <button
                  type="button"
                  style={{ ...linkButtonStyle, color: "var(--color-ink-muted)" }}
                  onClick={() => setReplying(true)}
                >
                  ↳ Reply
                </button>
              )}
              {mondayUrl && (
                // Monday's API doesn't expose E&A email attachments, so the item page is the only place to see them.
                <a
                  href={mondayUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
                  title={u.sourceType === "email" ? "Email attachments are only visible in Monday.com" : "Open this item in Monday.com"}
                >
                  {u.sourceType === "email" ? "Open in Monday for attachments ↗" : "Open in Monday ↗"}
                </a>
              )}
            </div>
          )}
        </div>
      </div>

      {(replies.length > 0 || replying) && (
        <div className="space-y-3 mt-3" style={{ paddingLeft: 36 }}>
          {replies.map((r) => (
            <TimelineEntry key={r.localId} u={r} replies={[]} onReplyPosted={onReplyPosted} />
          ))}
          {replying && onReplyPosted && (
            <ReplyComposer
              parent={u}
              onCancel={() => setReplying(false)}
              onPosted={(reply) => {
                setReplying(false);
                onReplyPosted(reply);
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Group replies under their parent. A reply whose parent isn't in this list
 * (filtered out, or older than the loaded page) stays in the main stream.
 * Replies read oldest-first under the parent, like a conversation.
 */
export function threadEntries(entries: ClientUpdate[]): { roots: ClientUpdate[]; replies: Map<string, ClientUpdate[]> } {
  const present = new Set(entries.map((e) => e.localId));
  const replies = new Map<string, ClientUpdate[]>();
  const roots: ClientUpdate[] = [];
  for (const e of entries) {
    if (e.parentLocalId && e.parentLocalId !== e.localId && present.has(e.parentLocalId)) {
      const list = replies.get(e.parentLocalId) ?? [];
      list.push(e);
      replies.set(e.parentLocalId, list);
    } else {
      roots.push(e);
    }
  }
  for (const list of replies.values()) {
    list.sort((a, b) => a.createdAtSource.localeCompare(b.createdAtSource));
  }
  return { roots, replies };
}

const PAGE_SIZE = 30;

interface Props {
  updates: ClientUpdate[];
  filter?: TimelineFilter;
  last30Days?: boolean;
  loading?: boolean;
  /** Enables sub-notes: called with the new reply once it's posted. */
  onReplyPosted?: (reply: ClientUpdate) => void;
}

export function UpdatesTimeline({ updates, filter = "all", last30Days = false, loading = false, onReplyPosted }: Props) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Reset the display window when the underlying feed changes (e.g. the filter
  // switched and a fresh category set arrived from the server).
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [filter, last30Days]);

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

  // Pagination counts threads, so a reply never shows without its parent.
  const { roots, replies } = useMemo(() => threadEntries(filtered), [filtered]);

  const paginated = roots.slice(0, visibleCount);
  const hasMore = roots.length > visibleCount;

  if (filtered.length === 0) {
    return (
      <div className="py-10 text-center">
        <p className="text-sm" style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}>
          {loading
            ? "Loading…"
            : filter === "all"
              ? "No updates in this period."
              : "No notes in this period."}
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
            {grouped[date]!.map((u) => (
              <TimelineEntry
                key={u.localId}
                u={u}
                replies={replies.get(u.localId) ?? []}
                onReplyPosted={onReplyPosted}
              />
            ))}
          </div>
        </div>
      ))}

      {hasMore && (
        <div className="pt-3 text-center">
          <Button
            size="lg"
            variant="secondary"
            className="bg-accent px-4 text-primary hover:bg-accent/70"
            onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
          >
            Load more ({roots.length - visibleCount} remaining)
          </Button>
        </div>
      )}
    </div>
  );
}
