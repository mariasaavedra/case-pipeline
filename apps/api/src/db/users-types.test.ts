import { describe, it, expect } from "vitest";
import {
  sanitizePreferencesPatch,
  sanitizeKpiColumns,
  parsePreferences,
  mergePreferences,
  DEFAULT_PREFERENCES,
} from "./users-types.js";

describe("sanitizeKpiColumns", () => {
  it("keeps snake_case card→column pairs", () => {
    expect(sanitizeKpiColumns({ open_forms: "status", upcoming_hearings: "next_date" })).toEqual({
      open_forms: "status",
      upcoming_hearings: "next_date",
    });
  });

  it("drops non-string values, odd keys, and prototype-pollution attempts", () => {
    expect(
      sanitizeKpiColumns({
        open_forms: 5,
        "bad key": "status",
        alerts: "Not Snake Case",
        __proto__: "status",
        paid_fee_ks: "case_type",
      }),
    ).toEqual({ paid_fee_ks: "case_type" });
  });

  it("returns an empty map for non-objects", () => {
    expect(sanitizeKpiColumns(null)).toEqual({});
    expect(sanitizeKpiColumns(["status"])).toEqual({});
    expect(sanitizeKpiColumns("status")).toEqual({});
  });
});

describe("preferences validation", () => {
  it("keeps valid fields and drops invalid ones", () => {
    const patch = sanitizePreferencesPatch({
      theme: "dark",
      density: "compact",
      defaultPage: "/my-cases",
      sidebarCollapsedDefault: true,
      dateFormat: "relative",
      dashboardLayout: ["a", "b"],
      columns: { clients: ["name", "status"], bad: 5 },
      injected: "nope",
    });
    expect(patch.theme).toBe("dark");
    expect(patch.density).toBe("compact");
    expect(patch.defaultPage).toBe("/my-cases");
    expect(patch.sidebarCollapsedDefault).toBe(true);
    expect(patch.dateFormat).toBe("relative");
    expect(patch.dashboardLayout).toEqual(["a", "b"]);
    expect(patch.columns).toEqual({ clients: ["name", "status"] });
    expect((patch as Record<string, unknown>).injected).toBeUndefined();
  });

  it("rejects invalid enum values", () => {
    const patch = sanitizePreferencesPatch({ theme: "neon", defaultPage: "/etc/passwd" });
    expect(patch.theme).toBeUndefined();
    expect(patch.defaultPage).toBeUndefined();
  });

  it("parsePreferences fills defaults for missing/invalid blobs", () => {
    expect(parsePreferences(null)).toEqual(DEFAULT_PREFERENCES);
    expect(parsePreferences("not json")).toEqual(DEFAULT_PREFERENCES);
    expect(parsePreferences('{"theme":"light"}').theme).toBe("light");
    expect(parsePreferences('{"theme":"light"}').density).toBe(DEFAULT_PREFERENCES.density);
  });

  it("mergePreferences overlays a patch per key", () => {
    const merged = mergePreferences(DEFAULT_PREFERENCES, { theme: "dark" });
    expect(merged.theme).toBe("dark");
    expect(merged.defaultPage).toBe(DEFAULT_PREFERENCES.defaultPage);
  });
});
