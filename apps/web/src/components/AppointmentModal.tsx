import { useState } from "react";
import type { AppointmentEntry, ClientUpdate } from "../api";
import { UpdatesTimeline } from "./UpdatesTimeline";
import { NoteComposer } from "./NoteComposer";
import { DocumentsTab } from "./DocumentsTab";
import { BOARD_DISPLAY_NAMES } from "@case-pipeline/query/types";
import { formatANumber } from "@case-pipeline/core";
import { Link } from "./Link";
import { clientPath } from "../router";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";

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

interface Props {
  entry: AppointmentEntry;
  onClose: () => void;
}

export function AppointmentModal({ entry, onClose }: Props) {
  const { appointment, profile, updates, caseSummary } = entry;
  const statusStyle = getStatusStyle(appointment.status);
  const priorityStyle = profile ? getPriorityStyle(profile.priority) : null;
  const [pendingUpdates, setPendingUpdates] = useState<ClientUpdate[]>([]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 p-0 sm:max-w-5xl">
        {/* Amber accent strip */}
        <div className="h-1 flex-shrink-0 rounded-t-xl" style={{ backgroundColor: "var(--color-amber)" }} />

        {/* Header */}
        <div className="flex-shrink-0 border-b border-border px-6 py-4 pr-12">
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
          <DialogTitle
            className="truncate text-lg font-semibold leading-snug"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {appointment.name}
          </DialogTitle>

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

          {/* Notes + Documents — two columns on desktop, stacked on mobile */}
          <div className="grid grid-cols-1 md:grid-cols-2 md:divide-x" style={{ borderColor: "var(--color-border-light)" }}>
            {/* Notes / updates */}
            <div className="px-6 py-4 space-y-4 min-w-0">
              <h3
                className="text-[11px] font-semibold uppercase tracking-wider"
                style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
              >
                Notes {pendingUpdates.length + updates.length > 0 ? `(${pendingUpdates.length + updates.length})` : ""}
              </h3>

              {profile && (
                <NoteComposer
                  profileLocalId={profile.localId}
                  onPosted={(update) => setPendingUpdates((prev) => [update, ...prev])}
                  compact
                />
              )}

              {pendingUpdates.length + updates.length > 0 ? (
                <UpdatesTimeline updates={[...pendingUpdates, ...updates]} />
              ) : (
                <p
                  className="text-sm text-center py-4"
                  style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
                >
                  No notes yet. Add one above.
                </p>
              )}
            </div>

            {/* SharePoint documents — reuses the client Documents browser */}
            <div className="px-6 py-4 space-y-4 min-w-0">
              <h3
                className="text-[11px] font-semibold uppercase tracking-wider"
                style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
              >
                Documents
              </h3>
              {caseSummary ? (
                <DocumentsTab data={caseSummary} />
              ) : (
                <p
                  className="text-sm text-center py-4"
                  style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
                >
                  No client linked to this appointment.
                </p>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
