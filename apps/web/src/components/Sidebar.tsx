import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { navigate, matchRoute } from "../router";
import { useViewport } from "../hooks/useViewport";
import { usePreferences } from "../hooks/usePreferences";
import type { AuthUser } from "../auth/AuthProvider";
import { SectionCode } from "./ScreenCode";
import {
  arrangeTree,
  toDraft,
  flattenDraft,
  movePage,
  moveTopLevel,
  addFolder,
  removeFolder,
  renameFolder,
  newFolderId,
  normalizeNav,
  DEFAULT_SIDEBAR_NAV,
  type DraftEntry,
  type NavEntry,
} from "./sidebar-layout";

const COLLAPSED_KEY = "sidebar-collapsed";
const CLOSED_FOLDERS_KEY = "sidebar-folders-closed";
/** Same cap as the API's preferences check. */
const MAX_FOLDERS = 12;
/** Sideways drag that moves a page into or out of a folder. */
const INDENT_PX = 24;

const FOLDER_ICON = (
  <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M2.5 5.5a1 1 0 011-1h4l1.5 2h7.5a1 1 0 011 1V15a1 1 0 01-1 1h-13a1 1 0 01-1-1V5.5z" />
  </svg>
);

interface NavItem {
  id: string;
  label: string;
  path: string;
  icon: React.ReactNode;
  disabled?: boolean;
  /** Never shown to anyone but an admin (not "under construction" — admin work). */
  adminOnly?: boolean;
}

/** Pages still being built: admins use them, everyone else sees them greyed
 *  out here and a notice on the page itself (app.tsx). Remove an id to open it. */
export const UNDER_CONSTRUCTION_PAGES = new Set(["alerts", "mail", "court-cases", "address-changes", "foias", "efiles-to-open", "workload", "map"]);

