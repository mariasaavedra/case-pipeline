import { useEffect, useCallback } from "react";
import type { ClientUpdate } from "../api";
import { UpdatesTimeline } from "./UpdatesTimeline";

interface Props {
  updates: ClientUpdate[];
  title: string;
  onClose: () => void;
}

export function NotesModal({ updates, title, onClose }: Props) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [handleKeyDown]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(12, 18, 34, 0.5)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="relative w-full max-w-3xl mx-4 rounded-2xl shadow-2xl flex flex-col"
        style={{
          backgroundColor: "var(--color-surface)",
          maxHeight: "85vh",
          border: "1px solid var(--color-border)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 flex-shrink-0"
          style={{ borderBottom: "1px solid var(--color-border-light)" }}
        >
          <div>
            <h2
              className="text-lg font-semibold"
              style={{ fontFamily: "var(--font-display)", color: "var(--color-ink)" }}
            >
              {title}
            </h2>
            <span
              className="text-xs"
              style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
            >
              {updates.length} note{updates.length !== 1 ? "s" : ""}
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
            style={{
              background: "none",
              border: "1px solid var(--color-border-light)",
              cursor: "pointer",
              color: "var(--color-ink-faint)",
            }}
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <UpdatesTimeline updates={updates} />
        </div>
      </div>
    </div>
  );
}
