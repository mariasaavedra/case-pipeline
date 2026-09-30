// =============================================================================
// JailIntakeDetailModal — one intake, and somewhere to add to it
// =============================================================================
// Everything shown here comes from the row already loaded by the board, so
// opening an intake costs nothing. The intake board carries 95 columns; this
// shows the ones captured at first contact and links to monday for the rest.
//
// The note box posts a monday update AND an E&A activity under the firm's
// "Casenote" type. It is WRITE-ONLY, and the UI says so: client_updates
// requires a profile, an intake has none until it books a consult, and the
// sync skips profile-less items — so there is no local history to show and
// pretending otherwise would be worse than saying it plainly.
//
// Book consult shows on a paid intake ("Needs to be scheduled"). It writes the
// two fields Monday's Create Appt button reads — Consult Date and "Appt with:" —
// and then sends staff to Monday to press the button, because the API cannot
// press it and the button's automations create the appointment AND the
// profile. See docs/decisions.md 2026-09-30.
// =============================================================================

import { useCallback, useEffect, useState } from "react";
import {
  addJailIntakeNote,
  bookJailIntakeConsult,
  fetchBookableBoards,
  fetchJailIntakeNotes,
  type BookableBoard,
  type JailIntake,
  type JailIntakeNote,
} from "../api";
import { MONDAY_JAIL_INTAKES_BOARD_ID, mondayItemUrl } from "../config";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { StatusBadge } from "./StatusBadge";
import { ClientLink } from "./ClientPeek";

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-[140px]">
      <span
        className="text-[10px] font-semibold uppercase tracking-wider"
        style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
      >
        {label}
      </span>
      <span className="text-sm" style={{ color: "var(--color-ink)", fontFamily: "var(--font-body)" }}>
        {value || "—"}
      </span>
    </div>
  );
}

/** The status that offers Book consult: paid, not yet booked. Mirrors the API. */
const BOOKABLE_STATUS = "Needs to be scheduled";

const fieldStyle = {
  border: "1px solid var(--color-border-light)",
  background: "var(--color-surface)",
  color: "var(--color-ink)",
  fontFamily: "var(--font-body)",
} as const;

function FieldLabel({ children }: { children: string }) {
  return (
    <span
      className="block text-[10px] font-semibold uppercase tracking-wider mb-1"
      style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
    >
      {children}
    </span>
  );
}

