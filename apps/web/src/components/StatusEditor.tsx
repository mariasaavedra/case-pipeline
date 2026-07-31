// =============================================================================
// StatusEditor — click a status to change it in Monday.com
// =============================================================================
// The status shows as a chip in its NATIVE Monday color; clicking opens a menu
// of that board's real labels (also native colors). Selecting one writes through
// to Monday (change_simple_column_value), attributed to the signed-in user, and
// updates optimistically. Choices are restricted to labels that exist in Monday,
// so we never write a status the board doesn't have. If the board has no synced
// options (or `disabled`), it renders as a plain, non-clickable chip.
// =============================================================================

import { useState, useRef, useEffect, useCallback } from "react";
import { useBoardStatusOptions } from "../StatusOptionsProvider";
import { changeBoardItemStatus, type StatusColumnOption } from "../api";

interface Props {
  boardKey: string | null | undefined;
  boardItemLocalId: string;
  status: string | null;
  /** Called with the new label after a successful (or queued) write. */
  onChanged?: (status: string) => void;
  disabled?: boolean;
}

function chipStyle(option: StatusColumnOption | undefined): React.CSSProperties {
  if (option?.color) {
    return { backgroundColor: option.color, color: "#fff", border: `1px solid ${option.border ?? option.color}` };
  }
  return {
    backgroundColor: "var(--color-surface-warm)",
    color: "var(--color-ink-muted)",
    border: "1px solid var(--color-border-light)",
  };
}

export function StatusEditor({ boardKey, boardItemLocalId, status, onChanged, disabled }: Props) {
  const def = useBoardStatusOptions(boardKey);
  const [current, setCurrent] = useState<string | null>(status);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => setCurrent(status), [status]);

  // Close the menu on an outside click or Escape.
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

  const options = def?.options ?? [];
  const editable = !disabled && options.length > 0;
  const currentOption = options.find((o) => o.label === current);

  const select = useCallback(
    async (label: string) => {
      setOpen(false);
      if (label === current) return;
      const prev = current;
      setCurrent(label); // optimistic
      setSaving(true);
      setError(null);
      try {
        const res = await changeBoardItemStatus(boardItemLocalId, label);
        setPending(res.pending);
        onChanged?.(label);
      } catch (e) {
        setCurrent(prev); // revert
        setError(e instanceof Error ? e.message : "Failed to update status");
      } finally {
        setSaving(false);
      }
    },
    [boardItemLocalId, current, onChanged],
  );

  if (!editable) {
    return (
      <span className="status-chip" style={chipStyle(currentOption)}>
        {current ?? "—"}
      </span>
    );
  }

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        className="status-chip status-chip-editable"
        style={{ ...chipStyle(currentOption), cursor: saving ? "wait" : "pointer", opacity: saving ? 0.6 : 1 }}
        onClick={() => setOpen((o) => !o)}
        disabled={saving}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Click to change status"
      >
        {current ?? "Set status"}
        <span aria-hidden style={{ marginLeft: 4, fontSize: 9, opacity: 0.8 }}>▾</span>
        {pending && (
          <span aria-hidden title="Queued — Monday was unreachable, will retry" style={{ marginLeft: 4 }}>⏳</span>
        )}
      </button>

      {open && (
        <div
          role="listbox"
          className="status-menu"
          style={{
            position: "absolute",
            zIndex: 40,
            marginTop: 4,
            maxHeight: 280,
            overflowY: "auto",
            minWidth: 180,
            backgroundColor: "var(--color-surface)",
            border: "1px solid var(--color-border-light)",
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
            padding: 4,
          }}
        >
          {options.map((o) => (
            <button
              key={o.index}
              type="button"
              role="option"
              aria-selected={o.label === current}
              className="status-menu-item"
              onClick={() => select(o.label)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "100%",
                textAlign: "left",
                padding: "6px 8px",
                borderRadius: 6,
                border: "none",
                background: o.label === current ? "var(--color-surface-warm)" : "transparent",
                cursor: "pointer",
                fontFamily: "var(--font-body)",
                fontSize: 13,
                color: "var(--color-ink)",
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 3,
                  flexShrink: 0,
                  backgroundColor: o.color ?? "var(--color-border)",
                  border: `1px solid ${o.border ?? "var(--color-border)"}`,
                }}
              />
              <span className="truncate">{o.label}</span>
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
