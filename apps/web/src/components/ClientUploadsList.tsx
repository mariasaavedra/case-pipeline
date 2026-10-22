// =============================================================================
// "Received from client" — what a client sent through their upload links (P3.6)
// =============================================================================
// Above the SharePoint browser on the client's Documents tab. Each file links
// to its copy in the E-File → CAF once filed; until then it says why it's
// waiting. Hidden when the client never sent anything.
// docs/features/client-uploads.md.
// =============================================================================

import { useEffect, useState } from "react";
import { fetchUploadLinks, type ClientUpload } from "../api";
import { shortDate } from "./UploadLinkModal";

const KIND_LABELS: Record<ClientUpload["kind"], string> = {
  id: "ID / passport",
  notice: "USCIS / court letter",
  evidence: "Evidence",
  other: "Other",
};

/** Where the file stands, in a few words. */
export function uploadStatus(u: Pick<ClientUpload, "filed_at" | "filed_where" | "last_error">): { text: string; tone: "ok" | "wait" | "bad" } {
  if (u.filed_at) return { text: `Filed in ${u.filed_where ?? "E-File"} → CAF`, tone: "ok" };
  if (u.last_error?.startsWith("waiting:")) {
    return { text: /profile not found/.test(u.last_error) ? "Waiting: profile not found" : "Waiting: no E-File on the profile", tone: "bad" };
  }
  if (u.last_error) return { text: `Not filed yet: ${u.last_error}`, tone: "bad" };
  return { text: "Being filed (within ~15 min)", tone: "wait" };
}

const TONE_COLORS = { ok: "var(--color-status-green)", wait: "var(--color-ink-muted)", bad: "var(--color-status-red)" } as const;

export function ClientUploadsList({ profileLocalId }: { profileLocalId: string }) {
  const [uploads, setUploads] = useState<ClientUpload[] | null>(null);

  useEffect(() => {
    fetchUploadLinks(profileLocalId)
      .then((r) => setUploads(r.links.flatMap((l) => l.uploads).sort((a, b) => b.id - a.id)))
      .catch(() => setUploads([]));
  }, [profileLocalId]);

  if (!uploads?.length) return null;

  return (
    <section
      className="rounded-lg"
      style={{ border: "1px solid var(--color-border-light)", background: "var(--color-card)", fontFamily: "var(--font-body)" }}
    >
      <h3 className="px-4 pt-3 text-[11px] font-semibold uppercase tracking-widest" style={{ color: "var(--color-ink-faint)" }}>
        Received from client ({uploads.length})
      </h3>
      <ul className="divide-y" style={{ borderColor: "var(--color-border-light)" }}>
        {uploads.map((u) => {
          const status = uploadStatus(u);
          return (
            <li key={u.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2 text-sm">
              <span className="w-14 shrink-0 text-xs" style={{ color: "var(--color-ink-faint)" }}>{shortDate(u.received_at)}</span>
              <span className="min-w-0 flex-1">
                {u.sharepoint_url ? (
                  <a href={u.sharepoint_url} target="_blank" rel="noreferrer" className="kpi-item-client">{u.stored_name}</a>
                ) : (
                  <span style={{ color: "var(--color-ink)" }}>{u.stored_name}</span>
                )}
                <span className="ml-2 text-xs" style={{ color: "var(--color-ink-muted)" }}>{KIND_LABELS[u.kind] ?? u.kind}</span>
                {u.note && <span className="block text-xs italic" style={{ color: "var(--color-ink-muted)" }}>“{u.note}”</span>}
              </span>
              <span className="text-xs" style={{ color: TONE_COLORS[status.tone] }}>{status.text}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
