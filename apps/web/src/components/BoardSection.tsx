import { useState } from "react";
import type { BoardItemSummary } from "../api";
import { BoardItemRow } from "./BoardItemRow";

interface Props {
  label: string;
  items: BoardItemSummary[];
}

export function BoardSection({ label, items }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  if (items.length === 0) return null;

  return (
    <div className="card card-elevated mb-3 overflow-hidden">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-4 py-3 transition-colors"
        style={{
          backgroundColor: "var(--color-surface-warm)",
          borderBottom: collapsed ? "none" : "1px solid var(--color-border-light)",
        }}
      >
        <div className="flex items-center gap-2.5">
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="var(--color-ink-faint)"
            className={`toggle-chevron ${!collapsed ? "toggle-chevron-open" : ""}`}
          >
            <path d="M4.5 2l4 4-4 4" />
          </svg>
          <h4
            className="text-sm font-semibold"
            style={{ color: "var(--color-ink)", fontFamily: "var(--font-body)" }}
          >
            {label}
          </h4>
        </div>
        <span
          className="text-xs font-medium px-2 py-0.5 rounded-full"
          style={{
            backgroundColor: "var(--color-surface)",
            color: "var(--color-ink-faint)",
            fontFamily: "var(--font-mono)",
            border: "1px solid var(--color-border-light)",
          }}
        >
          {items.length}
        </span>
      </button>
      {!collapsed && (
        <div>
          {items.map((item) => (
            <BoardItemRow key={item.localId} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
