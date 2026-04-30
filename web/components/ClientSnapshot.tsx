import { useState, useMemo, useCallback } from "react";
import type { ClientCaseSummary } from "../api";
import { getStatusColor, DOCUMENT_BOARD_KEYS } from "../config";
import { StatusBadge } from "./StatusBadge";
import { Popover } from "./Popover";
import { getMostRelevantUpdate } from "../utils/relevance";
import { BOARD_DISPLAY_NAMES, APPOINTMENT_BOARD_KEYS } from "../../lib/query/types";

type StatusMode = "worst" | "all" | "primary";
type PopoverId = "status" | "deadline" | "relief" | "action" | null;

const SEVERITY: Record<string, number> = { red: 0, yellow: 1, blue: 2, green: 3, purple: 4, gray: 5 };

const MODE_LABELS: Record<StatusMode, string> = {
  worst: "Urgent",
  all: "All",
  primary: "Primary",
};

interface Props {
  data: ClientCaseSummary;
}

export function ClientSnapshot({ data }: Props) {
  const [statusMode, setStatusMode] = useState<StatusMode>("worst");
  const [activePopover, setActivePopover] = useState<PopoverId>(null);

  const statuses = useMemo(() => {
    const counts = new Map<string, { count: number; boards: Set<string> }>();
    for (const [boardKey, items] of Object.entries(data.boardItems)) {
      for (const item of items) {
        if (item.status) {
          const existing = counts.get(item.status);
          if (existing) {
            existing.count++;
            existing.boards.add(boardKey);
          } else {
            counts.set(item.status, { count: 1, boards: new Set([boardKey]) });
          }
        }
      }
    }
    return [...counts.entries()]
      .map(([status, { count, boards }]) => ({
        status,
        count,
        color: getStatusColor(status),
        boards: [...boards],
      }))
      .sort((a, b) => (SEVERITY[a.color] ?? 5) - (SEVERITY[b.color] ?? 5));
  }, [data.boardItems]);

  const worstStatus = statuses[0] ?? null;
  const primaryStatus = data.contracts.active[0]?.status ?? null;

  const deadlines = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const all: { date: string; boardKey: string; itemName: string }[] = [];

    for (const [boardKey, items] of Object.entries(data.boardItems)) {
      for (const item of items) {
        if (item.nextDate && item.nextDate >= today) {
          all.push({ date: item.nextDate, boardKey, itemName: item.name });
        }
      }
    }
    for (const a of data.appointments) {
      if (a.nextDate && a.nextDate >= today) {
        all.push({ date: a.nextDate, boardKey: a.boardKey, itemName: a.name });
      }
    }
    return all.sort((a, b) => a.date.localeCompare(b.date));
  }, [data.boardItems, data.appointments]);

  const nextDeadline = deadlines[0] ?? null;

  const reliefTypes = useMemo(
    () => [...new Set(data.contracts.active.map((c) => c.caseType))],
    [data.contracts.active]
  );

  const lastAction = useMemo(
    () => getMostRelevantUpdate(data.updates),
    [data.updates]
  );

  const cycleMode = (e: React.MouseEvent) => {
    e.stopPropagation();
    const modes: StatusMode[] = ["worst", "all", "primary"];
    const idx = modes.indexOf(statusMode);
    setStatusMode(modes[(idx + 1) % modes.length]!);
  };

  const togglePopover = useCallback((id: PopoverId) => {
    setActivePopover((prev) => (prev === id ? null : id));
  }, []);

  const closePopover = useCallback(() => setActivePopover(null), []);

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  const formatRelativeTime = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffH = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffH < 1) return "just now";
    if (diffH < 24) return `${diffH}h ago`;
    const diffD = Math.floor(diffH / 24);
    if (diffD === 1) return "yesterday";
    if (diffD < 30) return `${diffD}d ago`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  return (
    <div className="snapshot-grid animate-in animate-in-delay-1">
      {/* Card 1: Case Status */}
      <div className={`snapshot-card${activePopover === "status" ? " popover-open" : ""}`} onClick={() => togglePopover("status")}>
        <div className="flex items-center justify-between mb-2">
          <span className="snapshot-label">Case Status</span>
          <button
            onClick={cycleMode}
            className="text-[10px] font-medium px-1.5 py-0.5 rounded"
            style={{
              backgroundColor: "var(--color-surface-warm)",
              color: "var(--color-ink-faint)",
              border: "1px solid var(--color-border-light)",
              fontFamily: "var(--font-body)",
              cursor: "pointer",
            }}
          >
            {MODE_LABELS[statusMode]}
          </button>
        </div>
        <div className="snapshot-value">
          {statusMode === "worst" && (
            worstStatus ? <StatusBadge status={worstStatus.status} /> : (
              <span style={{ color: "var(--color-ink-faint)" }}>No cases</span>
            )
          )}
          {statusMode === "primary" && (
            primaryStatus ? <StatusBadge status={primaryStatus} /> : (
              <span style={{ color: "var(--color-ink-faint)" }}>No active contract</span>
            )
          )}
          {statusMode === "all" && (
            statuses.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {statuses.map((s) => (
                  <span key={s.status} className="flex items-center gap-1">
                    <StatusBadge status={s.status} />
                    <span
                      className="text-[10px]"
                      style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}
                    >
                      {s.count}
                    </span>
                  </span>
                ))}
              </div>
            ) : (
              <span style={{ color: "var(--color-ink-faint)" }}>No cases</span>
            )
          )}
        </div>
        <Popover open={activePopover === "status"} onClose={closePopover}>
          <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--color-ink-faint)" }}>
            All Statuses
          </div>
          {statuses.length === 0 ? (
            <p className="text-xs" style={{ color: "var(--color-ink-faint)" }}>No cases found</p>
          ) : (
            <div className="space-y-2">
              {statuses.map((s) => (
                <div key={s.status} className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <StatusBadge status={s.status} />
                    <span className="text-xs" style={{ color: "var(--color-ink-muted)", fontFamily: "var(--font-mono)" }}>
                      x{s.count}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1 justify-end">
                    {s.boards.map((bk) => (
                      <span key={bk} className="board-tag" style={{ fontSize: 10 }}>
                        {BOARD_DISPLAY_NAMES[bk] ?? bk}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Popover>
      </div>

      {/* Card 2: Next Deadline */}
      <div className={`snapshot-card${activePopover === "deadline" ? " popover-open" : ""}`} onClick={() => togglePopover("deadline")}>
        <span className="snapshot-label">Next Deadline</span>
        {nextDeadline ? (
          <div>
            <div
              className="text-sm font-semibold"
              style={{ color: "var(--color-ink)", fontFamily: "var(--font-body)", fontVariantNumeric: "tabular-nums" }}
            >
              {formatDate(nextDeadline.date)}
            </div>
            <div className="flex items-center gap-1.5 mt-1">
              <span className="board-tag" style={{ fontSize: 10 }}>
                {BOARD_DISPLAY_NAMES[nextDeadline.boardKey] ?? nextDeadline.boardKey}
              </span>
              <span
                className="text-[11px] truncate"
                style={{ color: "var(--color-ink-muted)", maxWidth: 120 }}
              >
                {nextDeadline.itemName}
              </span>
            </div>
          </div>
        ) : (
          <div className="snapshot-value" style={{ color: "var(--color-ink-faint)" }}>
            No upcoming deadlines
          </div>
        )}
        <Popover open={activePopover === "deadline"} onClose={closePopover}>
          <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--color-ink-faint)" }}>
            Upcoming Deadlines
          </div>
          {deadlines.length === 0 ? (
            <p className="text-xs" style={{ color: "var(--color-ink-faint)" }}>No upcoming deadlines</p>
          ) : (
            <div className="space-y-2">
              {deadlines.slice(0, 5).map((d, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span
                    className="text-xs font-medium flex-shrink-0"
                    style={{ color: "var(--color-ink)", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", minWidth: 80 }}
                  >
                    {formatDate(d.date)}
                  </span>
                  <div className="min-w-0">
                    <span className="board-tag" style={{ fontSize: 10 }}>
                      {BOARD_DISPLAY_NAMES[d.boardKey] ?? d.boardKey}
                    </span>
                    <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-muted)" }}>
                      {d.itemName}
                    </p>
                  </div>
                </div>
              ))}
              {deadlines.length > 5 && (
                <p className="text-[11px]" style={{ color: "var(--color-ink-faint)" }}>
                  +{deadlines.length - 5} more
                </p>
              )}
            </div>
          )}
        </Popover>
      </div>

      {/* Card 3: Case Type / Relief */}
      <div className={`snapshot-card${activePopover === "relief" ? " popover-open" : ""}`} onClick={() => togglePopover("relief")}>
        <span className="snapshot-label">Case Type / Relief</span>
        <div className="snapshot-value">
          {reliefTypes.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {reliefTypes.map((type) => (
                <span
                  key={type}
                  className="text-xs font-medium px-2 py-0.5 rounded-full"
                  style={{
                    backgroundColor: "var(--color-amber-light)",
                    color: "var(--color-amber)",
                    fontFamily: "var(--font-body)",
                  }}
                >
                  {type}
                </span>
              ))}
            </div>
          ) : (
            <span style={{ color: "var(--color-ink-faint)" }}>No active contracts</span>
          )}
        </div>
        <Popover open={activePopover === "relief"} onClose={closePopover}>
          <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--color-ink-faint)" }}>
            All Contracts
          </div>
          {data.contracts.active.length === 0 && data.contracts.closed.length === 0 ? (
            <p className="text-xs" style={{ color: "var(--color-ink-faint)" }}>No contracts</p>
          ) : (
            <div className="space-y-2">
              {[...data.contracts.active, ...data.contracts.closed].map((c, i) => (
                <div key={i} className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium" style={{ color: "var(--color-ink)" }}>
                      {c.caseType}
                    </p>
                    {c.value != null && (
                      <p className="text-[11px]" style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-mono)" }}>
                        ${Number(c.value).toLocaleString()}
                      </p>
                    )}
                  </div>
                  <StatusBadge status={c.status ?? "Unknown"} />
                </div>
              ))}
            </div>
          )}
        </Popover>
      </div>

      {/* Card 4: Last Action */}
      <div className={`snapshot-card${activePopover === "action" ? " popover-open" : ""}`} onClick={() => togglePopover("action")}>
        <span className="snapshot-label">Last Action</span>
        {lastAction ? (
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span
                className="text-xs font-medium"
                style={{ color: "var(--color-ink)", fontFamily: "var(--font-body)" }}
              >
                {lastAction.authorName}
              </span>
              <span
                className="text-[11px]"
                style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}
              >
                {formatRelativeTime(lastAction.createdAtSource)}
              </span>
            </div>
            <p
              className="text-xs truncate"
              style={{ color: "var(--color-ink-muted)", fontFamily: "var(--font-body)", fontWeight: 300 }}
            >
              {lastAction.textBody.slice(0, 80)}{lastAction.textBody.length > 80 ? "\u2026" : ""}
            </p>
          </div>
        ) : (
          <div className="snapshot-value" style={{ color: "var(--color-ink-faint)" }}>
            No recent activity
          </div>
        )}
        <Popover open={activePopover === "action"} onClose={closePopover}>
          <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--color-ink-faint)" }}>
            Last Action Detail
          </div>
          {lastAction ? (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-medium" style={{ color: "var(--color-ink)" }}>
                  {lastAction.authorName}
                </span>
                <span
                  className="text-[11px]"
                  style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-mono)" }}
                >
                  {formatRelativeTime(lastAction.createdAtSource)}
                </span>
              </div>
              {lastAction.boardKey && (
                <span className="board-tag mb-2 inline-block" style={{ fontSize: 10 }}>
                  {BOARD_DISPLAY_NAMES[lastAction.boardKey] ?? lastAction.boardKey}
                </span>
              )}
              <p
                className="text-xs leading-relaxed"
                style={{ color: "var(--color-ink-muted)", fontFamily: "var(--font-body)", whiteSpace: "pre-wrap" }}
              >
                {lastAction.textBody}
              </p>
            </div>
          ) : (
            <p className="text-xs" style={{ color: "var(--color-ink-faint)" }}>No recent activity</p>
          )}
        </Popover>
      </div>
    </div>
  );
}
