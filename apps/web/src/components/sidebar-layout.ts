// =============================================================================
// G1 sidebar layout — the user's page order, hidden pages and folders
// (preferences.sidebarNav)
// =============================================================================
// Saved ids are only a hint: ones the app no longer has are skipped, and pages
// added after the user customized show up at the end, so a new page is never
// lost and the stored layout never needs migrating.
//
// Folders are one level deep: a folder's id sits in `order` like a page, its
// pages live in its `items`. While Customize is open the layout is a tree of
// DraftEntry; drags work on its flattened rows (Row) and rebuild the tree.
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

// -----------------------------------------------------------------------------
// Folders
// -----------------------------------------------------------------------------

export type NavEntry<T> =
  | { kind: "page"; item: T }
  | { kind: "folder"; id: string; name: string; items: T[] };

/** The saved layout as a tree: same rules as arrangeNav, and a page sits in at
 *  most one place. Folders missing from `order` go after the ordered entries. */
export function arrangeTree<T extends { id: string }>(items: T[], pref: SidebarNavPref): NavEntry<T>[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const placed = new Set<string>();
  const folders = new Map<string, NavEntry<T> & { kind: "folder" }>();
  for (const f of pref.folders ?? []) {
    if (folders.has(f.id) || byId.has(f.id)) continue;
    const members: T[] = [];
    for (const id of f.items) {
      const item = byId.get(id);
      if (item && !placed.has(id)) {
        members.push(item);
        placed.add(id);
      }
    }
    folders.set(f.id, { kind: "folder", id: f.id, name: f.name, items: members });
  }
  const out: NavEntry<T>[] = [];
  const used = new Set<string>();
  for (const id of pref.order) {
    const folder = folders.get(id);
    if (folder && !used.has(id)) {
      out.push(folder);
      used.add(id);
      continue;
    }
    const item = byId.get(id);
    if (item && !placed.has(id)) {
      out.push({ kind: "page", item });
      placed.add(id);
    }
  }
  for (const folder of folders.values()) if (!used.has(folder.id)) out.push(folder);
  for (const item of items) if (!placed.has(item.id)) out.push({ kind: "page", item });
  return out;
}

/** Customize-mode layout: page ids and folders, in order. */
export type DraftEntry = { kind: "page"; id: string } | { kind: "folder"; id: string; name: string; items: string[] };

/** One row of the Customize list: a folder header or a page (parent = its folder). */
export interface Row {
  id: string;
  kind: "page" | "folder";
  parent: string | null;
}

export function toDraft<T extends { id: string }>(tree: NavEntry<T>[]): DraftEntry[] {
  return tree.map((e) =>
    e.kind === "page" ? { kind: "page", id: e.item.id } : { ...e, items: e.items.map((i) => i.id) },
  );
}

export function flattenDraft(tree: DraftEntry[]): Row[] {
  const rows: Row[] = [];
  for (const e of tree) {
    if (e.kind === "page") rows.push({ id: e.id, kind: "page", parent: null });
    else {
      rows.push({ id: e.id, kind: "folder", parent: null });
      for (const id of e.items) rows.push({ id, kind: "page", parent: e.id });
    }
  }
  return rows;
}

/** Rows back into a tree. A page joins its parent only while that folder is the
 *  open block; anything else lands at the top level. */
function rebuild(rows: Row[], names: Map<string, string>): DraftEntry[] {
  const out: DraftEntry[] = [];
  let open: (DraftEntry & { kind: "folder" }) | null = null;
  for (const r of rows) {
    if (r.kind === "folder") {
      open = { kind: "folder", id: r.id, name: names.get(r.id) ?? "Folder", items: [] };
      out.push(open);
    } else if (open && r.parent === open.id) {
      open.items.push(r.id);
    } else {
      open = null;
      out.push({ kind: "page", id: r.id });
    }
  }
  return out;
}

function folderNames(tree: DraftEntry[]): Map<string, string> {
  return new Map(tree.flatMap((e) => (e.kind === "folder" ? [[e.id, e.name] as const] : [])));
}

/**
 * Move page `id` to row `to` of the flattened list (all folders open). Its new
 * folder comes from its neighbours: above a folder's page → in that folder;
 * right under a folder header → in it; between a folder's last page and the next
 * top-level row it is ambiguous, so `indent` decides ("in"/"out"), else it keeps
 * the folder it came from if that is the one above.
 */
export function movePage(tree: DraftEntry[], id: string, to: number, indent: "in" | "out" | null = null): DraftEntry[] {
  const rows = flattenDraft(tree);
  const from = rows.findIndex((r) => r.id === id && r.kind === "page");
  if (from === -1) return tree;
  const row = rows[from]!;
  const rest = rows.filter((_, i) => i !== from);
  const target = Math.max(0, Math.min(rest.length, to));
  const prev = rest[target - 1];
  const next = rest[target];
  let parent: string | null = null;
  if (next?.parent) parent = next.parent;
  else if (prev?.kind === "folder") parent = prev.id;
  else if (prev?.parent) {
    parent = indent === "in" ? prev.parent : indent === "out" ? null : row.parent === prev.parent ? prev.parent : null;
  }
  if (target === from && parent === row.parent) return tree;
  rest.splice(target, 0, { ...row, parent });
  return rebuild(rest, folderNames(tree));
}

/** Move a whole folder (or a top-level page) to top-level slot `to`. */
export function moveTopLevel(tree: DraftEntry[], id: string, to: number): DraftEntry[] {
  const ids = tree.map((e) => e.id);
  const order = moveId(ids, id, to);
  if (order === ids) return tree;
  const byId = new Map(tree.map((e) => [e.id, e]));
  return order.map((x) => byId.get(x)!);
}

/** A new, empty folder at the end of the list. */
export function addFolder(tree: DraftEntry[], id: string, name: string): DraftEntry[] {
  return [...tree, { kind: "folder", id, name, items: [] }];
}

/** Delete a folder; its pages stay, at the folder's place. */
export function removeFolder(tree: DraftEntry[], id: string): DraftEntry[] {
  return tree.flatMap((e) =>
    e.kind === "folder" && e.id === id ? e.items.map((p) => ({ kind: "page" as const, id: p })) : [e],
  );
}

export function renameFolder(tree: DraftEntry[], id: string, name: string): DraftEntry[] {
  return tree.map((e) => (e.kind === "folder" && e.id === id ? { ...e, name } : e));
}

/** A fresh folder id: kebab-case, so it passes the API's nav id check. */
export function newFolderId(): string {
  return `folder-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * What to store for a finished edit: empty lists when it matches the built-in
 * layout (no folders, default order), so the user keeps following the default
 * as pages are added or moved.
 */
export function normalizeNav(defaultIds: string[], tree: DraftEntry[], hidden: string[]): SidebarNavPref {
  const known = new Set(defaultIds);
  const cleanHidden = defaultIds.filter((id) => hidden.includes(id));
  const folders = tree.flatMap((e) =>
    e.kind === "folder"
      ? [{ id: e.id, name: e.name.trim().slice(0, 40) || "Folder", items: e.items.filter((id) => known.has(id)) }]
      : [],
  );
  const order = tree.map((e) => e.id).filter((id) => known.has(id) || folders.some((f) => f.id === id));
  const isDefaultOrder =
    folders.length === 0 && order.length === defaultIds.length && order.every((id, i) => id === defaultIds[i]);
  const out: SidebarNavPref = { order: isDefaultOrder ? [] : order, hidden: cleanHidden };
  if (folders.length > 0) out.folders = folders;
  return out;
}
