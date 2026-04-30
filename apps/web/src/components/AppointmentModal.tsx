import { useEffect, useCallback } from "react";
import type { AppointmentEntry } from "../api";
import { UpdatesTimeline } from "./UpdatesTimeline";
import { BOARD_DISPLAY_NAMES } from "@case-pipeline/query/types";
import { formatANumber } from "@case-pipeline/core";
import { Link } from "./Link";
import { clientPath } from "../router";

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function getStatusStyle(status: string | null): { bg: string; text: string } {
  const s = status?.toLowerCase() ?? "";
  if (s.includes("done") || s.includes("complete"))
    return { bg: "var(--color-status-green-bg)", text: "var(--color-status-green)" };
  if (s.includes("cancel") || s.includes("no show"))
    return { bg: "var(--color-status-red-bg)", text: "var(--color-status-red)" };
  if (s.includes("confirm") || s.includes("scheduled"))
    return { bg: "var(--color-status-blue-bg)", text: "var(--color-status-blue)" };
  return { bg: "var(--color-status-yellow-bg)", text: "var(--color-status-yellow)" };
}

function getPriorityStyle(priority: string | null): { bg: string; text: string } {
  switch (priority?.toLowerCase()) {
    case "high":
    case "urgent":
      return { bg: "var(--color-status-red-bg)", text: "var(--color-status-red)" };
    case "medium":
      return { bg: "var(--color-status-yellow-bg)", text: "var(--color-status-yellow)" };
    case "low":
      return { bg: "var(--color-status-green-bg)", text: "var(--color-status-green)" };
    default:
      return { bg: "var(--color-surface-warm)", text: "var(--color-ink-muted)" };
  }
}

