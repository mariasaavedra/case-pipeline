// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { menuPosition } from "./anchored-menu";

function rect(top: number, left = 100, height = 24): DOMRect {
  return { top, bottom: top + height, left, right: left + 120, width: 120, height, x: left, y: top, toJSON: () => ({}) };
}

describe("menuPosition", () => {
  beforeEach(() => {
    Object.assign(window, { innerHeight: 800, innerWidth: 1200 });
  });

  it("opens below the chip when there's room", () => {
    const p = menuPosition(rect(100));
    expect(p.top).toBe(128);
    expect(p.bottom).toBeUndefined();
    expect(p.maxHeight).toBe(280);
  });

  it("opens above the chip on the last row near the bottom", () => {
    const p = menuPosition(rect(740));
    expect(p.top).toBeUndefined();
    expect(p.bottom).toBe(800 - 740 + 4);
    expect(p.maxHeight).toBe(280);
  });

  it("keeps the menu inside the right edge", () => {
    expect(menuPosition(rect(100, 1150)).left).toBe(1200 - 188);
  });
});
