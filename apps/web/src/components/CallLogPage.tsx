// =============================================================================
// Call Log Page — spreadsheet view of the real Call Log board
// =============================================================================
// Filters (status, taken by, day, "unlinked to a profile") over board_items
// where board_key='call_log'. Status and "Highlighted for" are editable inline
// via StatusEditor/HighlightedForEditor. A row with a linked profile opens that
// client; the pencil button opens the same LogCallModal in edit mode (name/
// phone/linked client only). The "+ Log call" button on this page (and the
// header everywhere else) opens the same modal in create mode. Defaults to
// today's calls — front desk staff mostly care about "what's come in today" —
// with a date picker/"show all days" toggle for the historical/follow-up view.
// Columns are drag-resizable (widths persisted per-browser in localStorage)
// since a long status label can otherwise get clipped at the default width.
// =============================================================================

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { fetchCallLog } from "../api";
import type { CallLogEntry } from "../api";
import { Link } from "./Link";
import { clientPath } from "../router";
import { StatusEditor } from "./StatusEditor";
import { HighlightedForEditor } from "./HighlightedForEditor";
import { LogCallModal } from "./LogCallModal";
import { CallNotesModal } from "./CallNotesModal";
import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { useBoardStatusOptions } from "../StatusOptionsProvider";

const PAGE_SIZE = 50;
const WIDTHS_STORAGE_KEY = "call-log-column-widths";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatGroupDate(dateStr: string | null): string {
  if (!dateStr) return "No date";
  const label = new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
  });
  return dateStr === todayIso() ? `Today · ${label}` : label;
}

function TimeChip({ time }: { time: string | null }) {
  if (!time) return <span style={{ color: "var(--color-ink-faint)", fontSize: 12 }}>—</span>;
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", padding: "2px 8px", borderRadius: 4,
        fontSize: 12, fontWeight: 600, fontFamily: "var(--font-mono, var(--font-body))",
        background: "var(--color-amber-light)", color: "var(--color-amber-dark)",
      }}
    >
      {time}
    </span>
  );
}

/** Bucket entries by their `date`, preserving first-appearance order — not a
 * plain re-sort, since the list itself is ordered newest-*updated* first, and
 * a status change on an old call could otherwise split its date into two
 * non-adjacent runs and print a duplicate day header. */
function groupByDay(entries: CallLogEntry[]): { date: string | null; entries: CallLogEntry[] }[] {
  const order: (string | null)[] = [];
  const map = new Map<string | null, CallLogEntry[]>();
  for (const e of entries) {
    if (!map.has(e.date)) {
      map.set(e.date, []);
      order.push(e.date);
    }
    map.get(e.date)!.push(e);
  }
  return order.map((date) => ({ date, entries: map.get(date)! }));
}

interface ColumnDef {
  key: string;
  label: string;
  default: number;
  min: number;
}

const COLUMNS: ColumnDef[] = [
  { key: "when", label: "When", default: 90, min: 60 },
  { key: "name", label: "Name", default: 220, min: 120 },
  { key: "phone", label: "Phone", default: 130, min: 90 },
  { key: "status", label: "Status", default: 130, min: 80 },
  { key: "takenBy", label: "Taken by", default: 130, min: 80 },
  { key: "highlightedFor", label: "Highlighted for", default: 150, min: 90 },
  { key: "client", label: "Client", default: 160, min: 100 },
];
const ACTIONS_WIDTH = 64;

function loadWidths(): number[] {
  try {
    const raw = localStorage.getItem(WIDTHS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed) && parsed.length === COLUMNS.length && parsed.every((n) => typeof n === "number")) {
        return parsed;
      }
    }
  } catch {
    // fall through to defaults
  }
  return COLUMNS.map((c) => c.default);
}

/** Drag-to-resize column widths, persisted per-browser (a cosmetic per-viewer
 * preference, not data — no backend involvement needed). */
function useColumnWidths() {
  const [widths, setWidths] = useState<number[]>(loadWidths);
  const dragRef = useRef<{ index: number; startX: number; startWidths: number[] } | null>(null);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const delta = e.clientX - drag.startX;
      const next = [...drag.startWidths];
      next[drag.index] = Math.max(COLUMNS[drag.index]!.min, drag.startWidths[drag.index]! + delta);
      setWidths(next);
    };
    const onUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      setWidths((current) => {
        try {
          localStorage.setItem(WIDTHS_STORAGE_KEY, JSON.stringify(current));
        } catch {
          // per-viewer convenience only — fine to drop silently
        }
        return current;
      });
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, []);

  const startResize = useCallback((index: number, startX: number) => {
    dragRef.current = { index, startX, startWidths: widths };
  }, [widths]);

  const reset = useCallback(() => {
    const defaults = COLUMNS.map((c) => c.default);
    setWidths(defaults);
    try {
      localStorage.setItem(WIDTHS_STORAGE_KEY, JSON.stringify(defaults));
    } catch {
      // per-viewer convenience only — fine to drop silently
    }
  }, []);

  return { widths, startResize, reset };
}

