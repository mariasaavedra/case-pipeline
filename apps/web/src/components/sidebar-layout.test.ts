import { describe, it, expect } from "vitest";
import { arrangeNav, moveId, normalizeNav } from "./sidebar-layout";

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

describe("normalizeNav", () => {
  const def = ["home", "clients", "map"];
  it("stores nothing when the edit ends on the built-in layout", () => {
    expect(normalizeNav(def, ["home", "clients", "map"], [])).toEqual({ order: [], hidden: [] });
  });
  it("keeps a custom order and only known hidden ids", () => {
    expect(normalizeNav(def, ["map", "home", "clients"], ["map", "nope"])).toEqual({
      order: ["map", "home", "clients"],
      hidden: ["map"],
    });
  });
});
