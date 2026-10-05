// =============================================================================
// ConsultScheduleModal (M20) — change a consult's date, time or attorney
// =============================================================================
// Opened from P17.2 → **Edit**. Date and time are written to the appointment's
// Consult Date in Monday; a different attorney MOVES the appointment to that
// attorney's board (it keeps its notes and history). Calendly is not touched,
// so a Calendly booking gets a reminder to change it there too.
// See routes/consult-schedule.ts.
// =============================================================================

import { useEffect, useState } from "react";
import { fetchReceptionAttorneys, rescheduleConsult, type ReceptionAttorney, type ReceptionConsult } from "../api";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { TIME_SLOTS } from "./NewAppointmentModal";

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

const hintStyle = {
  display: "block",
  fontSize: 11,
  color: "var(--color-ink-faint)",
  marginTop: 6,
  fontFamily: "var(--font-body)",
} as const;

function timeLabel(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const hour = h ?? 0;
  return `${hour % 12 === 0 ? 12 : hour % 12}:${String(m ?? 0).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}

interface Props {
  consult: ReceptionConsult;
  onClose: () => void;
  /** After a successful change, so P17 reloads the list. */
  onSaved: () => void;
}

export function ConsultScheduleModal({ consult, onClose, onSaved }: Props) {
  const [attorneys, setAttorneys] = useState<ReceptionAttorney[] | null>(null);
  const [date, setDate] = useState(consult.date ?? "");
  const [time, setTime] = useState(consult.time ?? "");
  const [boardKey, setBoardKey] = useState(consult.boardKey);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ moved: boolean; pending: boolean; attorney: string | null } | null>(null);

  useEffect(() => {
    fetchReceptionAttorneys()
      .then(setAttorneys)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Couldn't load the attorneys"));
  }, []);

  // A time that isn't on the half-hour grid (Calendly's 5:10 PM) stays pickable.
  const slots = consult.time && !TIME_SLOTS.some((t) => t.value === consult.time)
    ? [...TIME_SLOTS, { value: consult.time, label: timeLabel(consult.time) }].sort((a, b) => a.value.localeCompare(b.value))
    : TIME_SLOTS;

  const moving = boardKey !== consult.boardKey;
  const changed = moving || date !== (consult.date ?? "") || time !== (consult.time ?? "");
  const nameOf = (a: ReceptionAttorney) => a.attorney ?? `Board ${a.badge}`;

  const submit = async () => {
    if (!date) { setError("Pick a date."); return; }
    setSaving(true);
    setError(null);
    try {
      const r = await rescheduleConsult(consult.localId, { date, time, boardKey });
      setDone({ moved: r.moved, pending: r.pending, attorney: r.attorney });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't change the consult");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent code="M20" className="gap-0 p-0 sm:max-w-[440px]">
        <DialogHeader className="gap-0.5 border-b border-border px-5 py-4 pr-12">
          <DialogTitle style={{ fontFamily: "var(--font-display)" }}>Change consult</DialogTitle>
          <DialogDescription>{consult.profile?.name ?? consult.name}</DialogDescription>
        </DialogHeader>

        <div className="px-5 py-4">
          {done ? (
            <div style={{ fontFamily: "var(--font-body)", fontSize: 14, color: "var(--color-ink)" }}>
              <p style={{ marginBottom: 8 }}>
                ✓ {done.pending ? "Saved — the change is queued and will reach Monday shortly." : "Changed in Monday."}
              </p>
              {done.moved && (
                <p style={{ fontSize: 13, color: "var(--color-ink-muted)", marginBottom: 8 }}>
                  Moved to {done.attorney ?? "the new attorney"}'s board, with its notes and history.
                </p>
              )}
              {consult.fromCalendly && (
                <p style={{ fontSize: 13, color: "var(--urgency-soon)", marginBottom: 8 }}>
                  Booked through Calendly — change it in Calendly too, or the client's invite keeps the old slot.
                </p>
              )}
              <Button type="button" onClick={onClose}>Done</Button>
            </div>
          ) : (
            <>
              <label style={{ display: "block", marginBottom: 12 }}>
                <span style={labelStyle}>Attorney</span>
                <select value={boardKey} onChange={(e) => setBoardKey(e.target.value)} aria-label="Attorney" disabled={!attorneys}
                  className="w-full rounded-md px-2 py-1.5 text-sm" style={fieldStyle}>
                  {!attorneys && <option value={boardKey}>{consult.attorney ?? consult.board}</option>}
                  {attorneys?.map((a) => (
                    <option key={a.boardKey} value={a.boardKey}>{nameOf(a)} ({a.badge})</option>
                  ))}
                </select>
                {moving && <span style={hintStyle}>The appointment moves to this attorney's board in Monday, with its notes.</span>}
              </label>

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
                    {slots.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </label>
              </div>

              {consult.fromCalendly && changed && (
                <p style={{ ...hintStyle, marginTop: 0, marginBottom: 12, color: "var(--urgency-soon)" }}>
                  Booked through Calendly — this changes Monday only, not the Calendly event.
                </p>
              )}

              {error && <p role="alert" style={{ fontSize: 12, color: "var(--color-status-red)", marginBottom: 8 }}>{error}</p>}

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
                <Button type="button" onClick={submit} disabled={saving || !changed || !date}>
                  {saving ? "Saving…" : moving ? "Move & save" : "Save"}
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