function getInitials(name: string): string {
  const parts = name.replace(/\(.*\)/, "").trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
  return (parts[0]?.[0] ?? "?").toUpperCase();
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col gap-0.5">
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

interface Props {
  entry: AppointmentEntry;
  onClose: () => void;
}

export function AppointmentModal({ entry, onClose }: Props) {
  const { appointment, profile, snapshot, updates, caseSummary } = entry;
  const statusStyle = getStatusStyle(appointment.status);
  const priorityStyle = profile ? getPriorityStyle(profile.priority) : null;

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [handleKeyDown]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(12, 18, 34, 0.55)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="relative w-full max-w-2xl rounded-2xl shadow-2xl flex flex-col animate-in"
        style={{
          backgroundColor: "var(--color-surface)",
          maxHeight: "90vh",
          border: "1px solid var(--color-border)",
        }}
      >
        {/* Amber accent strip */}
        <div className="h-1 rounded-t-2xl flex-shrink-0" style={{ backgroundColor: "var(--color-amber)" }} />

        {/* Header */}
        <div
          className="flex items-start justify-between gap-4 px-6 py-4 flex-shrink-0"
          style={{ borderBottom: "1px solid var(--color-border-light)" }}
        >
          <div className="flex-1 min-w-0">
            {/* Board + status badges */}
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <span className="board-tag">
                {BOARD_DISPLAY_NAMES[appointment.boardKey] ?? appointment.boardKey}
              </span>
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
            </div>

            {/* Appointment name */}
            <h2
              className="text-lg font-semibold leading-snug truncate"
              style={{ fontFamily: "var(--font-display)", color: "var(--color-ink)" }}
            >
              {appointment.name}
            </h2>

            {/* Date */}
            {appointment.nextDate && (
              <p
                className="text-sm mt-0.5"
                style={{ color: "var(--color-ink-muted)", fontFamily: "var(--font-body)" }}
              >
                {formatDate(appointment.nextDate)}
              </p>
            )}
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors"
            style={{
              background: "none",
              border: "1px solid var(--color-border-light)",
              cursor: "pointer",
              color: "var(--color-ink-faint)",
            }}
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">
          {/* Client section */}
          {profile && (
            <div
              className="px-6 py-4"
              style={{ borderBottom: "1px solid var(--color-border-light)" }}
            >
              <div className="flex items-center gap-4">
                {/* Avatar */}
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 text-sm font-semibold"
                  style={{
                    backgroundColor: "var(--color-navy)",
                    color: "#fff",
                    fontFamily: "var(--font-display)",
                  }}
                >
                  {getInitials(profile.name)}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className="text-base font-semibold"
                      style={{ fontFamily: "var(--font-display)", color: "var(--color-ink)" }}
                    >
                      {profile.name}
                    </span>
                    {profile.priority && priorityStyle && (
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

                  {/* Contact + identity fields */}
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
                    {profile.phone && (
                      <span className="text-xs" style={{ color: "var(--color-ink-muted)", fontFamily: "var(--font-body)" }}>
                        {profile.phone}
                      </span>
                    )}
                    {profile.email && (
                      <span className="text-xs" style={{ color: "var(--color-ink-muted)", fontFamily: "var(--font-body)" }}>
                        {profile.email}
                      </span>
                    )}
                    {profile.aNumber && (
                      <span className="text-xs font-medium" style={{ color: "var(--color-amber)", fontFamily: "var(--font-mono)" }}>
                        {formatANumber(profile.aNumber)}
                      </span>
                    )}
                    {profile.dateOfBirth && (
                      <span className="text-xs" style={{ color: "var(--color-ink-muted)", fontFamily: "var(--font-body)" }}>
                        DOB: {profile.dateOfBirth}
                      </span>
                    )}
                    {profile.placeOfBirth && (
                      <span className="text-xs" style={{ color: "var(--color-ink-muted)", fontFamily: "var(--font-body)" }}>
                        {profile.placeOfBirth}
                      </span>
                    )}
                  </div>
                </div>

                <Link
                  href={clientPath(profile.localId)}
                  className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg flex-shrink-0"
                  style={{
                    color: "var(--color-amber)",
                    backgroundColor: "var(--color-amber-light)",
                    border: "none",
                    textDecoration: "none",
                  }}
                >
                  View 360
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M6 3l5 5-5 5" />
                  </svg>
                </Link>
              </div>
            </div>
          )}

          {/* Snapshot stats */}
          <div
            className="px-6 py-3 flex items-center gap-6 flex-wrap"
            style={{
              backgroundColor: "var(--color-surface-warm)",
              borderBottom: "1px solid var(--color-border-light)",
            }}
          >
            <Stat label="Active Cases" value={snapshot.activeCaseCount} />
            <Stat label="Pending Contracts" value={snapshot.pendingContractCount} />
            {snapshot.nextDeadline && (
              <Stat
                label="Next Deadline"
                value={new Date(snapshot.nextDeadline + "T00:00:00").toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              />
            )}
          </div>

          {/* Case summary */}
          {caseSummary && (
            (() => {
              const activeContracts = caseSummary.contracts.active;
              const boardEntries = Object.entries(caseSummary.boardItems).filter(([, items]) => items.length > 0);
              if (activeContracts.length === 0 && boardEntries.length === 0) return null;
              return (
                <div
                  className="px-6 py-4"
                  style={{ borderBottom: "1px solid var(--color-border-light)" }}
                >
                  <h3
                    className="text-[11px] font-semibold uppercase tracking-wider mb-3"
                    style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
                  >
                    Active Matters
                  </h3>
                  <div className="flex flex-wrap gap-4">
                    {activeContracts.length > 0 && (
                      <div className="flex-1 min-w-[180px]">
                        <p
                          className="text-[11px] font-medium mb-1.5"
                          style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
                        >
                          Contracts ({activeContracts.length})
                        </p>
                        {activeContracts.map((c) => (
                          <div key={c.localId} className="flex items-center gap-2 mb-1">
                            <span className="text-xs" style={{ fontFamily: "var(--font-body)", color: "var(--color-ink)" }}>
                              {c.caseType}
                            </span>
                            <span className="board-tag">{c.status}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {boardEntries.map(([boardKey, items]) => (
                      <div key={boardKey} className="flex-1 min-w-[180px]">
                        <p
                          className="text-[11px] font-medium mb-1.5"
                          style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
                        >
                          {BOARD_DISPLAY_NAMES[boardKey] ?? boardKey} ({items.length})
                        </p>
                        {items.slice(0, 4).map((item) => (
                          <div key={item.localId} className="flex items-center gap-2 mb-1">
                            <span className="text-xs" style={{ fontFamily: "var(--font-body)", color: "var(--color-ink)" }}>
                              {item.name}
                            </span>
                            {item.status && <span className="board-tag">{item.status}</span>}
                          </div>
                        ))}
                        {items.length > 4 && (
                          <span className="text-[11px]" style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}>
                            +{items.length - 4} more
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()
          )}

          {/* Notes / updates */}
          <div className="px-6 py-4">
            {updates.length > 0 ? (
              <>
                <h3
                  className="text-[11px] font-semibold uppercase tracking-wider mb-3"
                  style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
                >
                  Notes ({updates.length})
                </h3>
                <UpdatesTimeline updates={updates} />
              </>
            ) : (
              <p
                className="text-sm text-center py-6"
                style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
              >
                No notes for this appointment.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