export function CallLogPage() {
  const statusDef = useBoardStatusOptions("call_log");
  const { widths, startResize, reset: resetWidths } = useColumnWidths();
  const templateColumns = `${widths.map((w) => `${w}px`).join(" ")} ${ACTIONS_WIDTH}px`;

  const [entries, setEntries] = useState<CallLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [staffOptions, setStaffOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);

  const [status, setStatus] = useState("");
  const [takenBy, setTakenBy] = useState("");
  const [unlinkedOnly, setUnlinkedOnly] = useState(false);
  // null = "show all days"; otherwise a single YYYY-MM-DD day filter. Defaults
  // to today, since that's what front desk staff need on open — see the
  // component doc comment above.
  const [dayFilter, setDayFilter] = useState<string | null>(todayIso());

  const [showModal, setShowModal] = useState(false);
  const [editingEntry, setEditingEntry] = useState<CallLogEntry | null>(null);
  const [notesEntry, setNotesEntry] = useState<CallLogEntry | null>(null);

  const load = useCallback(async (nextOffset: number, replace: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchCallLog({
        status: status || undefined,
        takenBy: takenBy || undefined,
        unlinkedOnly: unlinkedOnly || undefined,
        dateFrom: dayFilter ?? undefined,
        dateTo: dayFilter ?? undefined,
        limit: PAGE_SIZE,
        offset: nextOffset,
      });
      setEntries((prev) => (replace ? res.entries : [...prev, ...res.entries]));
      setTotal(res.total);
      setStaffOptions(res.staffOptions);
      setOffset(nextOffset);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load the call log");
    } finally {
      setLoading(false);
    }
  }, [status, takenBy, unlinkedOnly, dayFilter]);

  useEffect(() => {
    load(0, true);
  }, [load]);

  const groups = useMemo(() => groupByDay(entries), [entries]);

  const statusItems = [{ value: "", label: "All statuses" }, ...(statusDef?.options.map((o) => ({ value: o.label, label: o.label })) ?? [])];
  const staffItems = [{ value: "", label: "All staff" }, ...staffOptions.map((s) => ({ value: s, label: s }))];

  const countSuffix = dayFilter === todayIso() ? " today" : dayFilter ? ` on ${formatGroupDate(dayFilter)}` : "";

  return (
    <div className="animate-in">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 22, fontFamily: "var(--font-display)", color: "var(--color-ink)" }}>Call Log</h1>
          <p style={{ fontSize: 13, color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}>
            {total.toLocaleString()} call{total === 1 ? "" : "s"}{countSuffix}
          </p>
        </div>
        <Button type="button" onClick={() => setShowModal(true)}>+ Log call</Button>
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ minWidth: 160 }}>
          <Select items={statusItems} value={status} onValueChange={(v) => setStatus(v ?? "")}>
            <SelectTrigger size="sm" className="w-full border-border-light bg-surface">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statusItems.map((s) => <SelectItem key={s.value || "all"} value={s.value}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div style={{ minWidth: 200 }}>
          <Select items={staffItems} value={takenBy} onValueChange={(v) => setTakenBy(v ?? "")}>
            <SelectTrigger size="sm" className="w-full border-border-light bg-surface">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {staffItems.map((s) => <SelectItem key={s.value || "all"} value={s.value}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--color-ink-muted)", fontFamily: "var(--font-body)", cursor: "pointer" }}>
          <input type="checkbox" checked={unlinkedOnly} onChange={(e) => setUnlinkedOnly(e.target.checked)} />
          Unlinked to a client
        </label>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
          {dayFilter !== null && (
            <>
              <input
                type="date"
                value={dayFilter}
                onChange={(e) => setDayFilter(e.target.value || todayIso())}
                className="rounded-md px-2 py-1 text-sm"
                style={{ border: "1px solid var(--color-border-light)", background: "var(--color-surface)", color: "var(--color-ink)", fontFamily: "var(--font-body)" }}
              />
              {dayFilter !== todayIso() && (
                <button
                  type="button"
                  onClick={() => setDayFilter(todayIso())}
                  style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "var(--color-amber)", fontFamily: "var(--font-body)" }}
                >
                  Today
                </button>
              )}
            </>
          )}
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--color-ink-muted)", fontFamily: "var(--font-body)", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={dayFilter === null}
              onChange={(e) => setDayFilter(e.target.checked ? null : todayIso())}
            />
            Show all days
          </label>
        </div>
      </div>

      {error && (
        <div className="animate-in px-4 py-3 rounded-lg mb-4 text-sm" style={{ backgroundColor: "var(--color-status-red-bg)", color: "var(--color-status-red)", fontFamily: "var(--font-body)" }}>
          {error}
        </div>
      )}

      <div style={{ border: "1px solid var(--color-border-light)", borderRadius: 10, overflow: "hidden", overflowX: "auto" }}>
        <div style={{ minWidth: "fit-content" }}>
          <div
            style={{
              display: "grid", gridTemplateColumns: templateColumns, gap: 0,
              background: "var(--color-surface-warm)", borderBottom: "1px solid var(--color-border-light)",
              fontSize: 11, fontWeight: 600, color: "var(--color-ink-muted)", fontFamily: "var(--font-body)",
              textTransform: "uppercase", letterSpacing: 0.4,
            }}
          >
            {COLUMNS.map((col, i) => (
              <div key={col.key} style={{ position: "relative", padding: "8px 10px" }}>
                {col.label}
                <div
                  onMouseDown={(e) => {
                    e.preventDefault();
                    startResize(i, e.clientX);
                  }}
                  onDoubleClick={resetWidths}
                  title="Drag to resize, double-click to reset all"
                  style={{ position: "absolute", right: -3, top: 0, bottom: 0, width: 6, cursor: "col-resize", zIndex: 1 }}
                />
              </div>
            ))}
            <div style={{ padding: "8px 10px" }} aria-hidden />
          </div>

          {entries.length === 0 && !loading ? (
            <div style={{ padding: 24, textAlign: "center", fontSize: 13, color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}>
              No calls match these filters.
            </div>
          ) : (
            groups.map((group, gi) => (
              <div key={group.date ?? `no-date-${gi}`}>
                <div
                  style={{
                    padding: "6px 10px", background: "var(--color-surface-warm)",
                    borderTop: "1px solid var(--color-border-light)", borderBottom: "1px solid var(--color-border-light)",
                    fontSize: 11, fontWeight: 600, color: "var(--color-ink-muted)", fontFamily: "var(--font-body)",
                    textTransform: "uppercase", letterSpacing: 0.4,
                  }}
                >
                  {formatGroupDate(group.date)}
                </div>
                {group.entries.map((e, i) => (
                  <div
                    key={e.localId}
                    style={{
                      display: "grid", gridTemplateColumns: templateColumns,
                      borderTop: i === 0 ? "none" : "1px solid var(--color-border-light)",
                      fontSize: 13, fontFamily: "var(--font-body)", color: "var(--color-ink)",
                      alignItems: "center",
                    }}
                  >
                    <div style={{ padding: "8px 10px" }}><TimeChip time={e.time} /></div>
                    <div style={{ padding: "8px 10px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.name}</div>
                    <div style={{ padding: "8px 10px", color: "var(--color-ink-muted)", fontSize: 12 }}>{e.phone ?? "—"}</div>
                    <div style={{ padding: "8px 10px" }}>
                      <StatusEditor
                        boardKey="call_log"
                        boardItemLocalId={e.localId}
                        status={e.status}
                        onChanged={(newStatus) =>
                          setEntries((prev) => prev.map((row) => (row.localId === e.localId ? { ...row, status: newStatus } : row)))
                        }
                      />
                    </div>
                    <div style={{ padding: "8px 10px", color: "var(--color-ink-muted)", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {e.takenBy ?? "—"}
                    </div>
                    <div style={{ padding: "8px 10px" }}>
                      <HighlightedForEditor
                        boardItemLocalId={e.localId}
                        highlightedFor={e.highlightedFor}
                        onChanged={(name) =>
                          setEntries((prev) => prev.map((row) => (row.localId === e.localId ? { ...row, highlightedFor: name } : row)))
                        }
                      />
                    </div>
                    <div style={{ padding: "8px 10px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {e.profileLocalId ? (
                        <Link href={clientPath(e.profileLocalId)} style={{ fontSize: 12 }}>{e.profileName ?? "View client"}</Link>
                      ) : (
                        <span style={{ fontSize: 12, color: "var(--color-ink-faint)" }}>— unlinked —</span>
                      )}
                    </div>
                    <div style={{ padding: "4px 6px", display: "flex", justifyContent: "center", gap: 6 }}>
                      <button
                        type="button"
                        onClick={() => setEditingEntry(e)}
                        title="Edit name, phone, or linked client"
                        aria-label="Edit call"
                        style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "var(--color-ink-faint)", padding: 2, lineHeight: 1 }}
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        onClick={() => setNotesEntry(e)}
                        title="View or add notes"
                        aria-label="Call notes"
                        style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "var(--color-ink-faint)", padding: 2, lineHeight: 1 }}
                      >
                        💬
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </div>

      {entries.length < total && (
        <div style={{ display: "flex", justifyContent: "center", marginTop: 14 }}>
          <Button type="button" variant="outline" onClick={() => load(offset + PAGE_SIZE, false)} disabled={loading}>
            {loading ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}

      {showModal && (
        <LogCallModal
          onClose={() => setShowModal(false)}
          onLogged={() => load(0, true)}
        />
      )}
      {editingEntry && (
        <LogCallModal
          // Remount per entry: LogCallModal prefills and runs its phone lookup
          // in a mount-only effect, so reusing the instance for a different
          // call would show the previous one's match list. Today the modal
          // backdrop makes switching entries directly impossible, but that is
          // an invariant of ui/dialog.tsx, not of this component.
          key={editingEntry.localId}
          entry={editingEntry}
          onClose={() => setEditingEntry(null)}
          onLogged={() => load(0, true)}
        />
      )}
      {notesEntry && (
        <CallNotesModal
          localId={notesEntry.localId}
          name={notesEntry.name}
          onClose={() => setNotesEntry(null)}
        />
      )}
    </div>
  );
}
