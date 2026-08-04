import { useState } from "react";
import type { BoardItemSummary } from "../api";
import { StatusBadge } from "./StatusBadge";
import { useBoardColumns, useBoardColumnsMeta } from "../BoardColumnsProvider";
import { ColumnField } from "./ColumnField";

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// Column types we can edit here via change_simple_column_value.
const EDITABLE_TYPES = new Set(["status", "dropdown", "color", "date", "numbers", "numeric", "text", "long-text", "long_text"]);

function displayValue(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const k of ["text", "label", "date", "value"]) if (typeof o[k] === "string") return o[k] as string;
  }
  return "";
}

function coerceDate(s: string): string {
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

export function BoardItemRow({ item }: { item: BoardItemSummary }) {
  const [open, setOpen] = useState(false);
  const schema = useBoardColumns(item.boardKey);
  const { loaded, error, refresh } = useBoardColumnsMeta();
  const [values, setValues] = useState<Record<string, string>>({});

  const editable = (schema?.columns ?? []).filter((c) => EDITABLE_TYPES.has(c.type) && c.title.trim() !== "");

  const valueFor = (columnId: string, type: string): string => {
    if (columnId in values) return values[columnId]!;
    const raw = displayValue(item.columnValues?.[columnId]);
    return type === "date" ? coerceDate(raw) : raw;
  };

  return (
    <div style={{ borderBottom: "1px solid var(--color-border-light)" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 py-2.5 px-4 text-left transition-colors"
        style={{ background: open ? "var(--color-surface-warm)" : "transparent", border: "none", cursor: "pointer" }}
      >
        <svg width="10" height="10" viewBox="0 0 12 12" fill="var(--color-ink-faint)" className={`toggle-chevron ${open ? "toggle-chevron-open" : ""}`} style={{ flexShrink: 0 }}>
          <path d="M4.5 2l4 4-4 4" />
        </svg>
        <StatusBadge status={item.status} />
        <span className="font-medium flex-1 min-w-0 truncate text-sm" style={{ color: "var(--color-ink)", fontFamily: "var(--font-body)" }}>
          {item.name}
        </span>
        {item.nextDate && (
          <span className="text-xs whitespace-nowrap" style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-mono)" }}>
            {formatDate(item.nextDate)}
          </span>
        )}
        {item.attorney && <span className="board-tag">{item.attorney}</span>}
      </button>

      {open && (
        <div className="px-4 pb-3 pt-1" style={{ background: "var(--color-surface-warm)" }}>
          {!schema ? (
            !loaded ? (
              <p className="text-xs py-2" style={{ color: "var(--color-ink-faint)" }}>Loading fields…</p>
            ) : error ? (
              <p className="text-xs py-2" style={{ color: "var(--color-status-red)" }}>
                Couldn't load fields: {error}.{" "}
                <button type="button" onClick={refresh} style={{ color: "var(--color-status-blue)", textDecoration: "underline", background: "none", border: "none", cursor: "pointer", padding: 0, font: "inherit" }}>Retry</button>
              </p>
            ) : (
              <p className="text-xs py-2" style={{ color: "var(--color-ink-faint)" }}>
                Fields for this board aren't synced yet — run a sync, then reopen.
              </p>
            )
          ) : editable.length === 0 ? (
            <p className="text-xs py-2" style={{ color: "var(--color-ink-faint)" }}>No editable fields on this board.</p>
          ) : (
            <div className="rounded-lg px-3 py-2" style={{ background: "var(--color-surface)", border: "1px solid var(--color-border-light)" }}>
              {editable.map((col) => (
                <ColumnField
                  key={col.columnId}
                  boardItemLocalId={item.localId}
                  column={col}
                  value={valueFor(col.columnId, col.type)}
                  onChanged={(columnId, v) => setValues((prev) => ({ ...prev, [columnId]: v }))}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
