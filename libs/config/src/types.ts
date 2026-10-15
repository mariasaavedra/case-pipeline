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

// =============================================================================
// Case timeline (config/timeline.yaml)
// =============================================================================

export type TimelineTrack = "court" | "uscis" | "fees" | "meetings" | "notes";
export type TimelineKind =
  | "milestone" | "filing" | "decision" | "hearing" | "deadline" | "meeting" | "call" | "note";
/** Milestones that need more than a date + label — implemented in libs/query/src/case-timeline.ts. */
export type TimelineRule =
  | "court_outcome" | "calendaring" | "appeal" | "motion" | "rfe" | "appointment" | "contract";

export interface TimelineMilestoneConfig {
  /** Logical column key from boards.yaml (the key in column_values). */
  column: string;
  kind: TimelineKind;
  /** Template: {col}, {col|fallback}, {status}, {who}. */
  label: string;
  detail?: string;
}

export interface TimelineBoardConfig {
  track: TimelineTrack;
  rule?: TimelineRule;
  /** Skip items whose name contains this text. */
  skip_name?: string;
  milestones?: TimelineMilestoneConfig[];
}

export interface TimelineActivityConfig {
  track: TimelineTrack;
  kind: TimelineKind;
  /** Template: {first} = the entry's first line. Omitted = the first line itself. */
  label?: string;
  /** Regex: entries matching it go on the USCIS track instead. */
  uscis_if?: string;
  /** Regex: entries matching it are not milestones (chat logged under the type). */
  skip_if?: string;
}

export interface TimelineConfig {
  /** Keyed by board key; a key ending in `*` matches every board with that prefix. */
  boards: Record<string, TimelineBoardConfig>;
  contracts?: TimelineBoardConfig;
  /** Keyed by Emails & Activities type name. */
  activities: Record<string, TimelineActivityConfig>;
}
