// =============================================================================
// Tests for Monday.com API utilities
// =============================================================================

import { test, expect, describe } from "vitest";
import {
  getLinkedItemIds,
  findColumnByType,
  findColumnByTitle,
  parseColumnLabels,
  getExistingLabelNames,
} from "./api";
import type { MondayItem, MondayColumn } from "./types";

// =============================================================================
// Test fixtures
// =============================================================================

const mockColumns: MondayColumn[] = [
  { id: "email", title: "Email", type: "email", settings_str: "{}" },
  { id: "phone", title: "Phone", type: "phone", settings_str: "{}" },
  { id: "status5", title: "Priority", type: "status", settings_str: "{}" },
  { id: "date", title: "Next interaction", type: "date", settings_str: "{}" },
  {
    id: "status_with_labels",
    title: "Status",
    type: "status",
    settings_str: JSON.stringify({
      labels: { "0": "Done", "1": "Working", "2": "Stuck" },
    }),
  },
  {
    id: "dropdown_with_labels",
    title: "Options",
    type: "dropdown",
    settings_str: JSON.stringify({
      labels: [
        { id: 1, name: "Option A" },
        { id: 2, name: "Option B" },
      ],
    }),
  },
];

const mockItemWithRelation: MondayItem = {
  id: "123456",
  name: "Test Client",
  board: { id: "board1", name: "Profiles" },
  group: { id: "group1", title: "Clients" },
  column_values: [
    { id: "email", text: "test@example.com" },
    { id: "phone", text: "555-1234" },
    {
      id: "contracts_relation",
      text: null,
      linked_item_ids: ["111", "222", "333"],
      linked_items: [
        {
          id: "111",
          name: "Contract A",
          column_values: [{ id: "amount", text: "1000" }],
        },
        {
          id: "222",
          name: "Contract B",
          column_values: [{ id: "amount", text: "2000" }],
        },
        {
          id: "333",
          name: "Contract C",
          column_values: [{ id: "amount", text: "3000" }],
        },
      ],
    },
  ],
};

const mockItemWithoutRelation: MondayItem = {
  id: "789",
  name: "Simple Item",
  column_values: [
    { id: "email", text: "simple@example.com" },
    { id: "text", text: "Some notes" },
  ],
};

// =============================================================================
// getLinkedItemIds tests
// =============================================================================

describe("getLinkedItemIds", () => {
  test("extracts linked item IDs from board_relation column", () => {
    const result = getLinkedItemIds(mockItemWithRelation, "contracts_relation");

    expect(result).toEqual(["111", "222", "333"]);
  });

  test("returns empty array when column not found", () => {
    const result = getLinkedItemIds(mockItemWithRelation, "nonexistent");

    expect(result).toEqual([]);
  });

  test("returns empty array when column has no linked_item_ids", () => {
    const result = getLinkedItemIds(mockItemWithRelation, "email");

    expect(result).toEqual([]);
  });

  test("returns empty array for item without relations", () => {
    const result = getLinkedItemIds(mockItemWithoutRelation, "contracts_relation");

    expect(result).toEqual([]);
  });
});

// =============================================================================
// findColumnByType tests
// =============================================================================

describe("findColumnByType", () => {
  test("finds column by type", () => {
    const result = findColumnByType(mockColumns, "email");

    expect(result).toBeDefined();
    expect(result?.id).toBe("email");
  });

  test("returns first match when multiple columns have same type", () => {
    const result = findColumnByType(mockColumns, "status");

    expect(result).toBeDefined();
    expect(result?.id).toBe("status5");
  });

  test("returns undefined for non-existent type", () => {
    const result = findColumnByType(mockColumns, "timeline");

    expect(result).toBeUndefined();
  });
});

// =============================================================================
// findColumnByTitle tests
// =============================================================================

describe("findColumnByTitle", () => {
  test("finds column by title pattern", () => {
    const result = findColumnByTitle(mockColumns, /priority/i);

    expect(result).toBeDefined();
    expect(result?.id).toBe("status5");
  });

  test("matches partial title", () => {
    const result = findColumnByTitle(mockColumns, /interact/i);

    expect(result).toBeDefined();
    expect(result?.id).toBe("date");
  });

  test("returns undefined for non-matching pattern", () => {
    const result = findColumnByTitle(mockColumns, /nonexistent/i);

    expect(result).toBeUndefined();
  });
});

// =============================================================================
// parseColumnLabels tests
// =============================================================================

describe("parseColumnLabels", () => {
  test("parses status column labels (object format)", () => {
    const column = mockColumns.find((c) => c.id === "status_with_labels")!;
    const result = parseColumnLabels(column);

    expect(result).toEqual({
      "0": "Done",
      "1": "Working",
      "2": "Stuck",
    });
  });

  test("parses dropdown column labels (array format)", () => {
    const column = mockColumns.find((c) => c.id === "dropdown_with_labels")!;
    const result = parseColumnLabels(column);

    expect(result).toEqual({
      "1": "Option A",
      "2": "Option B",
    });
  });

  test("returns empty object for column without labels", () => {
    const column = mockColumns.find((c) => c.id === "email")!;
    const result = parseColumnLabels(column);

    expect(result).toEqual({});
  });

  test("returns empty object for invalid settings_str", () => {
    const column: MondayColumn = {
      id: "broken",
      title: "Broken",
      type: "status",
      settings_str: "invalid json",
    };
    const result = parseColumnLabels(column);

    expect(result).toEqual({});
  });
});

// =============================================================================
// getExistingLabelNames tests
// =============================================================================

describe("getExistingLabelNames", () => {
  test("returns label names from status column", () => {
    const column = mockColumns.find((c) => c.id === "status_with_labels")!;
    const result = getExistingLabelNames(column);

    expect(result).toContain("Done");
    expect(result).toContain("Working");
    expect(result).toContain("Stuck");
    expect(result).toHaveLength(3);
  });

  test("returns label names from dropdown column", () => {
    const column = mockColumns.find((c) => c.id === "dropdown_with_labels")!;
    const result = getExistingLabelNames(column);

    expect(result).toContain("Option A");
    expect(result).toContain("Option B");
    expect(result).toHaveLength(2);
  });

  test("returns empty array for column without labels", () => {
    const column = mockColumns.find((c) => c.id === "email")!;
    const result = getExistingLabelNames(column);

    expect(result).toEqual([]);
  });
});

