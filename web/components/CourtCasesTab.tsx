import type { BoardItemSummary } from "../api";
import { BOARD_CONFIG } from "../config";
import { BoardSection } from "./BoardSection";

/** Non-court case boards that may have items linked to court cases */
const LINKABLE_CASE_BOARDS = BOARD_CONFIG.filter(
  (b) => b.section === "cases" && b.key !== "court_cases"
);

interface Props {
  boardItems: Record<string, BoardItemSummary[]>;
  courtLinkedItemIds: Set<string>;
}

export function CourtCasesTab({ boardItems, courtLinkedItemIds }: Props) {
  const courtCaseItems = boardItems["court_cases"] ?? [];

  // Items from other boards that are linked to court cases
  const linkedItems: BoardItemSummary[] = [];
  for (const board of LINKABLE_CASE_BOARDS) {
    for (const item of boardItems[board.key] ?? []) {
      if (courtLinkedItemIds.has(item.localId)) {
        linkedItems.push(item);
      }
    }
  }

  if (courtCaseItems.length === 0 && linkedItems.length === 0) {
    return (
      <div className="py-16 text-center animate-in">
        <p
          className="text-sm"
          style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
        >
          No court cases found for this client.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 animate-in">
      {courtCaseItems.length > 0 && (
        <BoardSection label="Court Cases" items={courtCaseItems} />
      )}
      {linkedItems.length > 0 && (
        <BoardSection label="Related Cases" items={linkedItems} />
      )}
    </div>
  );
}