const NAV_ITEMS: NavItem[] = [
  {
    id: "home",
    label: "Home",
    path: "/",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M3 10L10 3l7 7" />
        <path d="M5 8.5V16a1 1 0 001 1h3v-4h2v4h3a1 1 0 001-1V8.5" />
      </svg>
    ),
  },
  {
    id: "clients",
    label: "Clients",
    path: "/clients",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="10" cy="7" r="3" />
        <path d="M4 17c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      </svg>
    ),
  },
  {
    id: "appointments",
    label: "Appointments",
    path: "/appointments",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="4" width="14" height="13" rx="2" />
        <path d="M3 8h14M7 2v4M13 2v4" />
      </svg>
    ),
  },
  {
    id: "reception",
    label: "Receptionists",
    path: "/reception",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M4 11V9a6 6 0 0112 0v2" />
        <rect x="2.5" y="11" width="3" height="5" rx="1" />
        <rect x="14.5" y="11" width="3" height="5" rx="1" />
        <path d="M16 16c0 1.1-1.3 2-3 2h-2" />
      </svg>
    ),
  },
  {
    id: "contracts",
    label: "Contracts",
    path: "/contracts",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M5 2h7l4 4v11a1 1 0 01-1 1H5a1 1 0 01-1-1V3a1 1 0 011-1z" />
        <path d="M12 2v4h4M7 10h6M7 13h6M7 16h3" />
      </svg>
    ),
  },
  {
    id: "prescheduling",
    label: "Prescheduling",
    path: "/prescheduling",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M5 2h10M5 18h10" />
        <path d="M6 2c0 4 8 4 8 8s-8 4-8 8M14 2c0 4-8 4-8 8s8 4 8 8" />
      </svg>
    ),
  },
  {
    id: "active-cases",
    label: "Active Cases",
    path: "/active-cases",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="2" y="2" width="7" height="7" rx="1" />
        <rect x="11" y="2" width="7" height="7" rx="1" />
        <rect x="2" y="11" width="7" height="7" rx="1" />
        <rect x="11" y="11" width="7" height="7" rx="1" />
      </svg>
    ),
  },
  {
    id: "my-cases",
    label: "My Cases",
    path: "/my-cases",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="8" cy="7" r="3" />
        <path d="M2.5 17c0-3 2.5-5.5 5.5-5.5 1 0 1.9.3 2.7.7" />
        <path d="M12.5 14.5l1.8 1.8 3.2-3.6" />
      </svg>
    ),
  },
  {
    id: "calendar",
    label: "Calendar",
    path: "/calendar",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="4" width="14" height="13" rx="2" />
        <path d="M3 8h14M7 2v4M13 2v4" />
        <circle cx="10" cy="13" r="1.5" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    id: "alerts",
    label: "Alerts",
    path: "/alerts",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M10 2L2 18h16L10 2z" />
        <path d="M10 8v4M10 14v1" />
      </svg>
    ),
  },
  {
    id: "jail-intakes",
    label: "Jail Intakes",
    path: "/jail-intakes",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="3" width="14" height="14" rx="1.5" />
        <path d="M7 3v14M10 3v14M13 3v14" />
      </svg>
    ),
  },
  {
    id: "call-log",
    label: "Call Log",
    path: "/call-log",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M4 3.5c0-.6.4-1 1-1h1.8c.5 0 .9.3 1 .8l.6 2.4c.1.4 0 .8-.3 1.1l-1 1c1 2 2.6 3.6 4.6 4.6l1-1c.3-.3.7-.4 1.1-.3l2.4.6c.5.1.8.5.8 1V15c0 .6-.4 1-1 1h-1c-6.1 0-11-4.9-11-11v-1.5z" />
      </svg>
    ),
  },
  {
    id: "mail",
    label: "Mail",
    path: "/mail",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="2.5" y="4.5" width="15" height="11" rx="1.5" />
        <path d="M3 5.5l7 5 7-5" />
      </svg>
    ),
  },
  {
    id: "address-changes",
    label: "Address Changes",
    path: "/address-changes",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M3 9.5L8 5l5 4.5V16H3V9.5z" />
        <path d="M12 7h5M15 4.5L17.5 7 15 9.5" />
      </svg>
    ),
  },
  {
    id: "efiles-to-open",
    label: "E-Files to open",
    path: "/efiles-to-open",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M2.5 5.5a1 1 0 011-1h4l1.5 2h7.5a1 1 0 011 1V15a1 1 0 01-1 1h-13a1 1 0 01-1-1V5.5z" />
        <path d="M10 9v4.5M7.75 11.25h4.5" />
      </svg>
    ),
  },
  {
    id: "client-uploads",
    label: "Client uploads",
    path: "/client-uploads",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M3 11v4a1 1 0 001 1h12a1 1 0 001-1v-4" />
        <path d="M10 3v9M6.5 6.5L10 3l3.5 3.5" />
      </svg>
    ),
  },
  {
    id: "foias",
    label: "FOIAs",
    path: "/foias",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M4 2.5h8l4 4V17a.5.5 0 01-.5.5h-11A.5.5 0 014 17V2.5z" />
        <path d="M12 2.5v4h4" />
        <circle cx="9" cy="11.5" r="2.5" />
        <path d="M10.8 13.3L13 15.5" />
      </svg>
    ),
  },
  {
    id: "workload",
    label: "Workload",
    path: "/workload",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="6" cy="5.5" r="2" />
        <path d="M2.5 12c0-1.9 1.6-3.5 3.5-3.5S9.5 10.1 9.5 12" />
        <path d="M11.5 16.5h6M11.5 13h4M11.5 9.5h2" />
      </svg>
    ),
  },
  {
    id: "target-dates",
    label: "Target Dates",
    path: "/target-dates",
    adminOnly: true,
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="10" cy="10" r="7" />
        <circle cx="10" cy="10" r="3.5" />
        <circle cx="10" cy="10" r="0.75" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: "court-cases",
    label: "Court Cases",
    path: "/court-cases",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M3 7.5L10 3l7 4.5" />
        <path d="M4.5 8.5v6M8 8.5v6M12 8.5v6M15.5 8.5v6" />
        <path d="M3 17h14" />
      </svg>
    ),
  },
  {
    id: "map",
    label: "Map",
    path: "/map",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M2.5 5l5-2 5 2 5-2v12l-5 2-5-2-5 2V5z" />
        <path d="M7.5 3v12M12.5 5v12" />
      </svg>
    ),
  },
];

function isActiveItem(item: NavItem, pathname: string): boolean {
  if (item.path === "/") return pathname === "/";
  return pathname.startsWith(item.path);
}

