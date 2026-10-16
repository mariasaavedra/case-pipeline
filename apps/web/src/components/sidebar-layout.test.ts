import { describe, it, expect } from "vitest";
import {
  arrangeNav,
  arrangeTree,
  moveId,
  normalizeNav,
  toDraft,
  flattenDraft,
  movePage,
  moveTopLevel,
  removeFolder,
  type DraftEntry,
} from "./sidebar-layout";

const items = ["home", "clients", "calendar", "map"].map((id) => ({ id }));
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe("arrangeNav", () => {
  it("keeps the built-in order when nothing is saved", () => {
    expect(ids(arrangeNav(items, []))).toEqual(["home", "clients", "calendar", "map"]);
  });

  it("follows the saved order, skips gone ids, appends new pages", () => {
    expect(ids(arrangeNav(items, ["calendar", "gone", "home", "calendar"]))).toEqual([
      "calendar",
      "home",
      "clients",
      "map",
    ]);
  });
});

describe("moveId", () => {
  it("moves an id up and down, clamped to the ends", () => {
    const o = ["a", "b", "c"];
    expect(moveId(o, "c", 0)).toEqual(["c", "a", "b"]);
    expect(moveId(o, "a", 9)).toEqual(["b", "c", "a"]);
    expect(moveId(o, "b", 1)).toBe(o);
    expect(moveId(o, "zz", 0)).toBe(o);
  });
});

const pages = (...xs: string[]): DraftEntry[] => xs.map((id) => ({ kind: "page", id }));

describe("normalizeNav", () => {
  const def = ["home", "clients", "map"];
  it("stores nothing when the edit ends on the built-in layout", () => {
    expect(normalizeNav(def, pages("home", "clients", "map"), [])).toEqual({ order: [], hidden: [] });
  });
  it("keeps a custom order and only known hidden ids", () => {
    expect(normalizeNav(def, pages("map", "home", "clients"), ["map", "nope"])).toEqual({
      order: ["map", "home", "clients"],
      hidden: ["map"],
    });
  });
});

// -----------------------------------------------------------------------------
// Folders
// -----------------------------------------------------------------------------

const shape = (tree: DraftEntry[]) =>
  tree.map((e) => (e.kind === "page" ? e.id : `${e.id}[${e.items.join(",")}]`)).join(" ");

describe("arrangeTree", () => {
  it("puts folder pages in their folder, once, and appends new pages at the top level", () => {
    const tree = arrangeTree(items, {
      order: ["f1", "home", "clients"],
      hidden: [],
      folders: [
        { id: "f1", name: "Work", items: ["clients", "gone", "calendar"] },
        { id: "f2", name: "Later", items: ["calendar"] },
      ],
    });
    expect(shape(toDraft(tree))).toBe("f1[clients,calendar] home f2[] map");
  });
});

describe("movePage", () => {
  // f[a,b] c d
  const tree: DraftEntry[] = [{ kind: "folder", id: "f", name: "F", items: ["a", "b"] }, ...pages("c", "d")];

  it("joins a folder when dropped among its pages or right under its header", () => {
    expect(shape(movePage(tree, "d", 1))).toBe("f[d,a,b] c");
    expect(shape(movePage(tree, "d", 2))).toBe("f[a,d,b] c");
  });

  it("leaves a folder when dropped among top-level rows", () => {
    expect(shape(movePage(tree, "a", 3))).toBe("f[b] c a d");
  });

  it("uses indent for the slot after a folder's last page", () => {
    // c at row 3 sits right after b: out by default, in on request
    expect(movePage(tree, "c", 3)).toBe(tree);
    expect(shape(movePage(tree, "c", 3, "in"))).toBe("f[a,b,c] d");
    // b (last page of f) keeps its folder unless told to go out
    expect(movePage(tree, "b", 2)).toBe(tree);
    expect(shape(movePage(tree, "b", 2, "out"))).toBe("f[a] b c d");
  });

  it("fills an empty folder", () => {
    const empty: DraftEntry[] = [{ kind: "folder", id: "f", name: "F", items: [] }, ...pages("a")];
    expect(shape(movePage(empty, "a", 1, "in"))).toBe("f[a]");
  });

  it("keeps rows flat and in sync", () => {
    expect(flattenDraft(movePage(tree, "d", 1)).map((r) => `${r.id}:${r.parent ?? ""}`)).toEqual([
      "f:", "d:f", "a:f", "b:f", "c:",
    ]);
  });
});

describe("moveTopLevel / removeFolder / normalizeNav with folders", () => {
  const tree: DraftEntry[] = [...pages("home"), { kind: "folder", id: "f", name: " Boards ", items: ["map"] }, ...pages("clients")];

  it("moves a folder as one block", () => {
    expect(shape(moveTopLevel(tree, "f", 0))).toBe("f[map] home clients");
    expect(moveTopLevel(tree, "f", 1)).toBe(tree);
  });

  it("removing a folder keeps its pages in its place", () => {
    expect(shape(removeFolder(tree, "f"))).toBe("home map clients");
  });

  it("stores folders, never as the default layout", () => {
    expect(normalizeNav(["home", "map", "clients"], tree, [])).toEqual({
      order: ["home", "f", "clients"],
      hidden: [],
      folders: [{ id: "f", name: "Boards", items: ["map"] }],
    });
  });
});
