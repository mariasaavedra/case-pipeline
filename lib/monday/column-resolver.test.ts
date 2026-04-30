// =============================================================================
// Tests for Column Resolver
// =============================================================================

import { test, expect, describe } from "vitest";
import { resolveColumn, resolveAllColumns, validateResolvedColumns } from "./column-resolver";
import type { MondayColumn } from "./types";
import type { ColumnResolution, BoardConfig } from "../config/types";

// =============================================================================
// Test fixtures
// =============================================================================

const mockColumns: MondayColumn[] = [
  { id: "email", title: "Email", type: "email", settings_str: "{}" },
  { id: "phone", title: "Phone", type: "phone", settings_str: "{}" },
  { id: "status5", title: "Priority", type: "status", settings_str: "{}" },
  { id: "status6", title: "Status", type: "status", settings_str: "{}" },
  { id: "date", title: "Next interaction", type: "date", settings_str: "{}" },
  { id: "text4", title: "Notes", type: "text", settings_str: "{}" },
  { id: "text5", title: "Address", type: "text", settings_str: "{}" },
  { id: "numbers1", title: "Amount", type: "numbers", settings_str: "{}" },
  { id: "board_relation1", title: "Contracts", type: "board_relation", settings_str: "{}" },
  { id: "mirror1", title: "Contract Value", type: "mirror", settings_str: "{}" },
];

// =============================================================================
// resolveColumn tests
// =============================================================================

describe("resolveColumn", () => {
  describe("by_type strategy", () => {
    test("resolves column by type", () => {
      const resolution: ColumnResolution = {
        resolve: "by_type",
        type: "email",
      };

      const result = resolveColumn(mockColumns, resolution);

      expect(result).toBeDefined();
      expect(result?.id).toBe("email");
      expect(result?.type).toBe("email");
    });

    test("returns first match when multiple columns have same type", () => {
      const resolution: ColumnResolution = {
        resolve: "by_type",
        type: "status",
      };

      const result = resolveColumn(mockColumns, resolution);

      expect(result).toBeDefined();
      expect(result?.id).toBe("status5"); // First status column
    });

    test("returns undefined for non-existent type", () => {
      const resolution: ColumnResolution = {
        resolve: "by_type",
        type: "timeline",
      };

      const result = resolveColumn(mockColumns, resolution);

      expect(result).toBeUndefined();
    });

    test("throws error when type field is missing", () => {
      const resolution: ColumnResolution = {
        resolve: "by_type",
      };

      expect(() => resolveColumn(mockColumns, resolution)).toThrow(
        "Column resolution by_type requires 'type' field"
      );
    });
  });

  describe("by_title strategy", () => {
    test("resolves column by title pattern", () => {
      const resolution: ColumnResolution = {
        resolve: "by_title",
        pattern: "priority",
      };

      const result = resolveColumn(mockColumns, resolution);

      expect(result).toBeDefined();
      expect(result?.id).toBe("status5");
      expect(result?.title).toBe("Priority");
    });

    test("matches case-insensitively", () => {
      const resolution: ColumnResolution = {
        resolve: "by_title",
        pattern: "PRIORITY",
      };

      const result = resolveColumn(mockColumns, resolution);

      expect(result).toBeDefined();
      expect(result?.title).toBe("Priority");
    });

    test("supports regex patterns", () => {
      const resolution: ColumnResolution = {
        resolve: "by_title",
        pattern: "value|amount",
      };

      const result = resolveColumn(mockColumns, resolution);

      expect(result).toBeDefined();
      expect(result?.title).toBe("Amount");
    });

    test("filters by types when specified", () => {
      const resolution: ColumnResolution = {
        resolve: "by_title",
        pattern: "value|amount",
        types: ["mirror"],
      };

      const result = resolveColumn(mockColumns, resolution);

      expect(result).toBeDefined();
      expect(result?.id).toBe("mirror1");
      expect(result?.title).toBe("Contract Value");
    });

    test("returns undefined when pattern matches but type filter excludes", () => {
      const resolution: ColumnResolution = {
        resolve: "by_title",
        pattern: "priority",
        types: ["dropdown"], // Priority is status, not dropdown
      };

      const result = resolveColumn(mockColumns, resolution);

      expect(result).toBeUndefined();
    });

    test("throws error when pattern field is missing", () => {
      const resolution: ColumnResolution = {
        resolve: "by_title",
      };

      expect(() => resolveColumn(mockColumns, resolution)).toThrow(
        "Column resolution by_title requires 'pattern' field"
      );
    });
  });

  describe("by_id strategy", () => {
    test("resolves column by exact ID", () => {
      const resolution: ColumnResolution = {
        resolve: "by_id",
        id: "numbers1",
      };

      const result = resolveColumn(mockColumns, resolution);

      expect(result).toBeDefined();
      expect(result?.id).toBe("numbers1");
    });

    test("returns undefined for non-existent ID", () => {
      const resolution: ColumnResolution = {
        resolve: "by_id",
        id: "nonexistent",
      };

      const result = resolveColumn(mockColumns, resolution);

      expect(result).toBeUndefined();
    });

    test("throws error when id field is missing", () => {
      const resolution: ColumnResolution = {
        resolve: "by_id",
      };

      expect(() => resolveColumn(mockColumns, resolution)).toThrow(
        "Column resolution by_id requires 'id' field"
      );
    });
  });

  describe("fallback chains", () => {
    test("uses fallback when primary strategy fails", () => {
      const resolution: ColumnResolution = {
        resolve: "by_type",
        type: "timeline", // Doesn't exist
        fallback: {
          resolve: "by_type",
          type: "date",
        },
      };

      const result = resolveColumn(mockColumns, resolution);

      expect(result).toBeDefined();
      expect(result?.type).toBe("date");
    });

    test("returns primary result when it succeeds", () => {
      const resolution: ColumnResolution = {
        resolve: "by_type",
        type: "email",
        fallback: {
          resolve: "by_type",
          type: "phone",
        },
      };

      const result = resolveColumn(mockColumns, resolution);

      expect(result).toBeDefined();
      expect(result?.type).toBe("email");
    });

    test("supports nested fallbacks", () => {
      const resolution: ColumnResolution = {
        resolve: "by_type",
        type: "timeline", // Doesn't exist
        fallback: {
          resolve: "by_type",
          type: "formula", // Also doesn't exist
          fallback: {
            resolve: "by_type",
            type: "numbers",
          },
        },
      };

      const result = resolveColumn(mockColumns, resolution);

      expect(result).toBeDefined();
      expect(result?.type).toBe("numbers");
    });
  });
});

