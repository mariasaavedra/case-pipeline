// =============================================================================
// Column Resolver - Dynamic column resolution based on configuration
// =============================================================================

import type { MondayColumn } from "./types";
import type { ColumnResolution, BoardConfig } from "@case-pipeline/config/types";

export interface ResolvedColumns {
  [columnKey: string]: MondayColumn | undefined;
}

// =============================================================================
// Resolution strategies
// =============================================================================

/**
 * Resolves a column by its type (exact match).
 * Returns the first column matching the specified type.
 */
function resolveByType(
  columns: MondayColumn[],
  type: string
): MondayColumn | undefined {
  return columns.find((col) => col.type === type);
}

/**
 * Resolves a column by title pattern (regex match).
 * Optionally filters by allowed column types.
 *
 * @param columns - Available columns to search
 * @param pattern - Regex pattern to match against column titles (case-insensitive)
 * @param allowedTypes - If provided, only match columns of these types
 */
function resolveByTitle(
  columns: MondayColumn[],
  pattern: string,
  allowedTypes?: string[]
): MondayColumn | undefined {
  const regex = new RegExp(pattern, "i");
  return columns.find((col) => {
    if (!regex.test(col.title)) return false;
    if (allowedTypes && !allowedTypes.includes(col.type)) return false;
    return true;
  });
}

/**
 * Resolves a column by its exact ID.
 */
function resolveById(
  columns: MondayColumn[],
  id: string
): MondayColumn | undefined {
  return columns.find((col) => col.id === id);
}

// =============================================================================
// Main resolver
// =============================================================================

/**
 * Resolves a single column based on the resolution configuration.
 * Supports fallback chains.
 */
export function resolveColumn(
  columns: MondayColumn[],
  resolution: ColumnResolution
): MondayColumn | undefined {
  let column: MondayColumn | undefined;

  switch (resolution.resolve) {
    case "by_type":
      if (!resolution.type) {
        throw new Error("Column resolution by_type requires 'type' field");
      }
      // Note: resolution.types is ignored for by_type strategy since we match exact type
      column = resolveByType(columns, resolution.type);
      break;

    case "by_title":
      if (!resolution.pattern) {
        throw new Error("Column resolution by_title requires 'pattern' field");
      }
      column = resolveByTitle(columns, resolution.pattern, resolution.types);
      break;

    case "by_id":
      if (!resolution.id) {
        throw new Error("Column resolution by_id requires 'id' field");
      }
      column = resolveById(columns, resolution.id);
      break;

    default:
      throw new Error(`Unknown resolution strategy: ${resolution.resolve}`);
  }

  // Try fallback if not found
  if (!column && resolution.fallback) {
    return resolveColumn(columns, resolution.fallback);
  }

  return column;
}

/**
 * Resolves all columns defined in a board configuration.
 * Returns a map of column keys to resolved MondayColumn objects.
 */
export function resolveAllColumns(
  columns: MondayColumn[],
  boardConfig: BoardConfig,
  options: { debug?: boolean } = {}
): ResolvedColumns {
  const resolved: ResolvedColumns = {};

  for (const [columnKey, resolution] of Object.entries(boardConfig.columns)) {
    const column = resolveColumn(columns, resolution);
    resolved[columnKey] = column;

    if (options.debug) {
      if (column) {
        console.log(`  ✓ ${columnKey} → ${column.id} (${column.title}, ${column.type})`);
      } else {
        console.log(`  ✗ ${columnKey} → NOT FOUND`);
      }
    }
  }

  return resolved;
}

/**
 * Validates that all required columns were resolved.
 * Throws an error if any required columns are missing.
 */
export function validateResolvedColumns(
  resolved: ResolvedColumns,
  requiredColumns: string[]
): void {
  const missing = requiredColumns.filter((key) => !resolved[key]);

  if (missing.length > 0) {
    throw new Error(
      `Failed to resolve required columns: ${missing.join(", ")}. ` +
      `Check your board configuration and ensure the columns exist.`
    );
  }
}
