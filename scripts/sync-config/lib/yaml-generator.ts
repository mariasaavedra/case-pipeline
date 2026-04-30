// =============================================================================
// YAML Generation for New Columns
// Generates config entries with smart defaults and preserves env var syntax
// =============================================================================

import yaml from "js-yaml";
import type { MondayColumn } from "../../../lib/monday/types";
import type { ColumnResolution, BoardConfig } from "../../../lib/config/types";

/**
 * Column types that are unique enough to resolve by_type reliably.
 * These types typically only appear once per board.
 */
const UNIQUE_TYPES = new Set([
  "email",
  "phone",
  "board_relation",
  "date",
  "numbers",
  "file",
  "location",
  "timeline",
  "formula",
  "auto_number",
]);

/**
 * Column types that often have multiple instances (prefer by_title).
 */
const COMMON_TYPES = new Set([
  "status",
  "dropdown",
  "text",
  "long_text",
  "color",
  "mirror",
  "lookup",
  "checkbox",
  "link",
]);

/**
 * Generate a config key from a column title.
 * e.g., "Case Type" -> "case_type", "Client Email" -> "client_email"
 */
export function titleToConfigKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_") // Replace non-alphanumeric with underscore
    .replace(/^_+|_+$/g, "") // Trim leading/trailing underscores
    .replace(/_+/g, "_"); // Collapse multiple underscores
}

/**
 * Generate a ColumnResolution config for a Monday.com column.
 * Uses sensible defaults based on column type.
 */
export function generateColumnConfig(
  column: MondayColumn,
  existingColumns: MondayColumn[]
): ColumnResolution {
  // Count how many columns share this type
  const sameTypeCount = existingColumns.filter(
    (c) => c.type === column.type
  ).length;

  // If this type is unique or only one column of this type exists, use by_type
  if (UNIQUE_TYPES.has(column.type) || sameTypeCount === 1) {
    return {
      resolve: "by_type",
      type: column.type,
    };
  }

  // For common types with multiple instances, use by_title
  // Generate a flexible pattern from the title
  const pattern = column.title.toLowerCase().replace(/\s+/g, ".*");

  const config: ColumnResolution = {
    resolve: "by_title",
    pattern: pattern,
  };

  // Add types filter for status-like or text-like columns
  if (["status", "color", "dropdown"].includes(column.type)) {
    config.types = [column.type];
  } else if (["mirror", "lookup"].includes(column.type)) {
    config.types = ["mirror", "lookup"];
  } else if (["text", "long_text"].includes(column.type)) {
    config.types = ["text", "long_text"];
  }

  return config;
}

/**
 * Generate configs for all new columns.
 * Returns a map of config keys to ColumnResolution.
 */
export function generateConfigsForNewColumns(
  newColumns: MondayColumn[],
  allColumns: MondayColumn[]
): Record<string, ColumnResolution> {
  const configs: Record<string, ColumnResolution> = {};
  const usedKeys = new Set<string>();

  for (const column of newColumns) {
    let key = titleToConfigKey(column.title);

    // Ensure unique key by adding suffix if needed
    let suffix = 1;
    const baseKey = key;
    while (usedKeys.has(key)) {
      key = `${baseKey}_${suffix++}`;
    }
    usedKeys.add(key);

    configs[key] = generateColumnConfig(column, allColumns);
  }

  return configs;
}

/**
 * Read the raw YAML file content.
 */
export async function readRawYaml(path: string): Promise<string> {
  const file = Bun.file(path);
  return await file.text();
}

/**
 * Load YAML without env var substitution (preserves ${VAR:default} syntax).
 */
export async function loadRawBoardsConfig(
  path: string
): Promise<{ boards: Record<string, BoardConfig> }> {
  const content = await readRawYaml(path);
  return yaml.load(content) as { boards: Record<string, BoardConfig> };
}

/**
 * Merge new column configs into existing YAML structure.
 * Preserves env var syntax like ${BOARD_ID:default}.
 */
export function mergeColumnsIntoConfig(
  existingConfig: { boards: Record<string, BoardConfig> },
  boardKey: string,
  newColumns: Record<string, ColumnResolution>
): { boards: Record<string, BoardConfig> } {
  if (!existingConfig.boards[boardKey]) {
    throw new Error(`Board "${boardKey}" not found in config`);
  }

  // Merge new columns into existing board
  existingConfig.boards[boardKey].columns = {
    ...existingConfig.boards[boardKey].columns,
    ...newColumns,
  };

  return existingConfig;
}

/**
 * Add a completely new board to the config.
 */
export function addNewBoardToConfig(
  existingConfig: { boards: Record<string, BoardConfig> },
  boardKey: string,
  boardId: string,
  boardName: string,
  columns: Record<string, ColumnResolution>,
  envVarName?: string
): { boards: Record<string, BoardConfig> } {
  const idValue = envVarName ? `\${${envVarName}:${boardId}}` : boardId;

  existingConfig.boards[boardKey] = {
    id: idValue,
    name: boardName,
    columns: columns,
  };

  return existingConfig;
}

/**
 * Dump config to YAML with proper formatting.
 */
export function dumpConfigToYaml(config: {
  boards: Record<string, BoardConfig>;
}): string {
  // Generate header comment
  const header = `# =============================================================================
# Monday.com Board Configuration
# =============================================================================
#
# Board IDs can be overridden via environment variables.
#
# Column resolution strategies:
#   by_type  - Match by column type (email, phone, status, date, etc.)
#   by_title - Match by title regex pattern
#   by_id    - Exact column ID (fallback for edge cases)
#
# =============================================================================

`;

  // Dump YAML with proper formatting
  const yamlContent = yaml.dump(config, {
    indent: 2,
    lineWidth: 100,
    quotingType: '"',
    forceQuotes: false,
    sortKeys: false,
  });

  return header + yamlContent;
}

/**
 * Write config to YAML file.
 */
export async function writeConfigToFile(
  path: string,
  config: { boards: Record<string, BoardConfig> }
): Promise<void> {
  const yamlContent = dumpConfigToYaml(config);
  await Bun.write(path, yamlContent);
}
