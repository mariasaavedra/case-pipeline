// =============================================================================
// CallNotesModal — view/add notes on a call
// =============================================================================
// A call's note has always just been a comment on the Monday.com item — this
// reads that same thread live (GET /api/call-log/:localId/notes) instead of
// from any local mirror, so it works for unlinked calls too (sync never pulls
// their comment thread) and for notes that predate this feature. Adding a
// note posts a threaded reply into the same conversation.
// =============================================================================

import { useState, useEffect, useCallback } from "react";
import { fetchCallLogNotes, addCallLogNote, stripMentionMarkers } from "../api";
import type { NoteThreadEntry, MentionedUser } from "../api";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { MentionTextarea } from "./MentionTextarea";

interface Props {
  localId: string;
  name: string;
  onClose: () => void;
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function NoteEntry({ entry, indent }: { entry: NoteThreadEntry; indent?: boolean }) {
  return (
    <div style={{ marginLeft: indent ? 20 : 0, marginBottom: 10 }}>
      <div style={{ fontSize: 11, color: "var(--color-ink-faint)", fontFamily: "var(--font-body)", marginBottom: 2 }}>
        <strong style={{ color: "var(--color-ink-muted)" }}>{entry.authorName ?? "Unknown"}</strong> · {formatTimestamp(entry.createdAt)}
      </div>
      <div style={{ fontSize: 13, color: "var(--color-ink)", fontFamily: "var(--font-body)", whiteSpace: "pre-wrap" }}>
        {entry.body || <em style={{ color: "var(--color-ink-faint)" }}>(empty)</em>}
      </div>
      {entry.replies.map((r) => <NoteEntry key={r.id} entry={r} indent />)}
    </div>
  );
}

export function CallNotesModal({ localId, name, onClose }: Props) {
  const [updates, setUpdates] = useState<NoteThreadEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [note, setNote] = useState("");
  const [noteMentions, setNoteMentions] = useState<MentionedUser[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pendingNotice, setPendingNotice] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetchCallLogNotes(localId);
      setUpdates(res.updates);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load notes");
    } finally {
      setLoading(false);
    }
  }, [localId]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async () => {
    if (!note.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      const trimmed = note.trim();
      const res = await addCallLogNote(
        localId,
        stripMentionMarkers(trimmed, noteMentions),
        noteMentions.length ? noteMentions.map((m) => m.id) : undefined,
      );
      setPendingNotice(res.pending);
      setNote("");
      setNoteMentions([]);
      await load();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to add the note");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="gap-0 p-0 sm:max-w-[480px]">
        <DialogHeader className="gap-0.5 border-b border-border px-5 py-4 pr-12">
          <DialogTitle style={{ fontFamily: "var(--font-display)" }}>Notes — {name}</DialogTitle>
          <DialogDescription>Monday.com's own comment thread on this call</DialogDescription>
        </DialogHeader>

        <div className="px-5 py-4">
          <div style={{ maxHeight: 320, overflowY: "auto", marginBottom: 12 }}>
            {loading ? (
              <p style={{ fontSize: 13, color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}>Loading…</p>
            ) : loadError ? (
              <p role="alert" style={{ fontSize: 13, color: "var(--color-status-red)", fontFamily: "var(--font-body)" }}>{loadError}</p>
            ) : updates && updates.length > 0 ? (
              updates.map((u) => <NoteEntry key={u.id} entry={u} />)
            ) : (
              <p style={{ fontSize: 13, color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}>No notes yet.</p>
            )}
          </div>

          {pendingNotice && (
            <p style={{ fontSize: 12, color: "var(--color-amber-dark)", fontFamily: "var(--font-body)", marginBottom: 8 }}>
              Queued — Monday was unreachable, will sync shortly.
            </p>
          )}

          <label style={{ display: "block", marginBottom: 12 }}>
            <span style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--color-ink-muted)", marginBottom: 4, fontFamily: "var(--font-body)" }}>
              Add a note
            </span>
            <MentionTextarea
              value={note}
              onChange={setNote}
              mentions={noteMentions}
              onMentionsChange={setNoteMentions}
              placeholder="What's the update? Type @ to tag someone."
              rows={3}
            />
          </label>

          {saveError && <p role="alert" style={{ fontSize: 12, color: "var(--color-status-red)", marginBottom: 8 }}>{saveError}</p>}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button type="button" variant="outline" onClick={onClose}>Close</Button>
            <Button type="button" onClick={submit} disabled={saving || !note.trim()}>
              {saving ? "Adding…" : "Add note"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
