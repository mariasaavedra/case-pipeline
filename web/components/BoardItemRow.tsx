import type { BoardItemSummary } from "../api";
import { StatusBadge } from "./StatusBadge";

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function BoardItemRow({ item }: { item: BoardItemSummary }) {
  return (
    <div className="flex items-center gap-3 py-2 px-3 border-b border-gray-100 last:border-0">
      <StatusBadge status={item.status} />
      <span className="font-medium text-gray-900 flex-1 min-w-0 truncate">{item.name}</span>
      {item.nextDate && (
        <span className="text-sm text-gray-500 whitespace-nowrap">{formatDate(item.nextDate)}</span>
      )}
      {item.attorney && (
        <span className="text-xs bg-gray-200 text-gray-700 px-1.5 py-0.5 rounded font-mono">
          {item.attorney}
        </span>
      )}
    </div>
  );
}
