import { describe, it, expect } from "vitest";
import { staffLabel } from "./staff-label";

describe("staffLabel", () => {
  it("marks only inactive people", () => {
    expect(staffLabel("Mayra Ruiz", ["Mayra Ruiz"])).toBe("Mayra Ruiz (inactive)");
    expect(staffLabel("Ana Reyes", ["Mayra Ruiz"])).toBe("Ana Reyes");
    expect(staffLabel("Ana Reyes", undefined)).toBe("Ana Reyes");
  });
});
