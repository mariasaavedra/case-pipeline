// =============================================================================
// Column Diffing Algorithm
// Compares Monday.com board structure against YAML config
// =============================================================================

import type { MondayColumn } from "../../../lib/monday/types";
import type { BoardConfig, ColumnResolution } from "../../../lib/config/types";
import type { ColumnDiff } from "./types";

/**
 * Check if a Monday.com column matches a ColumnResolution config.
 * This is the inverse of resolveColumn() - checking if a column WOULD be
 * matched by a given resolution strategy.
 */
function columnMatchesResolution(
  column: MondayColumn,
  resolution: ColumnResolution
): boolean {
  switch (resolution.resolve) {
    case "by_id":
      return column.id === resolution.id;

    case "by_type":
      if (!resolution.type) return false;
      if (column.type !== resolution.type) return false;
      if (resolution.types && !resolution.types.includes(column.type))
        return false;
      return true;

    case "by_title":
      if (!resolution.pattern) return false;
      const regex = new RegExp(resolution.pattern, "i");
      if (!regex.test(column.title)) return false;
      if (resolution.types && !resolution.types.includes(column.type))
        return false;
      return true;

    default:
      return false;
  }
}

/**
 * Check if column matches any resolution (including fallback chains)
 */
function columnMatchesResolutionChain(
  column: MondayColumn,
  resolution: ColumnResolution
): boolean {
  if (columnMatchesResolution(column, resolution)) return true;
  if (resolution.fallback) {
    return columnMatchesResolutionChain(column, resolution.fallback);
  }
  return false;
}

/**
 * Find which config key (if any) would match this Monday.com column
 */
function findMatchingConfigKey(
  column: MondayColumn,
  boardConfig: BoardConfig
): { key: string; resolution: ColumnResolution } | undefined {
  for (const [key, resolution] of Object.entries(boardConfig.columns)) {
    if (columnMatchesResolutionChain(column, resolution)) {
      return { key, resolution };
    }
  }
  return undefined;
}

/**
 * Main diffing function: Compare Monday.com board structure to YAML config.
 *
 * Returns:
 * - newColumns: Columns in Monday.com that aren't covered by any config
 * - missingColumns: Config entries that don't match any Monday.com column
 * - matchedColumns: Successfully matched pairs (for verbose output)
 */
export function diffBoardColumns(
  mondayColumns: MondayColumn[],
  boardConfig: BoardConfig
): ColumnDiff {
  const newColumns: MondayColumn[] = [];
  const missingColumns: ColumnDiff["missingColumns"] = [];
  const matchedColumns: ColumnDiff["matchedColumns"] = [];

  // Track which config keys have been matched
  const matchedConfigKeys = new Set<string>();

  // For each Monday.com column, see if it's covered by existing config
  for (const column of mondayColumns) {
    // Skip the "name" column - it's the item name, always implicit
    if (column.id === "name") continue;

    const match = findMatchingConfigKey(column, boardConfig);

    if (match) {
      matchedConfigKeys.add(match.key);
      matchedColumns.push({
        configKey: match.key,
        mondayColumn: column,
        resolution: match.resolution,
      });
    } else {
      newColumns.push(column);
    }
  }

  // Find config entries that don't match any Monday.com column
  for (const [key, resolution] of Object.entries(boardConfig.columns)) {
    if (!matchedConfigKeys.has(key)) {
      missingColumns.push({ configKey: key, resolution });
    }
  }

  return { newColumns, missingColumns, matchedColumns };
}
