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
    <div className="bg-white rounded-lg shadow mb-3 overflow-hidden">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">{collapsed ? "\u25B6" : "\u25BC"}</span>
          <h4 className="text-sm font-semibold text-gray-700">{label}</h4>
        </div>
        <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">
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
