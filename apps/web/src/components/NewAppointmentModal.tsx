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
// =============================================================================

import { useEffect, useState } from "react";
import { createAppointment, fetchBookableBoards, type BookableBoard } from "../api";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Button } from "./ui/button";

// Only the statuses that mean anything at booking time. The board defines 23;
// the rest describe what happened afterwards (Hire, No Hire, Past Consult…).
const BOOKING_STATUSES = ["Upcoming", "Scheduled", "To be rescheduled"];

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

interface Props {
  profileLocalId: string;
  clientName: string;
  onClose: () => void;
}

export function NewAppointmentModal({ profileLocalId, clientName, onClose }: Props) {
  const [boards, setBoards] = useState<BookableBoard[] | null>(null);
  const [boardKey, setBoardKey] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("Upcoming");
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
  const statusItems = BOOKING_STATUSES.map((s) => ({ value: s, label: s }));
  const noAttorneys = boards !== null && boards.length === 0;

  const submit = async () => {
    if (!boardKey) { setError("Pick an attorney."); return; }
    if (!date) { setError("Pick a date."); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await createAppointment(profileLocalId, {
        boardKey,
        date,
        time: time || undefined,
        description: description.trim() || undefined,
        status,
      });
      setDone({ name: res.name, pending: res.pending });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to book the consult");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="gap-0 p-0 sm:max-w-[460px]">
        <DialogHeader className="gap-0.5 border-b border-border px-5 py-4 pr-12">
          <DialogTitle style={{ fontFamily: "var(--font-display)" }}>Book a consult</DialogTitle>
          <DialogDescription>{clientName}</DialogDescription>
        </DialogHeader>

        <div className="px-5 py-4">
          {done ? (
            <div style={{ fontFamily: "var(--font-body)", fontSize: 14, color: "var(--color-ink)" }}>
              <p style={{ marginBottom: 8 }}>
                ✓ Consult for <strong>{done.name}</strong>{" "}
                {done.pending ? "queued (will sync to Monday shortly)" : "created in Monday"}.
              </p>
              <p style={{ fontSize: 12, color: "var(--color-ink-faint)" }}>It will appear in this tab after the next sync.</p>
              <button type="button" onClick={onClose} className="mt-3 rounded-md px-3 py-1.5 text-sm"
                style={{ background: "var(--color-amber-light)", color: "var(--color-amber)", border: "none", cursor: "pointer" }}>Done</button>
            </div>
          ) : (
            <>
              <label style={{ display: "block", marginBottom: 12 }}>
                <span style={labelStyle}>Attorney</span>
                {noAttorneys ? (
                  <span style={{ fontSize: 12, color: "var(--color-status-red)" }}>
                    No attorney is set up to take consults — an admin can add one in Settings.
                  </span>
                ) : (
                  <Select items={attorneyItems} value={boardKey} onValueChange={(v) => setBoardKey(v ?? "")}>
                    <SelectTrigger size="sm" className="w-full border-border-light bg-surface">
                      <SelectValue placeholder={boards === null ? "Loading…" : "Select…"} />
                    </SelectTrigger>
                    <SelectContent className="w-[var(--anchor-width)]">
                      <SelectItem value="">Select…</SelectItem>
                      {attorneyItems.slice(1).map((i) => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </label>

              <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
                <label style={{ flex: 2 }}>
                  <span style={labelStyle}>Date</span>
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                    className="w-full rounded-md px-2 py-1.5 text-sm" style={fieldStyle} />
                </label>
                <label style={{ flex: 1 }}>
                  <span style={labelStyle}>Time</span>
                  <input type="time" value={time} onChange={(e) => setTime(e.target.value)}
                    className="w-full rounded-md px-2 py-1.5 text-sm" style={fieldStyle} />
                </label>
              </div>

              <label style={{ display: "block", marginBottom: 12 }}>
                <span style={labelStyle}>What to discuss</span>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4}
                  placeholder="Why the client is coming in…"
                  className="w-full rounded-md px-2 py-1.5 text-sm" style={{ ...fieldStyle, resize: "vertical" }} />
              </label>

              <label style={{ display: "block", marginBottom: 12 }}>
                <span style={labelStyle}>Status</span>
                <Select items={statusItems} value={status} onValueChange={(v) => setStatus(v ?? "Upcoming")}>
                  <SelectTrigger size="sm" className="w-full border-border-light bg-surface">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="w-[var(--anchor-width)]">
                    {statusItems.map((i) => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </label>

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
