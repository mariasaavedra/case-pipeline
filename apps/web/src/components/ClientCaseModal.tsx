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
// timeline, the client's SharePoint folders, and their Fee Ks — what the 360
// view actually gets opened for mid-call. The tabs mount the 360 view's own
// components (DocumentsTab, ContractsTab), so a folder, a file preview or a
// new contract behaves identically to doing it there; it simply never takes
// the reader off the call.
//
// One request (GET /api/clients/:id) carries everything below — the profile,
// contracts, board items and the newest 50 timeline entries — so the header
// costs nothing beyond the notes the reader came for.
// =============================================================================

import { useEffect, useState } from "react";
import { getClient } from "../api";
import type { ClientCaseSummary } from "../api";
import { UpdatesTimeline } from "./UpdatesTimeline";
import { DocumentsTab } from "./DocumentsTab";
import { ContractsTab } from "./ContractsTab";
import { Link } from "./Link";
import { clientPath } from "../router";
import { ClientHeaderSticky } from "./ClientHeaderSticky";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";

interface Props {
  profileLocalId: string;
  profileName: string;
  onClose: () => void;
  /**
   * Offer a way through to the full 360 view.
   *
   * False where leaving costs something: inside the log-call popup the case
   * sits on top of a half-typed call, and an SPA navigation would take the
   * whole page with it. True from the Call Log list, where the reader is only
   * looking at rows and going to the full view is a fair thing to want.
   */
  allowOpenFullView?: boolean;
}

type Panel = "notes" | "documents" | "contracts";

export function ClientCaseModal({
  profileLocalId,
  profileName,
  onClose,
  allowOpenFullView = false,
}: Props) {
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

  const contractCount = data ? data.contracts.active.length + data.contracts.closed.length : 0;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent code="M3" className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-3xl">
        {/* The 360 view's own header — name, contact and ID details, the Monday.com
            link and the watchlist star — so the caller's facts read the same here
            as on the full page. Until the profile loads, a plain title stands in. */}
        {data ? (
          <ClientHeaderSticky profile={data.profile} variant="popup" />
        ) : (
          <DialogHeader className="flex-shrink-0 border-b border-border px-6 py-4 pr-12">
            <DialogTitle className="text-lg" style={{ fontFamily: "var(--font-display)" }}>
              {profileName}
            </DialogTitle>
          </DialogHeader>
        )}
        <DialogDescription className="sr-only">
          {allowOpenFullView
            ? "Notes, documents and contracts for this client"
            : "Notes, documents and contracts — the call you are logging stays open behind this"}
        </DialogDescription>

        {error ? (
          <div className="px-6 py-6">
            <p role="alert" style={{ fontSize: 13, color: "var(--color-status-red)", fontFamily: "var(--font-body)" }}>
              {error}
            </p>
          </div>
        ) : (
          <>
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
              <button
                role="tab"
                id="case-tab-contracts"
                aria-selected={panel === "contracts"}
                aria-controls="case-panel-contracts"
                className="tab-button"
                style={{ padding: "8px 14px", fontSize: 13 }}
                onClick={() => setPanel("contracts")}
              >
                Contracts
                {contractCount > 0 && (
                  <span style={{ marginLeft: 5, fontSize: 11, color: "var(--color-ink-faint)" }}>
                    {contractCount}
                  </span>
                )}
              </button>
            </nav>

            <div className="flex-1 overflow-y-auto px-6 py-4">
              {panel === "notes" ? (
                <div role="tabpanel" id="case-panel-notes" aria-labelledby="case-tab-notes">
                  <UpdatesTimeline updates={data?.updates ?? []} loading={data === null} />
                </div>
              ) : panel === "documents" ? (
                <div role="tabpanel" id="case-panel-documents" aria-labelledby="case-tab-documents">
                  {data ? (
                    <DocumentsTab data={data} />
                  ) : (
                    <p style={{ fontSize: 13, color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}>
                      Loading…
                    </p>
                  )}
                </div>
              ) : (
                <div role="tabpanel" id="case-panel-contracts" aria-labelledby="case-tab-contracts">
                  {data ? (
                    // The Fee Ks tab itself, "+ New contract" button included —
                    // "has she paid?" and "start her contract" are the same
                    // phone call, and sending someone elsewhere to do the
                    // second one is what this popup exists to stop.
                    <ContractsTab
                      contracts={data.contracts}
                      profileLocalId={data.profile.localId}
                      clientName={data.profile.name}
                    />
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

        <div
          className="flex-shrink-0 border-t border-border px-6 py-3"
          style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}
        >
          {allowOpenFullView && data ? (
            <Link href={clientPath(data.profile.localId)} style={{ fontSize: 12 }}>
              Open full 360 view →
            </Link>
          ) : (
            <span />
          )}
          <Button type="button" variant="outline" onClick={onClose}>
            {allowOpenFullView ? "Close" : "Back to the call"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
