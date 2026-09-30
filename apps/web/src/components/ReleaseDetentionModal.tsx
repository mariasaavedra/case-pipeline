// =============================================================================
// ReleaseDetentionModal (M17) — mark a detained client as released
// =============================================================================
// Opened from the "Detained at …" pill on P3.0. Asks for a note (required — the
// facility is about to be cleared, so the note is the record) and an optional
// release date. Saving clears Det. Facility on the client's open court case(s)
// in Monday and logs a Casenote in the profile's Emails & Activities. See the
// API's routes/detention-write.ts.
// =============================================================================

import { useState } from "react";
import { releaseClient } from "../api";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";

interface Props {
  profileLocalId: string;
  clientName: string;
  facility: string;
  onClose: () => void;
  /** Called once the release is saved (or queued), so the pill can go away. */
  onReleased: () => void;
}

/** Today as YYYY-MM-DD in the viewer's timezone — the date input's max. */
function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const labelStyle = { display: "block", fontSize: 12, fontWeight: 600, color: "var(--color-ink-muted)", marginBottom: 4, fontFamily: "var(--font-body)" } as const;
const fieldStyle = { border: "1px solid var(--color-border-light)", background: "var(--color-surface)", color: "var(--color-ink)", fontFamily: "var(--font-body)" } as const;

export function ReleaseDetentionModal({ profileLocalId, clientName, facility, onClose, onReleased }: Props) {
  const [note, setNote] = useState("");
  const [releasedOn, setReleasedOn] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ pending: boolean } | null>(null);

  const submit = async () => {
    if (!note.trim()) { setError("Add a note about the release."); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await releaseClient(profileLocalId, { note: note.trim(), releasedOn: releasedOn || undefined });
      setDone({ pending: res.pending });
      onReleased();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not mark the client as released");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent code="M17" className="gap-0 p-0 sm:max-w-[460px]">
        <DialogHeader className="gap-0.5 border-b border-border px-5 py-4 pr-12">
          <DialogTitle style={{ fontFamily: "var(--font-display)" }}>Released from detention</DialogTitle>
          <DialogDescription>{clientName} · {facility}</DialogDescription>
        </DialogHeader>

        <div className="px-5 py-4">
          {done ? (
            <div style={{ fontFamily: "var(--font-body)", fontSize: 14, color: "var(--color-ink)" }}>
              <p style={{ marginBottom: 8 }}>
                ✓ {done.pending ? "Queued — it will reach Monday shortly." : "Saved in Monday."}
              </p>
              <p style={{ fontSize: 12, color: "var(--color-ink-faint)" }}>
                Det. Facility is cleared on the court case. The note shows in the timeline after the next sync.
              </p>
              <button type="button" onClick={onClose} className="mt-3 rounded-md px-3 py-1.5 text-sm" style={{ background: "var(--color-amber-light)", color: "var(--color-amber)", border: "none", cursor: "pointer" }}>Done</button>
            </div>
          ) : (
            <>
              <label style={{ display: "block", marginBottom: 12 }}>
                <span style={labelStyle}>Release date <span style={{ fontWeight: 400, color: "var(--color-ink-faint)" }}>(optional)</span></span>
                <input type="date" value={releasedOn} max={todayLocal()} onChange={(e) => setReleasedOn(e.target.value)}
                  className="rounded-md px-2 py-1.5 text-sm" style={fieldStyle} />
              </label>

              <label style={{ display: "block", marginBottom: 12 }}>
                <span style={labelStyle}>Note</span>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4} maxLength={5000} autoFocus
                  placeholder="How they were released (bond, parole, order), who confirmed it…"
                  className="w-full rounded-md px-2 py-1.5 text-sm" style={{ ...fieldStyle, resize: "vertical" }} />
                <span style={{ display: "block", fontSize: 11, color: "var(--color-ink-faint)", marginTop: 2, fontFamily: "var(--font-body)" }}>
                  Logged as a Casenote in the profile's Emails &amp; Activities. Det. Facility on the open court case is cleared in Monday.
                </span>
              </label>

              {error && <p role="alert" style={{ fontSize: 12, color: "var(--color-status-red)", marginBottom: 8 }}>{error}</p>}

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
                <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
                <Button type="button" onClick={submit} disabled={saving || !note.trim()}>
                  {saving ? "Saving…" : "Mark released"}
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
