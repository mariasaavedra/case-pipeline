import type { BoardItemSummary } from "../api";
import { BOARD_CONFIG, DOCUMENT_BOARD_KEYS } from "../config";
import { BoardSection } from "./BoardSection";

interface Props {
  boardItems: Record<string, BoardItemSummary[]>;
}

const DOC_BOARDS = BOARD_CONFIG.filter((b) => DOCUMENT_BOARD_KEYS.has(b.key));

export function DocumentsTab({ boardItems }: Props) {
  const hasAny = DOC_BOARDS.some((b) => (boardItems[b.key]?.length ?? 0) > 0);

  if (!hasAny) {
    return (
      <div className="py-16 text-center animate-in">
        <p
          className="text-sm"
          style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
        >
          No documents or notices found for this client.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 animate-in">
      {DOC_BOARDS.map((board) => {
        const items = boardItems[board.key];
        if (!items || items.length === 0) return null;
        return <BoardSection key={board.key} label={board.label} items={items} />;
      })}
    </div>
  );
}
