// =============================================================================
// Tests for Template Mapper
// =============================================================================

import { test, expect, describe } from "vitest";
import { mapItemToTemplateVars, validateTemplateVars } from "./mapper";
import type { MondayItem } from "../monday/types";
import type { TemplateConfig } from "../config/types";
import type { ResolvedColumns } from "../monday/column-resolver";

// =============================================================================
// Test fixtures
// =============================================================================

const mockItem: MondayItem = {
  id: "123456",
  name: "John Doe",
  board: { id: "board123", name: "Client Profiles" },
  group: { id: "group1", title: "Active Clients" },
  column_values: [
    { id: "email_col", text: "john@example.com" },
    { id: "phone_col", text: "555-1234" },
    { id: "status_col", text: "High", display_value: "High Priority" },
    { id: "notes_col", text: "Important client notes here" },
    {
      id: "relation_col",
      text: null,
      display_value: "Contract A, Contract B",
      linked_item_ids: ["111", "222"],
    },
    { id: "mirror_col", text: null, display_value: "$5,000" },
  ],
};

const mockItemMinimal: MondayItem = {
  id: "789",
  name: "Simple Item",
  column_values: [],
};

const mockResolvedColumns: ResolvedColumns = {
  email: { id: "email_col", title: "Email", type: "email", settings_str: "{}" },
  phone: { id: "phone_col", title: "Phone", type: "phone", settings_str: "{}" },
  priority: { id: "status_col", title: "Priority", type: "status", settings_str: "{}" },
  notes: { id: "notes_col", title: "Notes", type: "text", settings_str: "{}" },
  contracts: { id: "relation_col", title: "Contracts", type: "board_relation", settings_str: "{}" },
  value_mirror: { id: "mirror_col", title: "Contract Value", type: "mirror", settings_str: "{}" },
};

const mockTemplateConfig: TemplateConfig = {
  path: "templates/test.txt",
  description: "Test template",
  source_board: "profiles",
  variables: {
    contact_name: { source: "item.name" },
    item_id: { source: "item.id" },
    board_id: { source: "item.board.id" },
    board_name: { source: "item.board.name" },
    group_id: { source: "item.group.id" },
    group_name: { source: "item.group.title" },
    email: { source: "column", column: "email" },
    phone: { source: "column", column: "phone" },
    priority: { source: "column", column: "priority" },
    notes: { source: "column", column: "notes" },
    contracts: { source: "column", column: "contracts" },
    contract_value: { source: "column", column: "value_mirror" },
  },
  validation: {
    required: ["contact_name", "email"],
    warn_if_empty: ["phone", "notes"],
  },
};

// =============================================================================
// mapItemToTemplateVars tests
// =============================================================================

describe("mapItemToTemplateVars", () => {
  describe("item metadata extraction", () => {
    test("extracts item.name", () => {
      const vars = mapItemToTemplateVars(mockItem, mockTemplateConfig, mockResolvedColumns);

      expect(vars.contact_name).toBe("John Doe");
    });

    test("extracts item.id", () => {
      const vars = mapItemToTemplateVars(mockItem, mockTemplateConfig, mockResolvedColumns);

      expect(vars.item_id).toBe("123456");
    });

    test("extracts item.board.id", () => {
      const vars = mapItemToTemplateVars(mockItem, mockTemplateConfig, mockResolvedColumns);

      expect(vars.board_id).toBe("board123");
    });

    test("extracts item.board.name", () => {
      const vars = mapItemToTemplateVars(mockItem, mockTemplateConfig, mockResolvedColumns);

      expect(vars.board_name).toBe("Client Profiles");
    });

    test("extracts item.group.id", () => {
      const vars = mapItemToTemplateVars(mockItem, mockTemplateConfig, mockResolvedColumns);

      expect(vars.group_id).toBe("group1");
    });

    test("extracts item.group.title", () => {
      const vars = mapItemToTemplateVars(mockItem, mockTemplateConfig, mockResolvedColumns);

      expect(vars.group_name).toBe("Active Clients");
    });

    test("returns empty string for missing board", () => {
      const vars = mapItemToTemplateVars(mockItemMinimal, mockTemplateConfig, mockResolvedColumns);

      expect(vars.board_id).toBe("");
      expect(vars.board_name).toBe("");
    });

    test("returns empty string for missing group", () => {
      const vars = mapItemToTemplateVars(mockItemMinimal, mockTemplateConfig, mockResolvedColumns);

      expect(vars.group_id).toBe("");
      expect(vars.group_name).toBe("");
    });
  });

  describe("column value extraction", () => {
    test("extracts text column value", () => {
      const vars = mapItemToTemplateVars(mockItem, mockTemplateConfig, mockResolvedColumns);

      expect(vars.email).toBe("john@example.com");
      expect(vars.phone).toBe("555-1234");
    });

    test("extracts notes/long text value", () => {
      const vars = mapItemToTemplateVars(mockItem, mockTemplateConfig, mockResolvedColumns);

      expect(vars.notes).toBe("Important client notes here");
    });

    test("uses display_value for relations", () => {
      const vars = mapItemToTemplateVars(mockItem, mockTemplateConfig, mockResolvedColumns);

      expect(vars.contracts).toBe("Contract A, Contract B");
    });

    test("uses display_value for mirrors", () => {
      const vars = mapItemToTemplateVars(mockItem, mockTemplateConfig, mockResolvedColumns);

      expect(vars.contract_value).toBe("$5,000");
    });

    test("prefers display_value over text when both present", () => {
      const vars = mapItemToTemplateVars(mockItem, mockTemplateConfig, mockResolvedColumns);

      // status_col has both text and display_value
      expect(vars.priority).toBe("High Priority");
    });

    test("returns empty string for unresolved column", () => {
      const config: TemplateConfig = {
        ...mockTemplateConfig,
        variables: {
          missing: { source: "column", column: "nonexistent" },
        },
      };

      const vars = mapItemToTemplateVars(mockItem, config, mockResolvedColumns);

      expect(vars.missing).toBe("");
    });

    test("returns empty string when column not in item", () => {
      const vars = mapItemToTemplateVars(mockItemMinimal, mockTemplateConfig, mockResolvedColumns);

      expect(vars.email).toBe("");
    });
  });

  describe("edge cases", () => {
    test("handles column source without column key", () => {
      const config: TemplateConfig = {
        ...mockTemplateConfig,
        variables: {
          broken: { source: "column" }, // missing column key
        },
      };

      const vars = mapItemToTemplateVars(mockItem, config, mockResolvedColumns);

      expect(vars.broken).toBe("");
    });

    test("handles unknown source type", () => {
      const config: TemplateConfig = {
        ...mockTemplateConfig,
        variables: {
          unknown: { source: "unknown.source" as any },
        },
      };

      const vars = mapItemToTemplateVars(mockItem, config, mockResolvedColumns);

      expect(vars.unknown).toBe("");
    });

    test("handles empty variables config", () => {
      const config: TemplateConfig = {
        ...mockTemplateConfig,
        variables: {},
      };

      const vars = mapItemToTemplateVars(mockItem, config, mockResolvedColumns);

      expect(Object.keys(vars)).toHaveLength(0);
    });
  });
});

