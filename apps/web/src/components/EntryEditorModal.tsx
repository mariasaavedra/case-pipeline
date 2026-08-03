// =============================================================================
// EntryEditorModal — click a board entry to edit its fields (admin debug)
// =============================================================================
// Opens on a single board entry. Status is editable now (write-back to Monday,
// native colors, restricted to the board's real labels). All of the entry's
// other fields are listed below (read-only for now) so nothing is hidden — full
// per-column editing is the next step. A visible line reports whether this
// board's status options actually loaded, so a silent gap is never a mystery.
// =============================================================================

import type { BoardItemSummary } from "../api";
import { BOARD_DISPLAY_NAMES } from "@case-pipeline/query/types";
import { ModalPortal } from "./ModalPortal";
import { StatusEditor } from "./StatusEditor";
import { useBoardStatusOptions } from "../StatusOptionsProvider";

interface Props {
  entry: BoardItemSummary;
  boardKey: string;
  onClose: () => void;
  onStatusChanged: (localId: string, status: string) => void;
}

function displayValue(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.text === "string") return o.text;
    if (typeof o.label === "string") return o.label as string;
  }
  try {
    return JSON.stringify(v);
  } catch {
    return "";
  }
}

export function EntryEditorModal({ entry, boardKey, onClose, onStatusChanged }: Props) {
  const def = useBoardStatusOptions(boardKey);
  const boardName = BOARD_DISPLAY_NAMES[boardKey] ?? boardKey;

  const fields = Object.entries(entry.columnValues ?? {})
    .map(([id, v]) => [id, displayValue(v)] as const)
    .filter(([, v]) => v !== "");

  return (
    <ModalPortal>
      <div className="version-modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="Edit entry">
        <div className="version-modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
          <div className="version-modal-head">
            <div style={{ minWidth: 0 }}>
              <h2 style={{ fontFamily: "var(--font-display)", fontSize: 18, color: "var(--color-ink)", margin: 0 }} className="truncate">
                {entry.name}
              </h2>
              <p style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--color-ink-faint)", margin: "2px 0 0" }}>
                {boardName}
              </p>
            </div>
            <button type="button" onClick={onClose} className="version-modal-close" aria-label="Close">✕</button>
          </div>

          <div className="version-modal-body">
            {/* Status — editable */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--color-ink-muted)", marginBottom: 6, fontFamily: "var(--font-body)" }}>
                Status
              </label>
              {def ? (
                <StatusEditor
                  boardKey={boardKey}
                  boardItemLocalId={entry.localId}
                  status={entry.status}
                  onChanged={(s) => onStatusChanged(entry.localId, s)}
                />
              ) : (
                <div style={{ fontSize: 12, color: "var(--color-status-red)" }}>
                  This board's status options aren't loaded, so status can't be edited here yet.
                  {" "}(This board may have no mapped status column — see the note in the Debug tab header.)
                </div>
              )}
            </div>

            {/* All other fields — read-only for now */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-ink-muted)", marginBottom: 6, fontFamily: "var(--font-body)" }}>
                All fields <span style={{ fontWeight: 400, color: "var(--color-ink-faint)" }}>(read-only — editing more fields is coming next)</span>
              </div>
              {fields.length === 0 ? (
                <p style={{ fontSize: 12, color: "var(--color-ink-faint)" }}>No populated fields.</p>
              ) : (
                <div style={{ border: "1px solid var(--color-border-light)", borderRadius: 8, overflow: "hidden" }}>
                  {fields.map(([id, val], i) => (
                    <div
                      key={id}
                      style={{
                        display: "flex", gap: 10, padding: "6px 10px",
                        borderTop: i === 0 ? "none" : "1px solid var(--color-border-light)",
                      }}
                    >
                      <span style={{ flex: "0 0 40%", fontSize: 11, color: "var(--color-ink-faint)", fontFamily: "var(--font-mono)", wordBreak: "break-word" }}>
                        {id}
                      </span>
                      <span style={{ flex: 1, fontSize: 12, color: "var(--color-ink)", fontFamily: "var(--font-body)", wordBreak: "break-word" }}>
                        {val}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
