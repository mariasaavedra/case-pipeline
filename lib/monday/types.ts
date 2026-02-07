// =============================================================================
// Shared TypeScript types for Monday.com API
// =============================================================================

export interface MondayColumn {
  id: string;
  title: string;
  type: string;
  settings_str: string;
}

export interface MondayBoard {
  id: string;
  name: string;
  columns: MondayColumn[];
  groups: { id: string; title: string }[];
}

export interface MondayColumnValue {
  id: string;
  text: string | null;
  display_value?: string;
  linked_item_ids?: string[];
  linked_items?: MondayItem[];
}

export interface MondayItem {
  id: string;
  name: string;
  board?: {
    id: string;
    name: string;
  };
  group?: {
    id: string;
    title: string;
  };
  column_values: MondayColumnValue[];
}

export interface ColumnLabels {
  [key: string]: string;
}