function BookConsultSection({ intake, onSaved }: { intake: JailIntake; onSaved?: () => void }) {
  const [boards, setBoards] = useState<BookableBoard[] | null>(null);
  const [apptWith, setApptWith] = useState(intake.apptWith ?? "");
  const [date, setDate] = useState(intake.consultDate ?? "");
  const [time, setTime] = useState(intake.consultTime ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ pending: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchBookableBoards()
      .then((b) => !cancelled && setBoards(b))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Could not load attorneys"));
    return () => {
      cancelled = true;
    };
  }, []);

  // "Appt with:" holds the attorney's badge (M, LB, …), so the badge is the value.
  const items = [
    { value: "", label: "Select…" },
    ...(boards ?? []).map((b) => ({ value: b.badge, label: b.label === b.badge ? b.badge : `${b.label} (${b.badge})` })),
  ];
  // Anything already on the intake that isn't an attorney ("Appt requested…") is not a pick.
  const value = items.some((i) => i.value === apptWith) ? apptWith : "";

  const submit = async () => {
    if (!value) { setError("Pick an attorney."); return; }
    if (!date) { setError("Pick a date."); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await bookJailIntakeConsult(intake.localId, { date, time: time || undefined, apptWith: value });
      setSaved({ pending: res.pending });
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save to Monday");
    } finally {
      setSaving(false);
    }
  };

  const mondayUrl = intake.mondayItemId ? mondayItemUrl(MONDAY_JAIL_INTAKES_BOARD_ID, intake.mondayItemId) : null;

  return (
    <div className="px-5 py-4" style={{ borderBottom: "1px solid var(--color-border-light)" }}>
      <h3
        className="text-[11px] font-semibold uppercase tracking-wider mb-2"
        style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
      >
        Book consult
      </h3>

      {saved ? (
        <div className="text-sm" style={{ fontFamily: "var(--font-body)", color: "var(--color-ink)" }}>
          <p style={{ color: "var(--color-status-green)", marginBottom: 6 }}>
            ✓ Consult Date and Appt with set{saved.pending ? " — queued, Monday was unreachable" : " in Monday"}.
          </p>
          <p style={{ marginBottom: 10 }}>
            Last step: open the intake in Monday and press <strong>Create Appt</strong>. Monday creates the appointment
            and the profile; they show here after the next sync.
          </p>
          {mondayUrl && (
            <a href={mondayUrl} target="_blank" rel="noopener noreferrer"
              className="inline-block rounded-md px-3 py-1.5 text-sm font-medium"
              style={{ background: "var(--color-amber-light)", color: "var(--color-amber)", textDecoration: "none" }}>
              Open in Monday to press Create Appt ↗
            </a>
          )}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-3 mb-2">
            <div className="flex-[2] min-w-[180px]">
              <FieldLabel>Attorney (Appt with)</FieldLabel>
              <Select items={items} value={value} onValueChange={(v) => setApptWith(v ?? "")}>
                <SelectTrigger aria-label="Attorney (Appt with)" size="sm" className="w-full border-border-light bg-surface">
                  <SelectValue placeholder={boards === null ? "Loading…" : "Select…"} />
                </SelectTrigger>
                <SelectContent code="D14" className="w-[var(--anchor-width)]">
                  <SelectItem value="">Select…</SelectItem>
                  {items.slice(1).map((i) => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <label className="flex-[1.4] min-w-[140px]">
              <FieldLabel>Consult date</FieldLabel>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-md px-2 py-1.5 text-sm" style={fieldStyle} />
            </label>
            <label className="flex-1 min-w-[110px]">
              <FieldLabel>Time</FieldLabel>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)}
                className="w-full rounded-md px-2 py-1.5 text-sm" style={fieldStyle} />
            </label>
          </div>
          <p className="text-[11px] mb-2" style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}>
            Saves these two fields on the intake. You then press Create Appt in Monday, which makes the appointment and
            the profile.
          </p>
          {error && <p role="alert" style={{ fontSize: 12, color: "var(--color-status-red)", marginBottom: 8 }}>{error}</p>}
          <div className="flex justify-end">
            <Button type="button" onClick={submit} disabled={saving || boards === null}>
              {saving ? "Saving…" : "Save to Monday"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

interface Props {
  intake: JailIntake;
  onClose: () => void;
  /** Called after Book consult saves, so the list can reload. */
  onChanged?: () => void;
}

export function JailIntakeDetailModal({ intake, onClose, onChanged }: Props) {
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posted, setPosted] = useState<{ pending: boolean; descriptionUpdated: boolean; descriptionFull: boolean } | null>(null);
  const [notes, setNotes] = useState<JailIntakeNote[] | null>(null);

  const loadNotes = useCallback(() => {
    fetchJailIntakeNotes(intake.localId)
      .then(setNotes)
      // A history we cannot load is not worth an error banner over the note box
      // that still works — show it as empty and let them write.
      .catch(() => setNotes([]));
  }, [intake.localId]);

  useEffect(loadNotes, [loadNotes]);

  const submit = async () => {
    if (!note.trim()) {
      setError("Write something first.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await addJailIntakeNote(intake.localId, note.trim());
      setPosted(res);
      setNote("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the note");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent code="M9" className="gap-0 p-0 sm:max-w-[560px]">
        <DialogHeader className="gap-0.5 border-b border-border px-5 py-4 pr-12">
          <DialogTitle style={{ fontFamily: "var(--font-display)" }}>{intake.name}</DialogTitle>
          <DialogDescription>
            Intake {formatDate(intake.intakeCreatedOn)}
            {intake.groupTitle ? ` · ${intake.groupTitle}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[70vh] overflow-y-auto">
          <div
            className="px-5 py-3 flex items-center gap-3 flex-wrap"
            style={{
              backgroundColor: "var(--color-surface-warm)",
              borderBottom: "1px solid var(--color-border-light)",
            }}
          >
            {intake.status && <StatusBadge status={intake.status} />}
            {intake.convertedTo ? (
              <>
                <span
                  className="text-[11px] px-2 py-1 rounded-md"
                  style={{
                    backgroundColor: "var(--color-status-green-bg)",
                    color: "var(--color-status-green)",
                    fontFamily: "var(--font-body)",
                  }}
                >
                  Consult {formatDate(intake.convertedTo.consultDate)}
                </span>
                {intake.convertedTo.profileLocalId && (
                  <ClientLink
                    clientId={intake.convertedTo.profileLocalId}
                    className="text-[11px] font-medium px-2 py-1 rounded-md"
                    style={{
                      color: "var(--color-amber)",
                      backgroundColor: "var(--color-amber-light)",
                      textDecoration: "none",
                    }}
                  >
                    {intake.convertedTo.profileName ?? "View 360"}
                  </ClientLink>
                )}
              </>
            ) : (
              <span
                className="text-[11px]"
                style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
              >
                Not yet booked a consult
              </span>
            )}
            {intake.mondayItemId && (
              <a
                href={mondayItemUrl(MONDAY_JAIL_INTAKES_BOARD_ID, intake.mondayItemId)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] font-medium ml-auto"
                style={{ color: "var(--color-amber)", fontFamily: "var(--font-body)" }}
              >
                Open in Monday ↗
              </a>
            )}
          </div>

          <div className="px-5 py-4 flex flex-wrap gap-5" style={{ borderBottom: "1px solid var(--color-border-light)" }}>
            <Row label="Facility" value={intake.jail} />
            <Row label="A-Number" value={intake.alienNumber} />
            <Row label="Language" value={intake.language} />
            <Row label="Point of contact" value={intake.pocName} />
            <Row label="Phone" value={intake.pocPhone} />
            <Row label="Last contact" value={intake.lastInteractionDate ? formatDate(intake.lastInteractionDate) : null} />
          </div>

          {intake.status === BOOKABLE_STATUS && !intake.convertedTo && (
            <BookConsultSection intake={intake} onSaved={onChanged} />
          )}

          <div className="px-5 py-4">
            <h3
              className="text-[11px] font-semibold uppercase tracking-wider mb-2"
              style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
            >
              Notes {notes && notes.length > 0 ? `(${notes.length})` : ""}
            </h3>

            {notes && notes.length > 0 && (
              <div className="mb-3">
                {notes.map((n) => (
                  <div
                    key={n.localId}
                    className="mb-2 pb-2"
                    style={{ borderBottom: "1px solid var(--color-border-light)" }}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="text-[11px] font-semibold"
                        style={{ color: "var(--color-ink)", fontFamily: "var(--font-body)" }}
                      >
                        {n.authorName}
                      </span>
                      <span
                        className="text-[11px]"
                        style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
                      >
                        {new Date(n.createdAtSource).toLocaleString("en-US", {
                          month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <p
                      className="text-sm whitespace-pre-wrap"
                      style={{ color: "var(--color-ink)", fontFamily: "var(--font-body)" }}
                    >
                      {n.textBody}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {posted && (
              <div className="mb-2" style={{ fontFamily: "var(--font-body)" }}>
                <p className="text-sm" style={{ color: "var(--color-status-green)" }}>
                  ✓ Added to Monday as an update and a Casenote
                  {posted.descriptionUpdated ? ", and appended to the Description" : ""}
                  {posted.pending ? " — queued, Monday was unreachable." : "."}
                </p>
                {/* Said plainly: the note IS in monday, it just could not also go
                    in a column that only holds 2,000 characters. */}
                {posted.descriptionFull && (
                  <p className="text-sm" style={{ color: "var(--color-status-yellow)" }}>
                    The Description column is full (2,000 characters), so this was not added there. Trim it in Monday
                    if you want future notes to keep appending.
                  </p>
                )}
              </div>
            )}

            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={4}
              placeholder="What did you learn about this detainee or their case?"
              className="w-full rounded-md px-2 py-1.5 text-sm"
              style={{
                border: "1px solid var(--color-border-light)",
                background: "var(--color-surface)",
                color: "var(--color-ink)",
                fontFamily: "var(--font-body)",
                resize: "vertical",
              }}
            />

            {/* Said plainly rather than shown as an empty history: an intake has
                no profile, so there is nowhere local to keep these. */}
            <p
              className="text-[11px] mt-1"
              style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
            >
              Posts to Monday as an update, a Casenote activity, and an append to the intake&rsquo;s Description.
              It appears in the list above after the next sync.
            </p>

            {error && (
              <p role="alert" style={{ fontSize: 12, color: "var(--color-status-red)", marginTop: 8 }}>
                {error}
              </p>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
              <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
                Close
              </Button>
              <Button type="button" onClick={submit} disabled={saving || !note.trim()}>
                {saving ? "Adding…" : "Add note"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