// =============================================================================
// resolveAllColumns tests
// =============================================================================

describe("resolveAllColumns", () => {
  test("resolves all columns in board config", () => {
    const boardConfig: BoardConfig = {
      id: "123",
      name: "Test Board",
      columns: {
        email: { resolve: "by_type", type: "email" },
        phone: { resolve: "by_type", type: "phone" },
        priority: { resolve: "by_title", pattern: "priority" },
      },
    };

    const result = resolveAllColumns(mockColumns, boardConfig);

    expect(result.email).toBeDefined();
    expect(result.email?.id).toBe("email");
    expect(result.phone).toBeDefined();
    expect(result.phone?.id).toBe("phone");
    expect(result.priority).toBeDefined();
    expect(result.priority?.id).toBe("status5");
  });

  test("sets undefined for unresolved columns", () => {
    const boardConfig: BoardConfig = {
      id: "123",
      name: "Test Board",
      columns: {
        email: { resolve: "by_type", type: "email" },
        nonexistent: { resolve: "by_type", type: "timeline" },
      },
    };

    const result = resolveAllColumns(mockColumns, boardConfig);

    expect(result.email).toBeDefined();
    expect(result.nonexistent).toBeUndefined();
  });
});

// =============================================================================
// validateResolvedColumns tests
// =============================================================================

describe("validateResolvedColumns", () => {
  test("passes when all required columns are resolved", () => {
    const resolved = {
      email: mockColumns[0],
      phone: mockColumns[1],
    };

    expect(() =>
      validateResolvedColumns(resolved, ["email", "phone"])
    ).not.toThrow();
  });

  test("throws when required columns are missing", () => {
    const resolved = {
      email: mockColumns[0],
      phone: undefined,
    };

    expect(() =>
      validateResolvedColumns(resolved, ["email", "phone"])
    ).toThrow("Failed to resolve required columns: phone");
  });

  test("lists all missing columns in error", () => {
    const resolved = {
      email: undefined,
      phone: undefined,
      priority: mockColumns[2],
    };

    expect(() =>
      validateResolvedColumns(resolved, ["email", "phone", "priority"])
    ).toThrow("Failed to resolve required columns: email, phone");
  });
});
