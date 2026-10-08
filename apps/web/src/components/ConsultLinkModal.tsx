// =============================================================================
// ConsultLinkModal (M24) — connect a consult with no profile to its client
// =============================================================================
// Opened from P17.2 → **Link client** on a row tagged "No profile". Search a
// profile (pre-filled with the client's name from the consult), pick it, and
// the appointment's Profiles column is set in Monday — what reception used to
// do in Monday before they could prep. Only unlinked consults; changing a link
// stays in Monday. See routes/consult-link.ts.
// =============================================================================

import { useEffect, useState } from "react";
import { linkConsultProfile, searchClients, type ReceptionConsult, type SearchResult } from "../api";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";

const fieldStyle = {
  border: "1px solid var(--color-border-light)",
  background: "var(--color-surface)",
  color: "var(--color-ink)",
  fontFamily: "var(--font-body)",
} as const;

/**
 * The client's name out of an appointment item name, to pre-fill the search:
 *  - "[10/7/26] - INITIAL TP MEETING : Jorge H. ROMERO TORO [A…] - TO BE SCHEDULED BY FA"
 *    → after the last ":", up to the first " - " note;
 *  - "8/21/26 - [TP3] - M - Lesbia M. PEREZ-LARIOS" → the longest " - " part;
 *  - Calendly's "Josue CRUZ MARTINEZ [Det Core Civic] [220-…]" → as is.
 * "[…]" tags are dropped. Only a starting point: reception can edit it.
 */
export function clientNameFromConsult(name: string): string {
  const clean = (s: string) => s.replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim();
  const colon = name.lastIndexOf(":");
  const parts = clean(colon >= 0 ? name.slice(colon + 1) : name)
    .split(/\s+-\s+/)
    .map((p) => p.trim())
    .filter((p) => /[A-Za-z]{2}/.test(p));
  if (parts.length === 0) return clean(name);
  if (colon >= 0) return parts[0]!;
  return parts.reduce((a, b) => (b.length > a.length ? b : a));
}

interface Props {
  consult: ReceptionConsult;
  onClose: () => void;
  /** Called once linked (P17 reloads the list). */
  onLinked: () => void;
}

export function ConsultLinkModal({ consult, onClose, onLinked }: Props) {
  const [query, setQuery] = useState(() => clientNameFromConsult(consult.name));
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [picked, setPicked] = useState<SearchResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ name: string; pending: boolean } | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      searchClients(q, ctrl.signal)
        .then((r) => {
          setResults(r.slice(0, 8));
          setSearched(true);
        })
        .catch(() => {});
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query]);

  async function submit() {
    if (!picked) return;
    setSaving(true);
    setError(null);
    try {
      const r = await linkConsultProfile(consult.localId, picked.localId);
      setDone({ name: r.profileName, pending: r.pending });
      onLinked();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not link the client");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent code="M24" className="gap-0 p-0 sm:max-w-[480px]">
        <DialogHeader className="gap-0.5 border-b border-border px-5 py-4 pr-12">
          <DialogTitle style={{ fontFamily: "var(--font-display)" }}>Link client</DialogTitle>
          <DialogDescription className="truncate" title={consult.name}>{consult.name}</DialogDescription>
        </DialogHeader>

        <div className="px-5 py-4" style={{ fontFamily: "var(--font-body)" }}>
          {done ? (
            <div style={{ fontSize: 14, color: "var(--color-ink)" }}>
              <p>
                ✓ Linked to <strong>{done.name}</strong>
                {done.pending ? " — queued, Monday will be updated shortly." : " in Monday."}
              </p>
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
                <Button type="button" onClick={onClose}>Done</Button>
              </div>
            </div>
          ) : (
            <>
              <label htmlFor="m24-client" style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--color-ink-muted)", marginBottom: 4 }}>
                Client profile
              </label>
              <input
                id="m24-client"
                type="search"
                autoFocus
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPicked(null);
                }}
                placeholder="Name, phone, email, A#…"
                className="w-full rounded-md px-2 py-1.5 text-sm"
                style={fieldStyle}
              />
              {results.length > 0 && (
                <ul className="mt-1 rounded-md overflow-hidden" style={{ border: "1px solid var(--color-border-light)" }}>
                  {results.map((r) => {
                    const selected = picked?.localId === r.localId;
                    return (
                      <li key={r.localId}>
                        <button
                          type="button"
                          aria-pressed={selected}
                          className="w-full text-left px-3 py-1.5 text-sm"
                          style={{
                            color: "var(--color-ink)",
                            background: selected ? "var(--color-amber-light)" : "var(--color-card)",
                            cursor: "pointer",
                          }}
                          onClick={() => setPicked(r)}
                        >
                          {selected ? "✓ " : ""}{r.name}
                          {r.phone ? <span style={{ color: "var(--color-ink-faint)" }}> · {r.phone}</span> : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {searched && results.length === 0 && (
                <p style={{ fontSize: 12, color: "var(--color-ink-faint)", marginTop: 6 }}>
                  No matching profile. A new client needs a profile in Monday first.
                </p>
              )}
              <p style={{ fontSize: 11, color: "var(--color-ink-faint)", marginTop: 8 }}>
                Sets the appointment's Profiles column in Monday.
              </p>
              {error && (
                <div role="alert" className="text-sm rounded p-2 mt-3" style={{ color: "var(--urgency-overdue)", background: "var(--urgency-overdue-bg)" }}>
                  {error}
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
                <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
                <Button type="button" onClick={submit} disabled={!picked || saving}>
                  {saving ? "Linking…" : "Link"}
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
