import type { BoardItemSummary } from "../api";
import { StatusBadge } from "./StatusBadge";

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function BoardItemRow({ item }: { item: BoardItemSummary }) {
  return (
    <div
      className="flex items-center gap-3 py-2.5 px-4 transition-colors"
      style={{ borderBottom: "1px solid var(--color-border-light)" }}
    >
      <StatusBadge status={item.status} />
      <span
        className="font-medium flex-1 min-w-0 truncate text-sm"
        style={{ color: "var(--color-ink)", fontFamily: "var(--font-body)" }}
      >
        {item.name}
      </span>
      {item.nextDate && (
        <span
          className="text-xs whitespace-nowrap"
          style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-mono)" }}
        >
          {formatDate(item.nextDate)}
        </span>
      )}
      {item.attorney && (
        <span className="board-tag">
          {item.attorney}
        </span>
      )}
    </div>
  );
}
