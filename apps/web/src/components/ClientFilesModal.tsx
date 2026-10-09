// =============================================================================
// ClientFilesModal (M26) — the client's e-file / consult folders in a popup
// =============================================================================
// From P14.3's ⋯ menu. The same SharePoint browser as P4.5's "E-file / Consult
// file" tab (DocumentsTab): browse folders in place, a file opens in M12, and
// nothing sends you out to SharePoint unless you ask. The folder links come from
// the client's full summary (profile + board items + appointments), loaded when
// the popup opens.
// =============================================================================

import { useEffect, useState } from "react";
import { getClient, type ClientCaseSummary } from "../api";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { DocumentsTab } from "./DocumentsTab";

interface Props {
  clientLocalId: string;
  clientName: string;
  onClose: () => void;
}

export function ClientFilesModal({ clientLocalId, clientName, onClose }: Props) {
  const [summary, setSummary] = useState<ClientCaseSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getClient(clientLocalId)
      .then((s) => live && setSummary(s))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : "Could not load the client"));
    return () => {
      live = false;
    };
  }, [clientLocalId]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent code="M26" className="flex max-h-[88vh] flex-col gap-0 p-0 sm:max-w-[760px]">
        <DialogHeader className="gap-0.5 border-b border-border px-5 py-4 pr-12">
          <DialogTitle style={{ fontFamily: "var(--font-display)" }}>E-file / Consult file</DialogTitle>
          <DialogDescription>{clientName}</DialogDescription>
        </DialogHeader>
        <div className="min-h-[240px] overflow-y-auto px-5 py-4">
          {error && <p className="text-sm" style={{ color: "var(--urgency-overdue)" }}>{error}</p>}
          {!summary && !error && <p className="text-sm" style={{ color: "var(--color-ink-muted)" }}>Loading folders…</p>}
          {summary && <DocumentsTab data={summary} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
