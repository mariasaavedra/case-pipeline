// =============================================================================
// ColumnField — render + edit one board-item column by its Monday type
// =============================================================================
// Dispatches on column.type: status/dropdown/color → a colored option menu;
// date → date input; numbers → number input; text/long-text → text input.
// Each writes through change_simple_column_value (changeBoardItemColumn),
// optimistic, with saving/queued/error states. Complex/computed types don't
// reach here (the parent only passes editable columns).
// =============================================================================

import { useState, useRef, useEffect, useCallback } from "react";
import type { BoardColumn, StatusColumnOption } from "../api";
import { changeBoardItemColumn } from "../api";

const CHOICE_TYPES = new Set(["status", "dropdown", "color"]);

function useColumnSave(localId: string, columnId: string, onChanged?: (v: string) => void) {
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = useCallback(
    async (value: string, revert: () => void) => {
      setSaving(true);
      setError(null);
      try {
        const res = await changeBoardItemColumn(localId, columnId, value);
        setPending(res.pending);
        onChanged?.(value);
      } catch (e) {
        revert();
        setError(e instanceof Error ? e.message : "Failed to save");
      } finally {
        setSaving(false);
      }
    },
    [localId, columnId, onChanged],
  );
  return { save, saving, pending, error };
}

function StateHint({ saving, pending, error }: { saving: boolean; pending: boolean; error: string | null }) {
  if (error) return <span style={{ fontSize: 11, color: "var(--color-status-red)" }}>{error}</span>;
  if (saving) return <span style={{ fontSize: 11, color: "var(--color-ink-faint)" }}>saving…</span>;
  if (pending) return <span style={{ fontSize: 11, color: "var(--color-amber)" }} title="Queued — will retry">⏳ queued</span>;
  return null;
}

interface Props {
  boardItemLocalId: string;
  column: BoardColumn;
  value: string;
  onChanged?: (columnId: string, value: string) => void;
}

export function ColumnField({ boardItemLocalId, column, value, onChanged }: Props) {
  const notify = (v: string) => onChanged?.(column.columnId, v);
  return (
    <div className="flex items-start gap-3 py-1.5">
      <span
        style={{ flex: "0 0 42%", fontSize: 12, color: "var(--color-ink-faint)", fontFamily: "var(--font-body)", paddingTop: 4, wordBreak: "break-word" }}
      >
        {column.title}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        {CHOICE_TYPES.has(column.type) ? (
          <ChoiceField localId={boardItemLocalId} columnId={column.columnId} options={column.options} value={value} onChanged={notify} />
        ) : (
          <SimpleField localId={boardItemLocalId} column={column} value={value} onChanged={notify} />
        )}
      </div>
    </div>
  );
}

function ChoiceField({ localId, columnId, options, value, onChanged }: { localId: string; columnId: string; options: StatusColumnOption[]; value: string; onChanged: (v: string) => void }) {
  const [current, setCurrent] = useState(value);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const { save, saving, pending, error } = useColumnSave(localId, columnId, onChanged);
  useEffect(() => setCurrent(value), [value]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => rootRef.current && !rootRef.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const cur = options.find((o) => o.label === current);
  const chipStyle = cur?.color
    ? { backgroundColor: cur.color, color: "#fff", border: `1px solid ${cur.border ?? cur.color}` }
    : { backgroundColor: "var(--color-surface-warm)", color: "var(--color-ink-muted)", border: "1px solid var(--color-border-light)" };

  const pick = (label: string) => {
    setOpen(false);
    if (label === current) return;
    const prev = current;
    setCurrent(label);
    save(label, () => setCurrent(prev));
  };

  return (
    <div ref={rootRef} className="relative inline-block">
      <button type="button" className="status-chip status-chip-editable" style={{ ...chipStyle, cursor: saving ? "wait" : "pointer", opacity: saving ? 0.6 : 1 }} onClick={() => setOpen((o) => !o)} disabled={saving}>
        {current || "Set"} <span aria-hidden style={{ marginLeft: 4, fontSize: 9, opacity: 0.8 }}>▾</span>
      </button>
      <div style={{ marginTop: 2 }}><StateHint saving={saving} pending={pending} error={error} /></div>
      {open && (
        <div role="listbox" style={{ position: "absolute", zIndex: 40, marginTop: 4, maxHeight: 260, overflowY: "auto", minWidth: 180, backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border-light)", borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", padding: 4 }}>
          {options.map((o) => (
            <button key={o.index} type="button" onClick={() => pick(o.label)} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", padding: "6px 8px", borderRadius: 6, border: "none", background: o.label === current ? "var(--color-surface-warm)" : "transparent", cursor: "pointer", fontSize: 13, color: "var(--color-ink)", fontFamily: "var(--font-body)" }}>
              <span aria-hidden style={{ width: 12, height: 12, borderRadius: 3, flexShrink: 0, backgroundColor: o.color ?? "var(--color-border)", border: `1px solid ${o.border ?? "var(--color-border)"}` }} />
              <span className="truncate">{o.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SimpleField({ localId, column, value, onChanged }: { localId: string; column: BoardColumn; value: string; onChanged: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  const { save, saving, pending, error } = useColumnSave(localId, column.columnId, onChanged);
  useEffect(() => setDraft(value), [value]);

  const isDate = column.type === "date";
  const isNumber = column.type === "numbers" || column.type === "numeric";
  const inputType = isDate ? "date" : isNumber ? "number" : "text";

  const commit = () => {
    if (draft === value) return;
    save(draft, () => setDraft(value));
  };

  return (
    <div>
      <input
        type={inputType}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        disabled={saving}
        className="w-full rounded-md px-2 py-1 text-sm"
        style={{ border: "1px solid var(--color-border-light)", background: "var(--color-surface)", color: "var(--color-ink)", fontFamily: "var(--font-body)", maxWidth: 260 }}
      />
      <div style={{ marginTop: 2 }}><StateHint saving={saving} pending={pending} error={error} /></div>
    </div>
  );
}
