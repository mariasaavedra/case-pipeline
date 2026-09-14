// =============================================================================
// ClientCaseModal — the linked client's case, stacked over the call popup
// =============================================================================
// The Log Call popup used to link out to the 360 view with target="_blank".
// Two things were wrong with that. MSAL caches its tokens in sessionStorage
// (`auth/msal-config.ts`), which is per-tab, so the new tab opened with an
// empty cache and asked whoever answered the phone to sign in again — mid
// call. And leaving the popup is exactly what the inline notes preview exists
// to avoid: the half-typed call goes with it.
//
// So the fuller picture opens here instead, over the call popup, which stays
// mounted underneath with every field intact: the case facts, the whole notes
// timeline, and the client's SharePoint folders under a Documents tab — the
// three things the 360 view actually gets opened for mid-call. Read-only
// (beyond what DocumentsTab itself allows): this is context for the person on
// the phone, not a second place to edit a case.
//
// One request (GET /api/clients/:id) carries everything below — the profile,
// contracts, board items and the newest 50 timeline entries — so the facts
// strip costs nothing beyond the notes the reader came for.
// =============================================================================

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { getClient } from "../api";
import type { ClientCaseSummary } from "../api";
import { BOARD_DISPLAY_NAMES } from "@case-pipeline/query/types";
import { UpdatesTimeline } from "./UpdatesTimeline";
import { DocumentsTab } from "./DocumentsTab";
import { StatusBadge } from "./StatusBadge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";

interface Props {
  profileLocalId: string;
  profileName: string;
  onClose: () => void;
}

interface UpcomingDate {
  date: string;
  label: string;
}

type Panel = "notes" | "documents";

/** `YYYY-MM-DD` at LOCAL midnight — `new Date("2026-09-20")` is UTC midnight,
 * which reads as the 19th anywhere west of Greenwich. Same convention as
 * ClientSnapshot and the timeline. */
function formatDay(ymd: string): string {
  return new Date(`${ymd}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** The soonest date still ahead of us across every board item and appointment —
 * "what is this client waiting on" in one line. */
function nextUpcoming(data: ClientCaseSummary): UpcomingDate | null {
  const today = new Date().toISOString().slice(0, 10);
  let best: UpcomingDate | null = null;

  const consider = (nextDate: string | null, name: string, boardKey: string) => {
    if (!nextDate || nextDate < today) return;
    if (best && best.date <= nextDate) return;
    const board = BOARD_DISPLAY_NAMES[boardKey] ?? boardKey;
    best = { date: nextDate, label: `${board} — ${name}` };
  };

  for (const items of Object.values(data.boardItems)) {
    for (const item of items) consider(item.nextDate, item.name, item.boardKey);
  }
  for (const appt of data.appointments) consider(appt.nextDate, appt.name, appt.boardKey);

  return best;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 11, color: "var(--color-ink-faint)", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, color: "var(--color-ink)", overflowWrap: "anywhere" }}>{children}</div>
    </div>
  );
}

export function ClientCaseModal({ profileLocalId, profileName, onClose }: Props) {
  const [data, setData] = useState<ClientCaseSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>("notes");

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    setPanel("notes");
    getClient(profileLocalId)
      .then((summary) => {
        if (!cancelled) setData(summary);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load this client's case");
      });
    return () => {
      cancelled = true;
    };
  }, [profileLocalId]);

  const upcoming = data ? nextUpcoming(data) : null;
  const activeContracts = data?.contracts.active ?? [];
  const openItems = data
    ? Object.values(data.boardItems).reduce((sum, items) => sum + items.length, 0)
    : 0;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-3xl">
        <DialogHeader className="flex-shrink-0 border-b border-border px-6 py-4 pr-12">
          <DialogTitle className="text-lg" style={{ fontFamily: "var(--font-display)" }}>
            {data?.profile.name ?? profileName}
          </DialogTitle>
          <DialogDescription>
            Notes and documents — the call you are logging stays open behind this
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <div className="px-6 py-6">
            <p role="alert" style={{ fontSize: 13, color: "var(--color-status-red)", fontFamily: "var(--font-body)" }}>
              {error}
            </p>
          </div>
        ) : (
          <>
            {data && (
              <div
                className="flex-shrink-0 border-b border-border px-6 py-3"
                style={{
                  fontFamily: "var(--font-body)",
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                  gap: 12,
                  background: "var(--color-surface-warm)",
                }}
              >
                <Fact label="Phone">
                  {data.profile.phone ?? <span style={{ color: "var(--color-ink-faint)" }}>—</span>}
                </Fact>
                <Fact label="Email">
                  {data.profile.email ?? <span style={{ color: "var(--color-ink-faint)" }}>—</span>}
                </Fact>
                <Fact label={activeContracts.length === 1 ? "Active case" : "Active cases"}>
                  {activeContracts.length === 0 ? (
                    <span style={{ color: "var(--color-ink-faint)" }}>None open</span>
                  ) : (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {activeContracts.map((c) => (
                        <span key={c.localId} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                          {c.caseType ?? "Contract"}
                          <StatusBadge status={c.linkedCase?.status ?? c.status} />
                        </span>
                      ))}
                    </div>
                  )}
                </Fact>
                <Fact label="Next date">
                  {upcoming ? (
                    <>
                      <strong>{formatDay(upcoming.date)}</strong>
                      <div style={{ fontSize: 11, color: "var(--color-ink-faint)" }}>{upcoming.label}</div>
                    </>
                  ) : (
                    <span style={{ color: "var(--color-ink-faint)" }}>Nothing scheduled</span>
                  )}
                </Fact>
                <Fact label="Open board items">{openItems}</Fact>
              </div>
            )}

            {/* The same two things the 360 view is opened for mid-call: what
                was said, and what is on file. Documents is the 360 view's own
                browser (DocumentsTab), so folders, uploads and previews behave
                identically here — it just never takes the reader off the call.
                Its Graph consent uses a popup, falling back to a full-page
                redirect only where the browser blocks popups; that fallback is
                the one path that would still cost the half-typed call. */}
            <nav
              className="tab-bar flex-shrink-0"
              role="tablist"
              aria-label="Client case sections"
              style={{ borderRadius: 0, paddingInline: 16 }}
            >
              <button
                role="tab"
                id="case-tab-notes"
                aria-selected={panel === "notes"}
                aria-controls="case-panel-notes"
                className="tab-button"
                style={{ padding: "8px 14px", fontSize: 13 }}
                onClick={() => setPanel("notes")}
              >
                Notes
              </button>
              <button
                role="tab"
                id="case-tab-documents"
                aria-selected={panel === "documents"}
                aria-controls="case-panel-documents"
                className="tab-button"
                style={{ padding: "8px 14px", fontSize: 13 }}
                onClick={() => setPanel("documents")}
              >
                Documents
              </button>
            </nav>

            <div className="flex-1 overflow-y-auto px-6 py-4">
              {panel === "notes" ? (
                <div role="tabpanel" id="case-panel-notes" aria-labelledby="case-tab-notes">
                  <UpdatesTimeline updates={data?.updates ?? []} loading={data === null} />
                </div>
              ) : (
                <div role="tabpanel" id="case-panel-documents" aria-labelledby="case-tab-documents">
                  {data ? (
                    <DocumentsTab data={data} />
                  ) : (
                    <p style={{ fontSize: 13, color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}>
                      Loading…
                    </p>
                  )}
                </div>
              )}
            </div>
          </>
        )}

        <div className="flex-shrink-0 border-t border-border px-6 py-3" style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button type="button" variant="outline" onClick={onClose}>
            Back to the call
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
