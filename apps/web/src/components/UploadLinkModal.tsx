// =============================================================================
// UploadLinkModal (M30) — a private link for the client to send us documents
// =============================================================================
// Opened from the client header's "Upload link" (P3.0). Make the link (Spanish
// or English page), then Copy it or text it (M28 with the "Upload link"
// template). One link per client: a new one turns the old one off. The link is
// shown only when it is made — the server keeps just its hash — so sending it
// again means making a new one. Files sent through it land in the E-File → CAF
// and show in Documents → "Received from client".
// docs/features/client-uploads.md, API = routes/client-uploads.ts.
// =============================================================================

import { useEffect, useState } from "react";
import {
  createUploadLink, extendUploadLink, fetchUploadLinks, revokeUploadLink, type UploadLinkInfo,
} from "../api";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { SendSmsModal, isSpanishLabel } from "./SendSmsModal";

interface Props {
  profileLocalId: string;
  name: string;
  firstName?: string | null;
  /** The number "Text it" starts on, and the others on file. */
  phone: string | null;
  altPhones?: (string | null | undefined)[];
  /** Monday Language label: picks the page's language. */
  language?: string | null;
  onClose: () => void;
}

const labelStyle = { display: "block", fontSize: 12, fontWeight: 600, color: "var(--color-ink-muted)", marginBottom: 4, fontFamily: "var(--font-body)" } as const;

/** SQLite UTC ("2026-10-21 15:04:05") → "Oct 21" in the viewer's zone. */
export function shortDate(sqliteUtc: string | null): string {
  if (!sqliteUtc) return "";
  const d = new Date(`${sqliteUtc.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? sqliteUtc : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function UploadLinkModal({ profileLocalId, name, firstName, phone, altPhones, language, onClose }: Props) {
  const [info, setInfo] = useState<{ enabled: boolean; links: UploadLinkInfo[] } | null>(null);
  const [lang, setLang] = useState<"es" | "en">(language && !isSpanishLabel(language) ? "en" : "es");
  const [created, setCreated] = useState<{ url: string; expiresAt: string; replaced: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [smsOpen, setSmsOpen] = useState(false);

  const load = () =>
    fetchUploadLinks(profileLocalId).then(setInfo).catch((e: Error) => setError(e.message));
  useEffect(() => {
    fetchUploadLinks(profileLocalId).then(setInfo).catch((e: Error) => setError(e.message));
  }, [profileLocalId]);

  const active = info?.links.find((l) => l.active) ?? null;

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const make = () =>
    run(async () => {
      if (active && !window.confirm("Make a new link? The current one stops working.")) return;
      setCreated(await createUploadLink(profileLocalId, { language: lang }));
      setCopied(false);
    });

  async function copy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.url);
      setCopied(true);
    } catch {
      setError("Couldn't copy — select the link and copy it by hand.");
    }
  }

  if (smsOpen && created) {
    return (
      <SendSmsModal
        context="upload_link"
        templateKey="upload_link"
        vars={{ uploadLink: created.url }}
        phone={phone ?? ""}
        altPhones={altPhones}
        name={name}
        firstName={firstName}
        language={lang === "es" ? "Spanish" : "English"}
        profileLocalId={profileLocalId}
        onClose={() => setSmsOpen(false)}
      />
    );
  }

  const received = active?.uploads.length ?? 0;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent code="M30" className="gap-0 p-0 sm:max-w-[520px]">
        <DialogHeader className="gap-0.5 border-b border-border px-5 py-4 pr-12">
          <DialogTitle style={{ fontFamily: "var(--font-display)" }}>Upload link</DialogTitle>
          <DialogDescription>
            {name} · a private link to send us documents. They go to the E-File → CAF.
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 py-4 space-y-4 text-sm" style={{ fontFamily: "var(--font-body)", color: "var(--color-ink)" }}>
          {!info && !error && <p style={{ color: "var(--color-ink-muted)" }}>Loading…</p>}

          {info && !info.enabled && (
            <p className="text-xs px-3 py-2 rounded" style={{ background: "var(--color-status-red-bg)", color: "var(--color-status-red)" }}>
              Client upload links are turned off on this server.
            </p>
          )}

          {created ? (
            <div className="space-y-3">
              <p>
                ✓ Link made{created.replaced ? " (the old one no longer works)" : ""}. It works until{" "}
                <strong>{shortDate(created.expiresAt)}</strong>.
              </p>
              <div className="flex gap-2">
                <input
                  readOnly value={created.url} aria-label="Upload link"
                  onFocus={(e) => e.target.select()}
                  className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-xs"
                  style={{ border: "1px solid var(--color-border-light)", background: "var(--color-surface)", fontFamily: "var(--font-mono)" }}
                />
                <Button type="button" variant="outline" onClick={copy}>{copied ? "Copied" : "Copy"}</Button>
              </div>
              <p className="text-xs" style={{ color: "var(--color-ink-muted)" }}>
                This is the only time the link is shown. To send it again later, make a new one.
              </p>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={onClose}>Done</Button>
                <Button type="button" onClick={() => setSmsOpen(true)} disabled={!phone} title={phone ? undefined : "No phone number on file"}>
                  Text it to the client
                </Button>
              </div>
            </div>
          ) : (
            info?.enabled && (
              <>
                {active ? (
                  <div className="rounded-md px-3 py-2.5" style={{ background: "var(--color-surface-warm)", border: "1px solid var(--color-border-light)" }}>
                    <p>
                      <strong>Active link</strong> ({active.language === "es" ? "Spanish" : "English"} page) · made {shortDate(active.createdAt)}
                      {active.createdBy ? ` by ${active.createdBy}` : ""} · works until {shortDate(active.expiresAt)}
                    </p>
                    <p className="mt-0.5 text-xs" style={{ color: "var(--color-ink-muted)" }}>
                      {received ? `${received} file${received === 1 ? "" : "s"} received` : "Nothing received yet"}
                      {active.lastUsedAt ? ` · last used ${shortDate(active.lastUsedAt)}` : ""}
                    </p>
                    <div className="mt-2 flex gap-2">
                      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => run(() => extendUploadLink(active.id, 30))}>
                        Extend 30 days
                      </Button>
                      <Button
                        type="button" size="sm" variant="outline" disabled={busy}
                        onClick={() => window.confirm("Turn this link off? The client can't send anything through it after this.") && run(() => revokeUploadLink(active.id))}
                      >
                        Turn off
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p style={{ color: "var(--color-ink-muted)" }}>No active link for this client.</p>
                )}

                <div>
                  <span style={labelStyle}>Page language</span>
                  <div className="inline-flex rounded-md overflow-hidden" style={{ border: "1px solid var(--color-border-light)" }}>
                    {(["es", "en"] as const).map((l) => (
                      <button
                        key={l} type="button" onClick={() => setLang(l)} className="px-3 py-1.5 text-sm"
                        style={{ background: lang === l ? "var(--color-ink)" : "var(--color-surface)", color: lang === l ? "var(--color-surface)" : "var(--color-ink)" }}
                      >
                        {l === "es" ? "Español" : "English"}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1 text-xs" style={{ color: "var(--color-ink-faint)" }}>The client can switch it on the page.</p>
                </div>

                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
                  <Button type="button" onClick={make} disabled={busy}>
                    {busy ? "Working…" : active ? "Make a new link" : "Make link"}
                  </Button>
                </div>
              </>
            )
          )}

          {error && <p role="alert" className="text-xs" style={{ color: "var(--color-status-red)" }}>{error}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
