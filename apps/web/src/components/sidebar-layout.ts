// =============================================================================
// G1 sidebar layout — the user's page order + hidden pages (preferences.sidebarNav)
// =============================================================================
// Saved ids are only a hint: ones the app no longer has are skipped, and pages
// added after the user customized show up at the end, so a new page is never
// lost and the stored layout never needs migrating.
// =============================================================================

import type { SidebarNavPref } from "../api";

export const DEFAULT_SIDEBAR_NAV: SidebarNavPref = { order: [], hidden: [] };

/** Items in the saved order; unknown ids dropped, unlisted items appended in built-in order. */
export function arrangeNav<T extends { id: string }>(items: T[], order: string[]): T[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const out: T[] = [];
  const seen = new Set<string>();
  for (const id of order) {
    const item = byId.get(id);
    if (item && !seen.has(id)) {
      out.push(item);
      seen.add(id);
    }
  }
  for (const item of items) if (!seen.has(item.id)) out.push(item);
  return out;
}

/** Move `id` to position `to` (clamped). Returns the same array when nothing moves. */
export function moveId(order: string[], id: string, to: number): string[] {
  const from = order.indexOf(id);
  const target = Math.max(0, Math.min(order.length - 1, to));
  if (from === -1 || from === target) return order;
  const next = order.filter((x) => x !== id);
  next.splice(target, 0, id);
  return next;
}

/**
 * What to store for a finished edit: empty lists when it matches the built-in
 * layout, so the user keeps following the default as pages are added or moved.
 */
export function normalizeNav(defaultIds: string[], order: string[], hidden: string[]): SidebarNavPref {
  const known = new Set(defaultIds);
  const cleanHidden = defaultIds.filter((id) => hidden.includes(id));
  const cleanOrder = order.filter((id) => known.has(id));
  const isDefaultOrder =
    cleanOrder.length === defaultIds.length && cleanOrder.every((id, i) => id === defaultIds[i]);
  return { order: isDefaultOrder ? [] : cleanOrder, hidden: cleanHidden };
}
