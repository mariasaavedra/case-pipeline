// =============================================================================
// Template Mapper - Maps Monday.com data to template variables
// =============================================================================

import type { MondayItem } from "../monday/types";
import type { ResolvedColumns } from "../monday/column-resolver";
import type { TemplateConfig, VariableSource } from "../config/types";

export interface TemplateVars {
  [key: string]: string;
}

// =============================================================================
// Variable extraction
// =============================================================================

function extractItemValue(item: MondayItem, source: VariableSource["source"]): string {
  switch (source) {
    case "item.name":
      return item.name;
    case "item.id":
      return item.id;
    case "item.board.id":
      return item.board?.id ?? "";
    case "item.board.name":
      return item.board?.name ?? "";
    case "item.group.id":
      return item.group?.id ?? "";
    case "item.group.title":
      return item.group?.title ?? "";
    default:
      return "";
  }
}

function extractColumnValue(
  item: MondayItem,
  columnKey: string,
  resolvedColumns: ResolvedColumns
): string {
  const column = resolvedColumns[columnKey];
  if (!column) {
    return "";
  }

  const columnValue = item.column_values.find((cv) => cv.id === column.id);
  if (!columnValue) {
    return "";
  }

  // Use display_value for relations and mirrors, text for others
  return columnValue.display_value ?? columnValue.text ?? "";
}

// =============================================================================
// Main mapper
// =============================================================================

/**
 * Maps a Monday.com item to template variables based on the template configuration.
 */
export function mapItemToTemplateVars(
  item: MondayItem,
  templateConfig: TemplateConfig,
  resolvedColumns: ResolvedColumns
): TemplateVars {
  const vars: TemplateVars = {};

  for (const [varName, varDef] of Object.entries(templateConfig.variables)) {
    if (varDef.source === "column") {
      if (!varDef.column) {
        console.warn(`Variable "${varName}" has source "column" but no column key specified`);
        vars[varName] = "";
        continue;
      }
      vars[varName] = extractColumnValue(item, varDef.column, resolvedColumns);
    } else {
      vars[varName] = extractItemValue(item, varDef.source);
    }
  }

  return vars;
}

// =============================================================================
// Validation
// =============================================================================

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validates that all required template variables have values.
 */
export function validateTemplateVars(
  vars: TemplateVars,
  templateConfig: TemplateConfig
): ValidationResult {
  const result: ValidationResult = {
    valid: true,
    errors: [],
    warnings: [],
  };

  const validation = templateConfig.validation;
  if (!validation) {
    return result;
  }

  // Check required variables
  if (validation.required) {
    for (const varName of validation.required) {
      if (!vars[varName] || vars[varName].trim() === "") {
        result.valid = false;
        result.errors.push(`Required variable "${varName}" is empty or missing`);
      }
    }
  }

  // Check warn_if_empty variables
  if (validation.warn_if_empty) {
    for (const varName of validation.warn_if_empty) {
      if (!vars[varName] || vars[varName].trim() === "") {
        result.warnings.push(`Variable "${varName}" is empty`);
      }
    }
  }

  return result;
}
