// =============================================================================
// P23 Client uploads — everything clients sent through their Buzón, in one list
// =============================================================================
// Every client, newest first, the ones nobody has looked at yet by default.
// Each row: when, the client (→ their page), the file (→ its SharePoint copy
// once filed), the checklist document or kind, the client's note, where it
// stands, "→ Mail to review" when it was a notice, and Reviewed / Undo.
// Moving or renaming a file stays in SharePoint. docs/features/buzon.md, Phase 3.
// =============================================================================

import { useCallback, useEffect, useState } from "react";
import { fetchClientUploadQueue, markUploadReviewed, type QueuedUpload } from "../api";
import { clientPath, navigate } from "../router";
import { Button } from "./ui/button";
import { SectionCode } from "./ScreenCode";
import { shortDate } from "./UploadLinkModal";
import { uploadStatus } from "./ClientUploadsList";

const KIND: Record<QueuedUpload["kind"], string> = { id: "ID / passport", notice: "USCIS / court letter", evidence: "Evidence", other: "Other" };
const TONE = { ok: "var(--color-status-green)", wait: "var(--color-ink-muted)", bad: "var(--color-status-red)" } as const;

export function ClientUploadsPage() {
  const [all, setAll] = useState(false);
  const [data, setData] = useState<{ uploads: QueuedUpload[]; notReviewed: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(() => {
    fetchClientUploadQueue(all).then(setData).catch((e: Error) => setError(e.message));
  }, [all]);
  useEffect(load, [load]);

  async function mark(u: QueuedUpload, reviewed: boolean) {
    setBusy(u.id);
    try {
      await markUploadReviewed(u.id, reviewed);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6" style={{ fontFamily: "var(--font-body)", color: "var(--color-ink)" }}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl" style={{ fontFamily: "var(--font-display)" }}>
          Client uploads <SectionCode code="P23" inline />
        </h1>
        <div className="flex items-center gap-2 text-sm">
          {data && <span style={{ color: "var(--color-ink-muted)" }}>{data.notReviewed} not reviewed</span>}
          <Button type="button" size="sm" variant="outline" onClick={() => setAll((a) => !a)}>
            {all ? "Not reviewed only" : "Show all"}
          </Button>
        </div>
      </div>
      <p className="mt-1 text-sm" style={{ color: "var(--color-ink-muted)" }}>
        What clients sent through their Buzón (upload link). Open each one, then mark it <strong>Reviewed</strong>. Letters from USCIS
        or the court also go to Alerts → Mail to review.
      </p>

      {error && <p role="alert" className="mt-3 text-sm" style={{ color: "var(--color-status-red)" }}>{error}</p>}
      {!data ? (
        !error && <p className="mt-4 text-sm" style={{ color: "var(--color-ink-faint)" }}>Loading…</p>
      ) : data.uploads.length === 0 ? (
        <p className="mt-6 text-sm" style={{ color: "var(--color-ink-muted)" }}>{all ? "No client has sent anything yet." : "Nothing waiting. ✓"}</p>
      ) : (
        <ul className="mt-4 divide-y rounded-lg" style={{ border: "1px solid var(--color-border-light)", background: "var(--color-card)" }}>
          {data.uploads.map((u) => {
            const status = uploadStatus({ filed_at: u.filedAt, filed_where: u.filedWhere, last_error: u.lastError });
            return (
              <li key={u.id} className="flex flex-wrap items-start gap-x-4 gap-y-1 px-4 py-3 text-sm">
                <span className="w-14 shrink-0 text-xs" style={{ color: "var(--color-ink-faint)" }}>{shortDate(u.receivedAt)}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    {u.clientLocalId ? (
                      <a href={clientPath(u.clientLocalId, "documents")} className="font-medium"
                        onClick={(e) => { e.preventDefault(); navigate(clientPath(u.clientLocalId!, "documents")); }}>
                        {u.clientName}
                      </a>
                    ) : <span className="font-medium">{u.clientName ?? "Unknown client"}</span>}
                    <span className="text-xs" style={{ color: "var(--color-ink-muted)" }}>{u.document ?? KIND[u.kind]}</span>
                  </div>
                  <div className="truncate">
                    {u.sharepointUrl ? <a href={u.sharepointUrl} target="_blank" rel="noreferrer" className="kpi-item-client">{u.storedName}</a> : u.storedName}
                  </div>
                  {u.note && <div className="text-xs italic" style={{ color: "var(--color-ink-muted)" }}>“{u.note}”</div>}
                  <div className="text-xs" style={{ color: TONE[status.tone] }}>
                    {status.text}
                    {u.combinedInto ? " · joined into one PDF with the other photos" : ""}
                    {u.mailDocumentId ? " · → Mail to review" : ""}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  {u.reviewedAt ? (
                    <div className="text-xs" style={{ color: "var(--color-ink-faint)" }}>
                      ✓ {u.reviewedBy ?? "Reviewed"} · {shortDate(u.reviewedAt)}{" "}
                      <button type="button" className="underline" disabled={busy === u.id} onClick={() => mark(u, false)}>Undo</button>
                    </div>
                  ) : (
                    <Button type="button" size="sm" variant="outline" disabled={busy === u.id} onClick={() => mark(u, true)}>Reviewed</Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
