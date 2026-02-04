// =============================================================================
// Tests for Monday.com API utilities
// =============================================================================

import { test, expect, describe, mock, beforeEach, afterEach } from "bun:test";
import {
  getLinkedItemIds,
  findColumnByType,
  findColumnByTitle,
  parseColumnLabels,
  getExistingLabelNames,
  updateColumnValue,
  updateLinkedItemColumn,
  setApiToken,
  MondayApiError,
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

// =============================================================================
// API mutation tests
// =============================================================================

// Store original fetch to restore after tests
const originalFetch = globalThis.fetch;

describe("updateColumnValue", () => {
  beforeEach(() => {
    setApiToken("test-token");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("formats value as JSON string in request", async () => {
    let capturedBody: any = null;

    globalThis.fetch = mock(async (url: string, options: RequestInit) => {
      capturedBody = JSON.parse(options.body as string);
      return new Response(
        JSON.stringify({
          data: { change_column_value: { id: "123" } },
        }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;

    await updateColumnValue("board1", "item1", "status_col", { label: "Done" });

    expect(capturedBody.variables.value).toBe(JSON.stringify({ label: "Done" }));
  });

  test("calls API with correct mutation structure", async () => {
    let capturedBody: any = null;

    globalThis.fetch = mock(async (url: string, options: RequestInit) => {
      capturedBody = JSON.parse(options.body as string);
      return new Response(
        JSON.stringify({
          data: { change_column_value: { id: "123" } },
        }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;

    await updateColumnValue("board123", "item456", "status_col", { label: "Working" });

    expect(capturedBody.variables.boardId).toBe("board123");
    expect(capturedBody.variables.itemId).toBe("item456");
    expect(capturedBody.variables.columnId).toBe("status_col");
    expect(capturedBody.query).toContain("change_column_value");
  });

  test("returns item ID on success", async () => {
    globalThis.fetch = mock(async () => {
      return new Response(
        JSON.stringify({
          data: { change_column_value: { id: "updated-item-789" } },
        }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;

    const result = await updateColumnValue("board1", "item1", "col1", "value");

    expect(result.id).toBe("updated-item-789");
  });

  test("throws on API error", async () => {
    globalThis.fetch = mock(async () => {
      return new Response(
        JSON.stringify({
          errors: [{ message: "Invalid column ID" }],
        }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;

    await expect(
      updateColumnValue("board1", "item1", "invalid_col", "value")
    ).rejects.toThrow();
  });
});

describe("updateLinkedItemColumn", () => {
  beforeEach(() => {
    setApiToken("test-token");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("updates all linked items by default", async () => {
    const updateCalls: string[] = [];

    globalThis.fetch = mock(async (url: string, options: RequestInit) => {
      const body = JSON.parse(options.body as string);
      updateCalls.push(body.variables.itemId);
      return new Response(
        JSON.stringify({
          data: { change_column_value: { id: body.variables.itemId } },
        }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;

    const results = await updateLinkedItemColumn(
      mockItemWithRelation,
      "contracts_relation",
      "contracts_board",
      "status_col",
      { label: "Updated" }
    );

    expect(results).toHaveLength(3);
    expect(updateCalls).toContain("111");
    expect(updateCalls).toContain("222");
    expect(updateCalls).toContain("333");
  });

  test("updates specific item when itemIndex provided", async () => {
    const updateCalls: string[] = [];

    globalThis.fetch = mock(async (url: string, options: RequestInit) => {
      const body = JSON.parse(options.body as string);
      updateCalls.push(body.variables.itemId);
      return new Response(
        JSON.stringify({
          data: { change_column_value: { id: body.variables.itemId } },
        }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;

    const results = await updateLinkedItemColumn(
      mockItemWithRelation,
      "contracts_relation",
      "contracts_board",
      "status_col",
      { label: "Updated" },
      { itemIndex: 1 }
    );

    expect(results).toHaveLength(1);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]).toBe("222"); // Second item (index 1)
  });

  test("returns empty array when no linked items", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("Should not be called");
    }) as unknown as typeof fetch;

    const results = await updateLinkedItemColumn(
      mockItemWithoutRelation,
      "contracts_relation",
      "contracts_board",
      "status_col",
      { label: "Updated" }
    );

    expect(results).toEqual([]);
  });
});
