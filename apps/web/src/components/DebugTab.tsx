// =============================================================================
// DebugTab — admin "debug mode" for a client's board entries
// =============================================================================
// Lists every board entry for the client, grouped by board. Click an entry to
// open its editor popup (status editable now; more fields next). A header line
// reports how many boards' status options actually loaded, so a silent gap
// (stale bundle / unsynced board) is always visible. Admin-only surface.
// =============================================================================

import { useMemo, useState } from "react";
import type { ClientCaseSummary, BoardItemSummary } from "../api";
import { BOARD_DISPLAY_NAMES } from "@case-pipeline/query/types";
import { useStatusOptions } from "../StatusOptionsProvider";
import { EntryEditorModal } from "./EntryEditorModal";

interface Props {
  data: ClientCaseSummary;
}

export function DebugTab({ data }: Props) {
  const { byBoard, loaded } = useStatusOptions();
  const loadedCount = Object.keys(byBoard).length;

  // Local status overrides so a row reflects an edit immediately.
  const [statusOverrides, setStatusOverrides] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<{ entry: BoardItemSummary; boardKey: string } | null>(null);

  const boards = useMemo(
    () =>
      Object.entries(data.boardItems)
        .filter(([, items]) => items && items.length > 0)
        .sort((a, b) => a[0].localeCompare(b[0])),
    [data.boardItems],
  );

  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  return (
    <div className="space-y-4">
      <div
        className="rounded-lg p-3 text-sm"
        style={{ backgroundColor: "var(--color-surface-warm)", border: "1px solid var(--color-border-light)", color: "var(--color-ink-muted)", fontFamily: "var(--font-body)" }}
      >
        <strong style={{ color: "var(--color-ink)" }}>Debug mode.</strong> Click any entry to open its editor and change
        its status in Monday.com (limited to that board's real labels, in native colors; written under your account).
        <div style={{ marginTop: 6, fontSize: 12 }}>
          {loaded ? (
            loadedCount > 0 ? (
              <span style={{ color: "var(--color-status-green)" }}>
                ● Status options loaded for {loadedCount} board{loadedCount === 1 ? "" : "s"}.
              </span>
            ) : (
              <span style={{ color: "var(--color-status-red)" }}>
                ● Status options failed to load (0 boards). The editor can't offer choices — hard-refresh
                (Cmd/Ctrl+Shift+R); if it persists after a fresh sync, tell me.
              </span>
            )
          ) : (
            <span style={{ color: "var(--color-ink-faint)" }}>● Loading status options…</span>
          )}
        </div>
      </div>

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Filter entries by name…"
        className="w-full rounded-md px-3 py-2 text-sm"
        style={{ border: "1px solid var(--color-border-light)", background: "var(--color-surface)", fontFamily: "var(--font-body)", color: "var(--color-ink)" }}
      />

      {boards.length === 0 && (
        <p className="py-8 text-center text-sm" style={{ color: "var(--color-ink-faint)" }}>
          No board entries for this client.
        </p>
      )}

      {boards.map(([boardKey, items]) => {
        const visible = q ? items.filter((it) => it.name.toLowerCase().includes(q)) : items;
        if (visible.length === 0) return null;
        const hasOptions = !!byBoard[boardKey];
        return (
          <section key={boardKey}>
            <div className="flex items-center gap-2 mb-2">
              <h3 className="text-sm font-semibold" style={{ color: "var(--color-ink)", fontFamily: "var(--font-body)" }}>
                {BOARD_DISPLAY_NAMES[boardKey] ?? boardKey}
              </h3>
              <span className="text-[11px]" style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-mono)" }}>
                {visible.length}
              </span>
              {loaded && !hasOptions && (
                <span className="text-[11px]" style={{ color: "var(--color-ink-faint)" }}>
                  (no editable status — no mapped column)
                </span>
              )}
            </div>
            <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--color-border-light)" }}>
              {visible.map((it, i) => {
                const status = statusOverrides[it.localId] ?? it.status;
                return (
                  <button
                    key={it.localId}
                    type="button"
                    onClick={() => setSelected({ entry: { ...it, status }, boardKey })}
                    className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left"
                    style={{
                      borderTop: i === 0 ? "none" : "1px solid var(--color-border-light)",
                      background: "var(--color-surface)",
                      border: "none",
                      cursor: "pointer",
                    }}
                  >
                    <div className="min-w-0">
                      <div className="text-sm truncate" style={{ color: "var(--color-ink)", fontFamily: "var(--font-body)" }}>
                        {it.name}
                      </div>
                      {it.groupTitle && (
                        <div className="text-[11px] truncate" style={{ color: "var(--color-ink-faint)" }}>
                          {it.groupTitle}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="status-chip" style={{ backgroundColor: "var(--color-surface-warm)", color: "var(--color-ink-muted)", border: "1px solid var(--color-border-light)" }}>
                        {status ?? "—"}
                      </span>
                      <span aria-hidden style={{ color: "var(--color-ink-faint)", fontSize: 12 }}>›</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}

      {selected && (
        <EntryEditorModal
          entry={selected.entry}
          boardKey={selected.boardKey}
          onClose={() => setSelected(null)}
          onStatusChanged={(localId, s) => setStatusOverrides((prev) => ({ ...prev, [localId]: s }))}
        />
      )}
    </div>
  );
}