// =============================================================================
// validateTemplateVars tests
// =============================================================================

describe("validateTemplateVars", () => {
  describe("required validation", () => {
    test("passes when all required fields have values", () => {
      const vars = {
        contact_name: "John Doe",
        email: "john@example.com",
        phone: "555-1234",
        notes: "Some notes",
      };

      const result = validateTemplateVars(vars, mockTemplateConfig);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test("fails when required field is missing", () => {
      const vars = {
        contact_name: "John Doe",
        // email is missing
        phone: "555-1234",
      };

      const result = validateTemplateVars(vars, mockTemplateConfig);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Required variable "email" is empty or missing');
    });

    test("fails when required field is empty string", () => {
      const vars = {
        contact_name: "John Doe",
        email: "",
        phone: "555-1234",
      };

      const result = validateTemplateVars(vars, mockTemplateConfig);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Required variable "email" is empty or missing');
    });

    test("fails when required field is whitespace only", () => {
      const vars = {
        contact_name: "John Doe",
        email: "   ",
        phone: "555-1234",
      };

      const result = validateTemplateVars(vars, mockTemplateConfig);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Required variable "email" is empty or missing');
    });

    test("collects all required field errors", () => {
      const vars = {
        phone: "555-1234",
        // both contact_name and email missing
      };

      const result = validateTemplateVars(vars, mockTemplateConfig);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(2);
      expect(result.errors).toContain('Required variable "contact_name" is empty or missing');
      expect(result.errors).toContain('Required variable "email" is empty or missing');
    });
  });

  describe("warn_if_empty validation", () => {
    test("adds warning for empty optional field", () => {
      const vars = {
        contact_name: "John Doe",
        email: "john@example.com",
        phone: "",
        notes: "Has notes",
      };

      const result = validateTemplateVars(vars, mockTemplateConfig);

      expect(result.valid).toBe(true); // warnings don't fail validation
      expect(result.warnings).toContain('Variable "phone" is empty');
    });

    test("adds warning for missing optional field", () => {
      const vars = {
        contact_name: "John Doe",
        email: "john@example.com",
        // phone and notes missing
      };

      const result = validateTemplateVars(vars, mockTemplateConfig);

      expect(result.valid).toBe(true);
      expect(result.warnings).toContain('Variable "phone" is empty');
      expect(result.warnings).toContain('Variable "notes" is empty');
    });

    test("no warning when optional field has value", () => {
      const vars = {
        contact_name: "John Doe",
        email: "john@example.com",
        phone: "555-1234",
        notes: "Some notes",
      };

      const result = validateTemplateVars(vars, mockTemplateConfig);

      expect(result.warnings).toHaveLength(0);
    });
  });

  describe("no validation config", () => {
    test("passes with no validation config", () => {
      const config: TemplateConfig = {
        ...mockTemplateConfig,
        validation: undefined,
      };

      const result = validateTemplateVars({}, config);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    test("passes with empty validation config", () => {
      const config: TemplateConfig = {
        ...mockTemplateConfig,
        validation: {},
      };

      const result = validateTemplateVars({}, config);

      expect(result.valid).toBe(true);
    });
  });
});
