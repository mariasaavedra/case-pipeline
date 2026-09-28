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
// =============================================================================

import { useState } from "react";
import { addJailIntakeNote, type JailIntake } from "../api";
import { MONDAY_JAIL_INTAKES_BOARD_ID, mondayItemUrl } from "../config";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { StatusBadge } from "./StatusBadge";
import { Link } from "./Link";
import { clientPath } from "../router";

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

interface Props {
  intake: JailIntake;
  onClose: () => void;
}

export function JailIntakeDetailModal({ intake, onClose }: Props) {
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posted, setPosted] = useState<{ pending: boolean } | null>(null);

  const submit = async () => {
    if (!note.trim()) {
      setError("Write something first.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await addJailIntakeNote(intake.localId, note.trim());
      setPosted({ pending: res.pending });
      setNote("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the note");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="gap-0 p-0 sm:max-w-[560px]">
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
                  <Link
                    href={clientPath(intake.convertedTo.profileLocalId)}
                    className="text-[11px] font-medium px-2 py-1 rounded-md"
                    style={{
                      color: "var(--color-amber)",
                      backgroundColor: "var(--color-amber-light)",
                      textDecoration: "none",
                    }}
                  >
                    {intake.convertedTo.profileName ?? "View 360"}
                  </Link>
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

          <div className="px-5 py-4">
            <h3
              className="text-[11px] font-semibold uppercase tracking-wider mb-2"
              style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
            >
              Add details
            </h3>

            {posted && (
              <p
                className="text-sm mb-2"
                style={{ color: "var(--color-status-green)", fontFamily: "var(--font-body)" }}
              >
                ✓ Added to Monday as an update and a Casenote
                {posted.pending ? " — queued, Monday was unreachable." : "."}
              </p>
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
              Posts to Monday as an update and a Casenote activity. Intake notes live on the Monday item, not here.
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
