// =============================================================================
// Configuration type definitions
// =============================================================================

// Column resolution strategies
export type ColumnResolveStrategy = "by_type" | "by_title" | "by_id";

export interface ColumnResolution {
  resolve: ColumnResolveStrategy;
  type?: string;           // For by_type
  pattern?: string;        // For by_title (regex pattern)
  types?: string[];        // Optional: only match columns of these types
  id?: string;             // For by_id (exact match)
  fallback?: ColumnResolution;
}

export interface BoardConfig {
  id: string;
  name: string;
  columns: Record<string, ColumnResolution>;
}

export interface VariableSource {
  source: "item.name" | "item.id" | "item.board.id" | "item.board.name" |
          "item.group.id" | "item.group.title" | "column";
  column?: string;  // Column key from board config (when source is "column")
}

export interface TemplateValidation {
  required?: string[];
  warn_if_empty?: string[];
}

export interface TemplateConfig {
  path: string;
  description?: string;
  source_board: string;
  variables: Record<string, VariableSource>;
  validation?: TemplateValidation;
}

export interface AppConfig {
  boards: Record<string, BoardConfig>;
  templates: Record<string, TemplateConfig>;
}
