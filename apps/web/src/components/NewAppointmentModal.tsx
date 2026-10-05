// =============================================================================
// NewAppointmentModal — book a consult for a client
// =============================================================================
// Unlike a Fee K, appointments have no single board: each attorney has their
// own, so picking the attorney picks the BOARD. The list comes from
// /api/settings/bookable-boards (data/attorney-boards.json filtered by
// acceptingConsults), which is what makes onboarding an attorney a settings
// change rather than a release.
//
// The client's phone, email, address, A-number, DOB and country of birth are
// filled server-side from the profile. Booking here is the one moment those are
// known for free, and they otherwise get typed by hand or left to Calendly.
//
// Opened without a client (P17 Receptionists → + Book Appt), it starts with a
// client search, like M11 on P14. Times are 30-minute slots. "Needs to pay?"
// is shown disabled until consult payments are designed.
// =============================================================================

import { useEffect, useState } from "react";
import { createAppointment, fetchBookableBoards, searchClients, type BookableBoard, type SearchResult } from "../api";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Button } from "./ui/button";

const labelStyle = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  color: "var(--color-ink-muted)",
  marginBottom: 4,
  fontFamily: "var(--font-body)",
} as const;

const fieldStyle = {
  border: "1px solid var(--color-border-light)",
  background: "var(--color-surface)",
  color: "var(--color-ink)",
  fontFamily: "var(--font-body)",
} as const;

