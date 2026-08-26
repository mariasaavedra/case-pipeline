// =============================================================================
// HighlightedForEditor — click a call's "Highlighted for" to reassign it
// =============================================================================
// Same click-to-open-menu pattern as StatusEditor, but the options come from
// the Call Log staff directory (Monday workspace users) instead of a synced
// status column, and the write goes through the call-log edit endpoint (a
// people column needs change_column_value's JSON shape, not the simple-value
// path StatusEditor uses).
// =============================================================================

import { useState, useRef, useEffect, useCallback } from "react";
import { fetchCallLogStaffDirectory, updateCallLogEntry, type MondayStaffUser } from "../api";

interface Props {
  boardItemLocalId: string;
  highlightedFor: string | null;
  /** Called with the new name (or null when cleared) after a successful (or queued) write. */
  onChanged?: (name: string | null) => void;
  disabled?: boolean;
}

export function HighlightedForEditor({ boardItemLocalId, highlightedFor, onChanged, disabled }: Props) {
  const [staff, setStaff] = useState<MondayStaffUser[]>([]);
  const [current, setCurrent] = useState<string | null>(highlightedFor);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => setCurrent(highlightedFor), [highlightedFor]);

  useEffect(() => {
    if (!open || staff.length > 0) return;
    fetchCallLogStaffDirectory()
      .then(setStaff)
      .catch(() => setStaff([]));
  }, [open, staff.length]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const select = useCallback(
    async (user: MondayStaffUser | null) => {
      setOpen(false);
      const name = user?.name ?? null;
      if (name === current) return;
      const prev = current;
      setCurrent(name); // optimistic
      setSaving(true);
      setError(null);
      try {
        const res = await updateCallLogEntry(boardItemLocalId, { highlightedForUserId: user?.id ?? null });
        setPending(res.pending);
        onChanged?.(name);
      } catch (e) {
        setCurrent(prev); // revert
        setError(e instanceof Error ? e.message : "Failed to update");
      } finally {
        setSaving(false);
      }
    },
    [boardItemLocalId, current, onChanged],
  );

  const editable = !disabled;

  if (!editable) {
    return <span style={{ fontSize: 12, color: "var(--color-ink-muted)" }}>{current ?? "—"}</span>;
  }

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={saving}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Click to change who this call is highlighted for"
        style={{
          background: "none", border: "none", padding: 0, textAlign: "left",
          cursor: saving ? "wait" : "pointer", opacity: saving ? 0.6 : 1,
          fontSize: 12, fontFamily: "var(--font-body)",
          color: current ? "var(--color-ink)" : "var(--color-ink-faint)",
        }}
      >
        {current ?? "—"}
        {pending && (
          <span aria-hidden title="Queued — Monday was unreachable, will retry" style={{ marginLeft: 4 }}>⏳</span>
        )}
      </button>

      {open && (
        <div
          role="listbox"
          className="status-menu"
          style={{
            position: "absolute", zIndex: 40, marginTop: 4, maxHeight: 280, overflowY: "auto",
            minWidth: 180, backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border-light)",
            borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", padding: 4,
          }}
        >
          <button
            type="button"
            role="option"
            aria-selected={current === null}
            onClick={() => select(null)}
            style={{
              display: "block", width: "100%", textAlign: "left", padding: "6px 8px", borderRadius: 6,
              border: "none", background: current === null ? "var(--color-surface-warm)" : "transparent",
              cursor: "pointer", fontFamily: "var(--font-body)", fontSize: 13, color: "var(--color-ink-faint)",
            }}
          >
            — Clear —
          </button>
          {staff.map((u) => (
            <button
              key={u.id}
              type="button"
              role="option"
              aria-selected={u.name === current}
              onClick={() => select(u)}
              style={{
                display: "block", width: "100%", textAlign: "left", padding: "6px 8px", borderRadius: 6,
                border: "none", background: u.name === current ? "var(--color-surface-warm)" : "transparent",
                cursor: "pointer", fontFamily: "var(--font-body)", fontSize: 13, color: "var(--color-ink)",
              }}
              className="truncate"
            >
              {u.name}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div style={{ fontSize: 11, color: "var(--color-status-red)", marginTop: 2 }} role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
