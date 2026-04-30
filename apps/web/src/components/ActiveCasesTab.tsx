import type { BoardItemSummary } from "../api";
import { BOARD_CONFIG } from "../config";
import { BoardSection } from "./BoardSection";

/** Case board keys excluding court_cases (those go in Court Cases tab) */
const ACTIVE_CASE_BOARDS = BOARD_CONFIG.filter(
  (b) => b.section === "cases" && b.key !== "court_cases"
);

interface Props {
  boardItems: Record<string, BoardItemSummary[]>;
  courtLinkedItemIds: Set<string>;
}

export function ActiveCasesTab({ boardItems, courtLinkedItemIds }: Props) {
  // Filter out items that are linked to court cases
  const filteredBoards = ACTIVE_CASE_BOARDS.map((board) => {
    const items = (boardItems[board.key] ?? []).filter(
      (item) => !courtLinkedItemIds.has(item.localId)
    );
    return { board, items };
  }).filter(({ items }) => items.length > 0);

  if (filteredBoards.length === 0) {
    return (
      <div className="py-16 text-center animate-in">
        <p
          className="text-sm"
          style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
        >
          No active cases found for this client.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 animate-in">
      {filteredBoards.map(({ board, items }) => (
        <BoardSection key={board.key} label={board.label} items={items} />
      ))}
    </div>
  );
}
