// =============================================================================
// Tests for Configuration Loader
// =============================================================================

import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { loadConfig, loadBoardsConfig, loadTemplatesConfig } from "./loader";
import { unlink } from "node:fs/promises";

// =============================================================================
// Test fixtures
// =============================================================================

const TEST_BOARDS_YAML = `
boards:
  test_board:
    id: "12345"
    name: Test Board
    columns:
      email:
        resolve: by_type
        type: email
`;

const TEST_TEMPLATES_YAML = `
templates:
  test_template:
    path: "templates/test.txt"
    description: "Test template"
    source_board: test_board
    variables:
      name:
        source: item.name
`;

const TEST_BOARDS_WITH_ENV = `
boards:
  profiles:
    id: \${TEST_BOARD_ID:99999}
    name: \${TEST_BOARD_NAME}
    columns:
      email:
        resolve: by_type
        type: email
`;

const TEST_NESTED_ENV = `
boards:
  nested:
    id: "123"
    name: Test
    columns:
      status:
        resolve: by_title
        pattern: \${TEST_PATTERN:priority}
        types:
          - status
          - \${TEST_TYPE:color}
`;

// Temp file paths
const tempBoardsPath = "/tmp/test-boards.yaml";
const tempTemplatesPath = "/tmp/test-templates.yaml";
const tempEnvBoardsPath = "/tmp/test-boards-env.yaml";
const tempNestedEnvPath = "/tmp/test-boards-nested.yaml";

// =============================================================================
// Setup and teardown
// =============================================================================

beforeAll(async () => {
  await Bun.write(tempBoardsPath, TEST_BOARDS_YAML);
  await Bun.write(tempTemplatesPath, TEST_TEMPLATES_YAML);
  await Bun.write(tempEnvBoardsPath, TEST_BOARDS_WITH_ENV);
  await Bun.write(tempNestedEnvPath, TEST_NESTED_ENV);
});

afterAll(async () => {
  await Promise.all([
    unlink(tempBoardsPath).catch(() => {}),
    unlink(tempTemplatesPath).catch(() => {}),
    unlink(tempEnvBoardsPath).catch(() => {}),
    unlink(tempNestedEnvPath).catch(() => {}),
  ]);
});

// =============================================================================
// loadBoardsConfig tests
// =============================================================================

describe("loadBoardsConfig", () => {
  test("loads boards.yaml correctly", async () => {
    const boards = await loadBoardsConfig(tempBoardsPath);

    expect(boards).toBeDefined();
    expect(boards.test_board).toBeDefined();
    expect(boards.test_board!.id).toBe("12345");
    expect(boards.test_board!.name).toBe("Test Board");
  });

  test("parses column configuration", async () => {
    const boards = await loadBoardsConfig(tempBoardsPath);
    const columns = boards.test_board!.columns;

    expect(columns).toBeDefined();
    expect(columns!.email).toBeDefined();
    expect(columns!.email!.resolve).toBe("by_type");
    expect(columns!.email!.type).toBe("email");
  });

  test("throws error for missing file", async () => {
    await expect(loadBoardsConfig("/nonexistent/path.yaml")).rejects.toThrow(
      "Config file not found"
    );
  });
});

// =============================================================================
// loadTemplatesConfig tests
// =============================================================================

describe("loadTemplatesConfig", () => {
  test("loads templates.yaml correctly", async () => {
    const templates = await loadTemplatesConfig(tempTemplatesPath);

    expect(templates).toBeDefined();
    expect(templates.test_template).toBeDefined();
    expect(templates.test_template!.path).toBe("templates/test.txt");
    expect(templates.test_template!.source_board).toBe("test_board");
  });

  test("parses variable configuration", async () => {
    const templates = await loadTemplatesConfig(tempTemplatesPath);
    const variables = templates.test_template!.variables;

    expect(variables).toBeDefined();
    expect(variables.name).toBeDefined();
    expect(variables.name!.source).toBe("item.name");
  });
});

// =============================================================================
// loadConfig tests
// =============================================================================

describe("loadConfig", () => {
  test("loads both boards and templates", async () => {
    const config = await loadConfig({
      boardsPath: tempBoardsPath,
      templatesPath: tempTemplatesPath,
    });

    expect(config.boards).toBeDefined();
    expect(config.templates).toBeDefined();
    expect(config.boards.test_board).toBeDefined();
    expect(config.templates.test_template).toBeDefined();
  });
});

// =============================================================================
// Environment variable substitution tests
// =============================================================================

describe("environment variable substitution", () => {
  test("substitutes ${VAR} with environment value", async () => {
    const originalValue = process.env.TEST_BOARD_NAME;
    process.env.TEST_BOARD_NAME = "My Custom Board";

    try {
      const boards = await loadBoardsConfig(tempEnvBoardsPath);
      expect(boards.profiles!.name).toBe("My Custom Board");
    } finally {
      if (originalValue !== undefined) {
        process.env.TEST_BOARD_NAME = originalValue;
      } else {
        delete process.env.TEST_BOARD_NAME;
      }
    }
  });

  test("uses default value when env var not set", async () => {
    const originalValue = process.env.TEST_BOARD_ID;
    delete process.env.TEST_BOARD_ID;

    try {
      const boards = await loadBoardsConfig(tempEnvBoardsPath);
      expect(boards.profiles!.id).toBe("99999");
    } finally {
      if (originalValue !== undefined) {
        process.env.TEST_BOARD_ID = originalValue;
      }
    }
  });

  test("returns empty string when no default and env var not set", async () => {
    const originalValue = process.env.TEST_BOARD_NAME;
    delete process.env.TEST_BOARD_NAME;

    try {
      const boards = await loadBoardsConfig(tempEnvBoardsPath);
      expect(boards.profiles!.name).toBe("");
    } finally {
      if (originalValue !== undefined) {
        process.env.TEST_BOARD_NAME = originalValue;
      }
    }
  });

  test("substitutes env vars in nested objects and arrays", async () => {
    const originalPattern = process.env.TEST_PATTERN;
    const originalType = process.env.TEST_TYPE;
    delete process.env.TEST_PATTERN;
    delete process.env.TEST_TYPE;

    try {
      const boards = await loadBoardsConfig(tempNestedEnvPath);
      const column = boards.nested!.columns?.status;

      expect(column?.pattern).toBe("priority"); // default
      expect(column?.types).toContain("status");
      expect(column?.types).toContain("color"); // default
    } finally {
      if (originalPattern !== undefined) process.env.TEST_PATTERN = originalPattern;
      if (originalType !== undefined) process.env.TEST_TYPE = originalType;
    }
  });

  test("overrides default when env var is set", async () => {
    const originalValue = process.env.TEST_BOARD_ID;
    process.env.TEST_BOARD_ID = "override-123";

    try {
      const boards = await loadBoardsConfig(tempEnvBoardsPath);
      expect(boards.profiles!.id).toBe("override-123");
    } finally {
      if (originalValue !== undefined) {
        process.env.TEST_BOARD_ID = originalValue;
      } else {
        delete process.env.TEST_BOARD_ID;
      }
    }
  });
});

// =============================================================================
// Default path tests
// =============================================================================

describe("default paths", () => {
  test("loads from config/boards.yaml by default", async () => {
    // This tests the actual project config files
    const boards = await loadBoardsConfig();

    expect(boards).toBeDefined();
    expect(Object.keys(boards).length).toBeGreaterThan(0);
  });

  test("loads from config/templates.yaml by default", async () => {
    const templates = await loadTemplatesConfig();

    expect(templates).toBeDefined();
    expect(Object.keys(templates).length).toBeGreaterThan(0);
  });
});