interface Props {
  mobileOpen: boolean;
  onMobileClose: () => void;
  user: AuthUser | null;
  onLogout: () => void;
}

export function Sidebar({ mobileOpen, onMobileClose, user, onLogout }: Props) {
  const { isTabletRail } = useViewport();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [pathname, setPathname] = useState(window.location.pathname);

  useEffect(() => {
    const onNav = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", onNav);
    return () => window.removeEventListener("popstate", onNav);
  }, []);

  const toggleCollapse = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, String(next));
    } catch {}
  };

  // Customize mode: drag rows (or arrow keys on the grip) to reorder, eye to
  // hide, folders to group pages. Edits live in a draft until Done; saved per
  // user (preferences.sidebarNav).
  const { prefs, update } = usePreferences();
  const [draft, setDraft] = useState<{ tree: DraftEntry[]; hidden: string[] } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [focusFolder, setFocusFolder] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const editing = draft !== null;
  const saved = prefs.sidebarNav ?? DEFAULT_SIDEBAR_NAV;
  const defaultIds = NAV_ITEMS.map((i) => i.id);

  // Which folders are closed: per device, like the collapsed sidebar.
  const [closedFolders, setClosedFolders] = useState<string[]>(() => {
    try {
      const v: unknown = JSON.parse(localStorage.getItem(CLOSED_FOLDERS_KEY) ?? "[]");
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  });
  const toggleFolder = (id: string) => {
    const next = closedFolders.includes(id) ? closedFolders.filter((x) => x !== id) : [...closedFolders, id];
    setClosedFolders(next);
    try {
      localStorage.setItem(CLOSED_FOLDERS_KEY, JSON.stringify(next));
    } catch {}
  };

  const startEditing = () =>
    setDraft({ tree: toDraft(arrangeTree(NAV_ITEMS, saved)), hidden: [...saved.hidden] });
  const finishEditing = () => {
    if (draft) update("sidebarNav", normalizeNav(defaultIds, draft.tree, draft.hidden));
    setDraft(null);
    setDragId(null);
    setSavedFlash(true);
  };
  const cancelEditing = () => {
    setDraft(null);
    setDragId(null);
  };
  const resetDraft = () => setDraft({ tree: defaultIds.map((id) => ({ kind: "page", id })), hidden: [] });
  const toggleHidden = (id: string) =>
    setDraft((d) =>
      d && { ...d, hidden: d.hidden.includes(id) ? d.hidden.filter((x) => x !== id) : [...d.hidden, id] },
    );
  const editTree = (fn: (tree: DraftEntry[]) => DraftEntry[]) =>
    setDraft((d) => {
      if (!d) return d;
      const tree = fn(d.tree);
      return tree === d.tree ? d : { ...d, tree };
    });
  const createFolder = () => {
    const id = newFolderId();
    editTree((t) => addFolder(t, id, "New folder"));
    setFocusFolder(id);
  };
  const folderCount = draft ? draft.tree.filter((e) => e.kind === "folder").length : 0;

  // Rows on screen while editing. A lifted folder travels with its pages folded
  // away, so every row it can pass is a top-level one.
  const draggingFolder = !!draft && draft.tree.some((e) => e.kind === "folder" && e.id === dragId);
  const editRows = draft
    ? flattenDraft(draft.tree).filter((r) => !(draggingFolder && r.parent))
    : [];

  // Pointer drag (mouse + touch). The grabbed row follows the pointer; the
  // others slide out of its way (FLIP). Hit-testing uses each row's untransformed
  // slot (offsetTop ignores transforms) so rows mid-animation never jitter it.
  // Sideways travel moves a page into (right) or out of (left) the folder above.
  const navRef = useRef<HTMLElement>(null);
  const grab = useRef<{ offset: number; y: number; x0: number } | null>(null);
  const lastTops = useRef(new Map<string, number>());
  const [savedFlash, setSavedFlash] = useState(false);
  const reduceMotion = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const slotTop = (el: HTMLElement) => {
    const nav = navRef.current;
    return nav ? nav.getBoundingClientRect().top + el.offsetTop - nav.scrollTop : el.offsetTop;
  };

  const positionDragged = () => {
    const el = dragId ? rowRefs.current.get(dragId) : undefined;
    if (!el || !grab.current) return;
    el.style.transform = `translateY(${grab.current.y - grab.current.offset - slotTop(el)}px) scale(1.02)`;
  };

  const onDragMove = (e: React.PointerEvent) => {
    if (!dragId || !draft || !grab.current) return;
    grab.current.y = e.clientY;
    // The lifted row takes whichever slot its centre is over, so a neighbour
    // makes room after half a row of travel, never later.
    const dragged = rowRefs.current.get(dragId);
    const probe = e.clientY - grab.current.offset + (dragged?.offsetHeight ?? 0) / 2;
    let target = editRows.length - 1;
    for (const [i, r] of editRows.entries()) {
      const el = rowRefs.current.get(r.id);
      if (!el) continue;
      if (probe < slotTop(el) + el.offsetHeight) {
        target = i;
        break;
      }
    }
    const dx = e.clientX - grab.current.x0;
    const indent = dx > INDENT_PX ? "in" : dx < -INDENT_PX ? "out" : null;
    const next = draggingFolder
      ? moveTopLevel(draft.tree, dragId, target)
      : movePage(draft.tree, dragId, target, indent);
    if (next !== draft.tree) {
      // Each sideways step counts once: measure the next one from here.
      if (indent) grab.current.x0 = e.clientX;
      editTree(() => next);
    } else positionDragged();
  };

  const startDrag = (e: React.PointerEvent<HTMLButtonElement>, id: string) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const row = rowRefs.current.get(id);
    grab.current = { offset: row ? e.clientY - slotTop(row) : 0, y: e.clientY, x0: e.clientX };
    setDragId(id);
  };

  // Drop: settle the lifted row into its slot instead of snapping.
  const endDrag = () => {
    const el = dragId ? rowRefs.current.get(dragId) : undefined;
    if (el) {
      const lifted = el.style.transform;
      el.style.transform = "";
      if (lifted && !reduceMotion()) {
        el.animate([{ transform: lifted }, { transform: "none" }], { duration: 180, easing: "cubic-bezier(.2,.8,.2,1)" });
      }
    }
    grab.current = null;
    setDragId(null);
  };

  // FLIP: after each reorder, slide every moved row from its old slot to the new one.
  useLayoutEffect(() => {
    if (!draft) {
      lastTops.current.clear();
      return;
    }
    const animate = !reduceMotion();
    for (const r of flattenDraft(draft.tree)) {
      const el = rowRefs.current.get(r.id);
      if (!el) continue;
      const top = el.offsetTop;
      const prev = lastTops.current.get(r.id);
      if (animate && prev !== undefined && prev !== top && r.id !== dragId) {
        el.animate([{ transform: `translateY(${prev - top}px)` }, { transform: "none" }], {
          duration: 200,
          easing: "cubic-bezier(.2,.8,.2,1)",
        });
      }
      lastTops.current.set(r.id, top);
    }
    positionDragged();
    // Only a reorder (or a folder folding away for a drag) moves rows; drag
    // position updates go through positionDragged directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.tree, draggingFolder]);

  useEffect(() => {
    if (!savedFlash) return;
    const t = setTimeout(() => setSavedFlash(false), 1800);
    return () => clearTimeout(t);
  }, [savedFlash]);

  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelEditing();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing]);

  const isAdmin = user?.role === "admin";
  const isBuilding = (item: NavItem) => !isAdmin && UNDER_CONSTRUCTION_PAGES.has(item.id);
  const isLocked = (item: NavItem) => item.disabled || isBuilding(item);

  const handleNav = (item: NavItem) => {
    if (isLocked(item)) return;
    navigate(item.path);
    onMobileClose();
  };

  // Effective rail mode: the open mobile drawer always shows full labels;
  // the tablet range (641–1024px) forces the icon rail regardless of the
  // user's manual collapse preference; otherwise honour the manual toggle.
  const rail = mobileOpen || editing ? false : collapsed || isTabletRail;
  const width = rail ? 60 : 220;

  // What the sidebar shows: hidden pages dropped, folders with nothing left
  // dropped. The icon rail has no room for folder names, so it lists pages flat.
  const visible = (item: NavItem) => !saved.hidden.includes(item.id) && (isAdmin || !item.adminOnly);
  const shownTree = arrangeTree(NAV_ITEMS, saved).flatMap((e): NavEntry<NavItem>[] => {
    if (e.kind === "page") return visible(e.item) ? [e] : [];
    const items = e.items.filter(visible);
    if (items.length === 0) return [];
    return rail ? items.map((item) => ({ kind: "page" as const, item })) : [{ ...e, items }];
  });

  const renderPage = (item: NavItem, inFolder = false) => {
    const active = isActiveItem(item, pathname);
    const locked = isLocked(item);
    const building = isBuilding(item);
    return (
      <button
        key={item.id}
        onClick={() => handleNav(item)}
        disabled={locked}
        className={`sidebar-item ${active ? "sidebar-item-active" : ""} ${inFolder ? "sidebar-item-child" : ""}`}
        title={building ? `${item.label} — under construction` : rail ? item.label : undefined}
        style={{ justifyContent: rail ? "center" : "flex-start" }}
      >
        <span className="sidebar-icon">{item.icon}</span>
        {!rail && <span className="sidebar-label">{item.label}</span>}
        {building && !rail ? (
          <span className="sidebar-soon">Building</span>
        ) : item.disabled && !rail ? (
          <span className="sidebar-soon">Soon</span>
        ) : null}
      </button>
    );
  };

  const navById = new Map(NAV_ITEMS.map((i) => [i.id, i]));

  return (
    <>
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div className="sidebar-backdrop" onClick={onMobileClose} />
      )}

      <aside
        className={`sidebar ${mobileOpen ? "sidebar-mobile-open" : ""}`}
        style={{ width }}
      >
        {/* Logo area */}
        <div className="sidebar-logo" style={{ padding: rail ? "16px 12px" : "16px 20px" }}>
          <div
            className="w-7 h-7 rounded-md flex items-center justify-center text-xs font-bold flex-shrink-0"
            style={{
              backgroundColor: "var(--color-amber)",
              color: "#fff",
              fontFamily: "var(--font-display)",
            }}
          >
            CP
          </div>
          {!rail && (
            <span
              className="text-sm font-semibold tracking-tight whitespace-nowrap"
              style={{ color: "#fff", fontFamily: "var(--font-body)" }}
            >
              Case Pipeline
            </span>
          )}
        </div>

        {/* Nav items */}
        {editing && draft ? (
          <nav
            ref={navRef}
            className={`sidebar-nav sidebar-nav-editing ${dragId ? "sidebar-nav-dragging" : ""}`}
            aria-label="Reorder pages"
            onPointerMove={onDragMove}
          >
            {editRows.map((row, index) => {
              const entry = draft.tree.find((e) => e.id === row.id);
              const folder = row.kind === "folder" && entry?.kind === "folder" ? entry : undefined;
              const item = row.kind === "page" ? navById.get(row.id) : undefined;
              if (!folder && !item) return null;
              const label = folder ? folder.name || "Folder" : item!.label;
              const hidden = !!item && draft.hidden.includes(item.id);
              const topIndex = draft.tree.findIndex((e) => e.id === row.id);
              return (
                <div
                  key={row.id}
                  ref={(el) => {
                    if (el) rowRefs.current.set(row.id, el);
                    else rowRefs.current.delete(row.id);
                  }}
                  className={`sidebar-item sidebar-edit-row ${folder ? "sidebar-edit-folder" : ""} ${row.parent ? "sidebar-item-child" : ""} ${dragId === row.id ? "sidebar-edit-dragging" : ""} ${hidden ? "sidebar-edit-hidden" : ""}`}
                  style={{ "--i": index } as React.CSSProperties}
                >
                  <button
                    type="button"
                    className="sidebar-grip"
                    aria-label={
                      folder
                        ? `Move folder ${label} (drag, or use the up and down arrow keys)`
                        : `Move ${label} (drag, or arrow keys: up and down to move, right and left into or out of a folder)`
                    }
                    title={folder ? "Drag to reorder" : "Drag to reorder — drag right into a folder, left out of it"}
                    onPointerDown={(e) => startDrag(e, row.id)}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                    onKeyDown={(e) => {
                      const up = e.key === "ArrowUp";
                      if (up || e.key === "ArrowDown") {
                        e.preventDefault();
                        if (folder) editTree((t) => moveTopLevel(t, row.id, topIndex + (up ? -1 : 1)));
                        else editTree((t) => movePage(t, row.id, index + (up ? -1 : 1)));
                      } else if (!folder && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
                        e.preventDefault();
                        const indent = e.key === "ArrowRight" ? "in" : "out";
                        editTree((t) => movePage(t, row.id, index, indent));
                      }
                    }}
                  >
                    <svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor" aria-hidden>
                      <circle cx="4" cy="3" r="1.3" /><circle cx="8" cy="3" r="1.3" />
                      <circle cx="4" cy="8" r="1.3" /><circle cx="8" cy="8" r="1.3" />
                      <circle cx="4" cy="13" r="1.3" /><circle cx="8" cy="13" r="1.3" />
                    </svg>
                  </button>
                  {folder ? (
                    <>
                      <span className="sidebar-icon">{FOLDER_ICON}</span>
                      <input
                        className="sidebar-folder-name"
                        value={folder.name}
                        maxLength={40}
                        aria-label="Folder name"
                        ref={(el) => {
                          if (el && focusFolder === folder.id) {
                            el.focus();
                            el.select();
                            setFocusFolder(null);
                          }
                        }}
                        onChange={(e) => {
                          const name = e.target.value;
                          editTree((t) => renameFolder(t, folder.id, name));
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                        }}
                      />
                      <button
                        type="button"
                        className="sidebar-eye"
                        onClick={() => editTree((t) => removeFolder(t, folder.id))}
                        aria-label={`Remove folder ${label} (its pages stay)`}
                        title="Remove folder — its pages stay"
                      >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
                          <path d="M4 4l8 8M12 4l-8 8" />
                        </svg>
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="sidebar-icon">{item!.icon}</span>
                      <span className="sidebar-label">{label}</span>
                      <button
                        type="button"
                        className="sidebar-eye"
                        onClick={() => toggleHidden(row.id)}
                        aria-pressed={!hidden}
                        aria-label={hidden ? `Show ${label}` : `Hide ${label}`}
                        title={hidden ? "Hidden — click to show" : "Click to hide"}
                      >
                        {hidden ? (
                          <svg key="off" className="sidebar-eye-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
                            <path d="M2 8s2.2-4.5 6-4.5S14 8 14 8s-2.2 4.5-6 4.5S2 8 2 8z" />
                            <path d="M2.5 13.5l11-11" />
                          </svg>
                        ) : (
                          <svg key="on" className="sidebar-eye-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
                            <path d="M2 8s2.2-4.5 6-4.5S14 8 14 8s-2.2 4.5-6 4.5S2 8 2 8z" />
                            <circle cx="8" cy="8" r="2" />
                          </svg>
                        )}
                      </button>
                    </>
                  )}
                </div>
              );
            })}
            <button
              type="button"
              className="sidebar-new-folder"
              onClick={createFolder}
              disabled={folderCount >= MAX_FOLDERS}
              title={folderCount >= MAX_FOLDERS ? `Up to ${MAX_FOLDERS} folders` : "Add a folder, then drag pages into it"}
            >
              + New folder
            </button>
          </nav>
        ) : (
        <nav className="sidebar-nav">
          {shownTree.map((entry) => {
            if (entry.kind === "page") return renderPage(entry.item);
            const open = !closedFolders.includes(entry.id);
            const holdsActive = entry.items.some((i) => isActiveItem(i, pathname));
            return (
              <div key={entry.id} className="sidebar-folder" role="group" aria-label={entry.name}>
                <button
                  type="button"
                  onClick={() => toggleFolder(entry.id)}
                  aria-expanded={open}
                  className={`sidebar-item sidebar-folder-head ${!open && holdsActive ? "sidebar-folder-holds-active" : ""}`}
                >
                  <span className={`sidebar-chevron ${open ? "sidebar-chevron-open" : ""}`} aria-hidden>
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6">
                      <path d="M3.5 2l3 3-3 3" />
                    </svg>
                  </span>
                  <span className="sidebar-label">{entry.name}</span>
                  {!open && <span className="sidebar-folder-count">{entry.items.length}</span>}
                </button>
                {open && entry.items.map((item) => renderPage(item, true))}
              </div>
            );
          })}
        </nav>
        )}

        {/* G1 — the sidebar itself (docs/ui-map.md), with the Customize controls */}
        <div className="sidebar-customize" style={{ padding: "0 10px" }}>
          {!rail && (
            editing ? (
              <>
                <button type="button" className="sidebar-link" onClick={resetDraft} title="Back to the standard order, nothing hidden">
                  Reset
                </button>
                <span style={{ flex: 1 }} />
                <button type="button" className="sidebar-link" onClick={cancelEditing}>Cancel</button>
                <button type="button" className="sidebar-link sidebar-link-primary" onClick={finishEditing}>Done</button>
              </>
            ) : savedFlash ? (
              <span className="sidebar-saved" role="status">✓ Saved</span>
            ) : (
              <button type="button" className="sidebar-link" onClick={startEditing} title="Reorder or hide pages in this list">
                Customize
              </button>
            )
          )}
          <span style={{ marginLeft: "auto" }}>
            <SectionCode code="G1" />
          </span>
        </div>

        {/* P22 Manual — fixed here, like Settings, so no one can hide it */}
        <button
          onClick={() => { navigate("/manual"); onMobileClose(); }}
          className={`sidebar-item ${pathname.startsWith("/manual") ? "sidebar-item-active" : ""}`}
          title={rail ? "Manual" : undefined}
          style={{ justifyContent: rail ? "center" : "flex-start" }}
        >
          <span className="sidebar-icon">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M10 5c-1.5-1.3-3.7-2-6.5-2v12c2.8 0 5 .7 6.5 2 1.5-1.3 3.7-2 6.5-2V3c-2.8 0-5 .7-6.5 2z" />
              <path d="M10 5v12" />
            </svg>
          </span>
          {!rail && <span className="sidebar-label">Manual</span>}
        </button>

        {/* Settings */}
        <button
          onClick={() => { navigate("/settings"); onMobileClose(); }}
          className={`sidebar-item ${pathname.startsWith("/settings") ? "sidebar-item-active" : ""}`}
          title={rail ? "Settings" : undefined}
          style={{ justifyContent: rail ? "center" : "flex-start" }}
        >
          <span className="sidebar-icon">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="10" cy="10" r="3" />
              <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.2 4.2l1.4 1.4M14.4 14.4l1.4 1.4M4.2 15.8l1.4-1.4M14.4 5.6l1.4-1.4" />
            </svg>
          </span>
          {!rail && <span className="sidebar-label">Settings</span>}
        </button>

        {/* User info + logout */}
        {user && (
          <div
            style={{
              padding: rail ? "12px 8px" : "12px 16px",
              borderTop: "1px solid rgba(255,255,255,0.07)",
              display: "flex",
              alignItems: "center",
              gap: "10px",
            }}
          >
            <div
              style={{
                width: "28px",
                height: "28px",
                borderRadius: "50%",
                backgroundColor: "var(--color-amber)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: "var(--font-body)",
                fontWeight: 600,
                fontSize: "11px",
                color: "#fff",
                flexShrink: 0,
              }}
            >
              {user.name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase()}
            </div>
            {!rail && (
              <>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: "var(--font-body)", fontSize: "12px", fontWeight: 500, color: "rgba(255,255,255,0.85)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {user.name}
                  </div>
                </div>
                <button
                  onClick={onLogout}
                  title="Sign out"
                  style={{ background: "none", border: "none", cursor: "pointer", padding: "4px", color: "rgba(255,255,255,0.4)", flexShrink: 0 }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.8)")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.4)")}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M10 3h3a1 1 0 011 1v8a1 1 0 01-1 1h-3M7 11l3-3-3-3M10 8H2" />
                  </svg>
                </button>
              </>
            )}
          </div>
        )}

        {/* Collapse toggle — hidden in the forced tablet rail (can't expand there) */}
        {!isTabletRail && (
          <button
            onClick={toggleCollapse}
            className="sidebar-toggle"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              style={{
                transform: collapsed ? "rotate(180deg)" : "none",
                transition: "transform 0.2s ease",
              }}
            >
              <path d="M10 3L5 8l5 5" />
            </svg>
          </button>
        )}
      </aside>
    </>
  );
}
