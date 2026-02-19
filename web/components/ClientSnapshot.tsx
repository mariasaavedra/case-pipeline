import { useState, useMemo } from "react";
import type { ClientCaseSummary } from "../api";
import { getStatusColor, DOCUMENT_BOARD_KEYS } from "../config";
import { StatusBadge } from "./StatusBadge";
import { BOARD_DISPLAY_NAMES, APPOINTMENT_BOARD_KEYS } from "../../lib/query/types";

type StatusMode = "worst" | "all" | "primary";

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

  const statuses = useMemo(() => {
    const counts = new Map<string, number>();
    for (const items of Object.values(data.boardItems)) {
      for (const item of items) {
        if (item.status) counts.set(item.status, (counts.get(item.status) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([status, count]) => ({ status, count, color: getStatusColor(status) }))
      .sort((a, b) => (SEVERITY[a.color] ?? 5) - (SEVERITY[b.color] ?? 5));
  }, [data.boardItems]);

  const worstStatus = statuses[0] ?? null;
  const primaryStatus = data.contracts.active[0]?.status ?? null;

  const nextDeadline = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    let earliest: { date: string; boardKey: string; itemName: string } | null = null;

    for (const [boardKey, items] of Object.entries(data.boardItems)) {
      for (const item of items) {
        if (item.nextDate && item.nextDate >= today) {
          if (!earliest || item.nextDate < earliest.date) {
            earliest = { date: item.nextDate, boardKey, itemName: item.name };
          }
        }
      }
    }
    for (const a of data.appointments) {
      if (a.nextDate && a.nextDate >= today) {
        if (!earliest || a.nextDate < earliest.date) {
          earliest = { date: a.nextDate, boardKey: a.boardKey, itemName: a.name };
        }
      }
    }
    return earliest;
  }, [data.boardItems, data.appointments]);

  const reliefTypes = useMemo(
    () => [...new Set(data.contracts.active.map((c) => c.caseType))],
    [data.contracts.active]
  );

  const lastAction = data.updates[0] ?? null;

  const cycleMode = () => {
    const modes: StatusMode[] = ["worst", "all", "primary"];
    const idx = modes.indexOf(statusMode);
    setStatusMode(modes[(idx + 1) % modes.length]!);
  };

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
      <div className="snapshot-card">
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
      </div>

      {/* Card 2: Next Deadline */}
      <div className="snapshot-card">
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
      </div>

      {/* Card 3: Case Type / Relief */}
      <div className="snapshot-card">
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
      </div>

      {/* Card 4: Last Action */}
      <div className="snapshot-card">
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
      </div>
    </div>
  );
}
