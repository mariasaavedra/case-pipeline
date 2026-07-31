// =============================================================================
// DebugTab — admin "debug mode" for a client's board entries
// =============================================================================
// Lists every board entry for the client, grouped by board, and lets an admin
// change each entry's status directly (StatusEditor → Monday write-back). Status
// choices are restricted to each board's real labels, shown in native Monday
// colors. Admin-only surface; mounted from ClientView behind a role check.
// =============================================================================

import { useMemo, useState } from "react";
import type { ClientCaseSummary } from "../api";
import { BOARD_DISPLAY_NAMES } from "@case-pipeline/query/types";
import { StatusEditor } from "./StatusEditor";
import { useStatusOptions } from "../StatusOptionsProvider";

interface Props {
  data: ClientCaseSummary;
}

export function DebugTab({ data }: Props) {
  const { byBoard, loaded } = useStatusOptions();

  // Boards that actually have entries for this client, in a stable order.
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
        <strong style={{ color: "var(--color-ink)" }}>Debug mode.</strong> Change any entry's status directly in
        Monday.com. Choices are limited to each board's existing labels and shown in their native colors. Changes are
        written to Monday under your account and reconciled on the next sync.
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
                  (no editable status — not synced)
                </span>
              )}
            </div>
            <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--color-border-light)" }}>
              {visible.map((it, i) => (
                <div
                  key={it.localId}
                  className="flex items-center justify-between gap-3 px-3 py-2"
                  style={{
                    borderTop: i === 0 ? "none" : "1px solid var(--color-border-light)",
                    background: "var(--color-surface)",
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
                  <StatusEditor boardKey={boardKey} boardItemLocalId={it.localId} status={it.status} />
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
