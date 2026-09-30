// =============================================================================
// Anchored menus — placement + dismissal for the inline click-to-edit menus
// =============================================================================
// StatusEditor and HighlightedForEditor portal their menu to <body> with fixed
// positioning, so a table wrapper's `overflow: hidden` can't clip it. The menu
// opens upward when there isn't room below its anchor (e.g. the last row of the
// Call Log), and closes on an outside click, Escape, scroll, or resize (a fixed
// menu would otherwise drift away from its anchor).
// =============================================================================

import { useState, useRef, useEffect, useLayoutEffect } from "react";

const MENU_MAX_HEIGHT = 280;
const MENU_GAP = 4;
const MENU_MIN_WIDTH = 180;

export type MenuPos = { left: number; top?: number; bottom?: number; maxHeight: number };

/** Place the menu under the anchor, or above it when there's more room there. */
export function menuPosition(anchor: DOMRect): MenuPos {
  const below = window.innerHeight - anchor.bottom - MENU_GAP * 2;
  const above = anchor.top - MENU_GAP * 2;
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - MENU_MIN_WIDTH - 8));
  if (below >= MENU_MAX_HEIGHT || below >= above) {
    return { left, top: anchor.bottom + MENU_GAP, maxHeight: Math.min(MENU_MAX_HEIGHT, below) };
  }
  return { left, bottom: window.innerHeight - anchor.top + MENU_GAP, maxHeight: Math.min(MENU_MAX_HEIGHT, above) };
}

/** Style for the portaled menu box at `pos`. */
export function menuBoxStyle(pos: MenuPos): React.CSSProperties {
  return {
    position: "fixed",
    zIndex: 1000,
    left: pos.left,
    top: pos.top,
    bottom: pos.bottom,
    maxHeight: pos.maxHeight,
    overflowY: "auto",
    minWidth: MENU_MIN_WIDTH,
    backgroundColor: "var(--color-surface)",
    border: "1px solid var(--color-border-light)",
    borderRadius: 8,
    boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
    padding: 4,
  };
}

/**
 * Wire a menu to its anchor: `rootRef` goes on the anchor's wrapper, `menuRef`
 * on the portaled menu. `menuPos` is null until measured (render nothing then).
 */
export function useAnchoredMenu(open: boolean, setOpen: (open: boolean) => void) {
  const [menuPos, setMenuPos] = useState<MenuPos | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Measure before paint so the menu never flashes in the wrong spot.
  useLayoutEffect(() => {
    setMenuPos(open && rootRef.current ? menuPosition(rootRef.current.getBoundingClientRect()) : null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onScroll = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return; // scrolling the menu itself
      setOpen(false);
    };
    const onResize = () => setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, setOpen]);

  return { rootRef, menuRef, menuPos };
}