/** Bookable times: every 30 minutes, 8:00 AM to 6:00 PM. */
export const TIME_SLOTS: Array<{ value: string; label: string }> = Array.from({ length: 21 }, (_, i) => {
  const minutes = 8 * 60 + i * 30;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const value = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  const label = `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  return { value, label };
});

interface Props {
  /** Omit both to let the user pick the client first (P17). */
  profileLocalId?: string;
  clientName?: string;
  onClose: () => void;
  /** Called once a consult is booked (P17 refreshes its list). */
  onBooked?: () => void;
}

export function NewAppointmentModal({ profileLocalId, clientName, onClose, onBooked }: Props) {
  const clientFixed = profileLocalId != null;
  const [client, setClient] = useState<{ localId: string; name: string } | null>(
    profileLocalId != null ? { localId: profileLocalId, name: clientName ?? "" } : null,
  );
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      searchClients(q, ctrl.signal)
        .then((r) => setResults(r.slice(0, 8)))
        .catch(() => {});
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query]);

  const [boards, setBoards] = useState<BookableBoard[] | null>(null);
  const [boardKey, setBoardKey] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ name: string; pending: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchBookableBoards()
      .then((b) => {
        if (cancelled) return;
        setBoards(b);
        // One attorney taking consults is a real possibility — don't make them pick.
        const only = b.length === 1 ? b[0] : undefined;
        if (only) setBoardKey(only.boardKey);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load attorneys");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // See KpiDetailModal: `items` is what lets the closed trigger show a label.
  const attorneyItems = [
    { value: "", label: "Select…" },
    ...(boards ?? []).map((b) => ({ value: b.boardKey, label: b.label })),
  ];
  const noAttorneys = boards !== null && boards.length === 0;
  // Central time, matching the server's rule — a staffer working late elsewhere
  // should still see the same answer the booking will get.
  const todayCentral = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const isToday = date === todayCentral;

  const submit = async () => {
    if (!client) { setError("Pick a client."); return; }
    if (!boardKey) { setError("Pick an attorney."); return; }
    if (!date) { setError("Pick a date."); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await createAppointment(client.localId, {
        boardKey,
        date,
        time: time || undefined,
        description: description.trim() || undefined,
      });
      setDone({ name: res.name, pending: res.pending });
      onBooked?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to book the consult");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent code="M10" className="gap-0 p-0 sm:max-w-[460px]">
        <DialogHeader className="gap-0.5 border-b border-border px-5 py-4 pr-12">
          <DialogTitle style={{ fontFamily: "var(--font-display)" }}>Book a consult</DialogTitle>
          <DialogDescription>{client ? client.name : "Pick a client"}</DialogDescription>
        </DialogHeader>

        <div className="px-5 py-4">
          {done ? (
            <div style={{ fontFamily: "var(--font-body)", fontSize: 14, color: "var(--color-ink)" }}>
              <p style={{ marginBottom: 8 }}>
                ✓ Consult for <strong>{done.name}</strong>{" "}
                {done.pending ? "queued (will sync to Monday shortly)" : "created in Monday"}.
              </p>
              <p style={{ fontSize: 12, color: "var(--color-ink-faint)" }}>
                It will appear {clientFixed ? "in this tab" : "in the list"} after the next sync.
              </p>
              <button type="button" onClick={onClose} className="mt-3 rounded-md px-3 py-1.5 text-sm"
                style={{ background: "var(--color-amber-light)", color: "var(--color-amber)", border: "none", cursor: "pointer" }}>Done</button>
            </div>
          ) : !client ? (
            <div style={{ display: "block", marginBottom: 4 }}>
              <label style={labelStyle} htmlFor="m10-client">Client</label>
              <input id="m10-client" type="search" autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder="Name, phone, email…"
                className="w-full rounded-md px-2 py-1.5 text-sm" style={fieldStyle} />
              {results.length > 0 && (
                <ul className="mt-1 rounded-md overflow-hidden" style={{ border: "1px solid var(--color-border-light)" }}>
                  {results.map((r) => (
                    <li key={r.localId}>
                      <button type="button" className="w-full text-left px-3 py-1.5 text-sm"
                        style={{ color: "var(--color-ink)", background: "var(--color-card)", cursor: "pointer", fontFamily: "var(--font-body)" }}
                        onClick={() => { setClient({ localId: r.localId, name: r.name }); setQuery(""); setResults([]); setError(null); }}>
                        {r.name}
                        {r.phone ? <span style={{ color: "var(--color-ink-faint)" }}> · {r.phone}</span> : null}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {query.trim().length >= 2 && results.length === 0 && (
                <p style={{ fontSize: 12, color: "var(--color-ink-faint)", marginTop: 6, fontFamily: "var(--font-body)" }}>
                  No matching clients. New clients need a profile in Monday first.
                </p>
              )}
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
                <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              </div>
            </div>
          ) : (
            <>
              {!clientFixed && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, fontSize: 13, fontFamily: "var(--font-body)", color: "var(--color-ink)" }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-ink-muted)" }}>Client</span>
                  <strong>{client.name}</strong>
                  <button type="button" onClick={() => setClient(null)} style={{ fontSize: 12, color: "var(--color-amber)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>Change</button>
                </div>
              )}
              <div style={{ display: "block", marginBottom: 12 }}>
                <span style={labelStyle}>Attorney</span>
                {noAttorneys ? (
                  <span style={{ fontSize: 12, color: "var(--color-status-red)" }}>
                    No attorney is set up to take consults — an admin can add one in Settings.
                  </span>
                ) : (
                  <Select items={attorneyItems} value={boardKey} onValueChange={(v) => setBoardKey(v ?? "")}>
                    <SelectTrigger aria-label="Attorney" size="sm" className="w-full border-border-light bg-surface">
                      <SelectValue placeholder={boards === null ? "Loading…" : "Select…"} />
                    </SelectTrigger>
                    <SelectContent code="D14" className="w-[var(--anchor-width)]">
                      <SelectItem value="">Select…</SelectItem>
                      {attorneyItems.slice(1).map((i) => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
                <label style={{ flex: 2 }}>
                  <span style={labelStyle}>Date</span>
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                    className="w-full rounded-md px-2 py-1.5 text-sm" style={fieldStyle} />
                </label>
                <label style={{ flex: 1 }}>
                  <span style={labelStyle}>Time</span>
                  <select value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time"
                    className="w-full rounded-md px-2 py-1.5 text-sm" style={fieldStyle}>
                    <option value="">No time</option>
                    {TIME_SLOTS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </label>
              </div>

              <label style={{ display: "block", marginBottom: 12 }}>
                <span style={labelStyle}>What to discuss</span>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4}
                  placeholder="Why the client is coming in…"
                  className="w-full rounded-md px-2 py-1.5 text-sm" style={{ ...fieldStyle, resize: "vertical" }} />
              </label>

              {/* Consult payment is a later conversation — shown so it is expected, not usable yet. */}
              <label
                title="Under construction"
                style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, fontSize: 13, fontFamily: "var(--font-body)", color: "var(--color-ink-faint)", cursor: "not-allowed" }}
              >
                <input type="checkbox" disabled aria-disabled="true" />
                <span style={{ textDecoration: "line-through" }}>Needs to pay?</span>
                <span style={{ fontSize: 11, fontStyle: "italic" }}>under construction</span>
              </label>

              {/* Status and group are derived from the date, so say which one it
                  will get rather than leaving the reader to guess. */}
              {date && (
                <p style={{ fontSize: 12, color: "var(--color-ink-faint)", marginBottom: 12, fontFamily: "var(--font-body)" }}>
                  {isToday ? "Filed under Today's consults." : "Filed under Upcoming."}
                </p>
              )}


              {error && <p role="alert" style={{ fontSize: 12, color: "var(--color-status-red)", marginBottom: 8 }}>{error}</p>}

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
                <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
                <Button type="button" onClick={submit} disabled={saving || boards === null || noAttorneys}>
                  {saving ? "Booking…" : "Book consult"}
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
