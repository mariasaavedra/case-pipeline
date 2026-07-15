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

export interface MondayUpdateCreator {
  name: string;
  email: string;
}

export interface MondayReply {
  id: string;
  body: string;
  created_at: string;
  creator: MondayUpdateCreator | null;
}

export interface MondayUpdate {
  id: string;
  body: string;
  created_at: string;
  creator: MondayUpdateCreator | null;
  replies: MondayReply[];
}

// -----------------------------------------------------------------------------
// Emails & Activities (E&A) timeline — CRM entity boards, API version 2024-10+.
// -----------------------------------------------------------------------------

export interface MondayTimelineUser {
  id: string;
  name: string;
}

/** One entry in a Monday.com item's E&A timeline (email, note, call, activity). */
export interface MondayTimelineItem {
  id: string;
  /** email | note | activity | custom (raw Monday value). */
  type: string;
  title: string | null;
  content: string | null;
  created_at: string;
  /** Set when type=custom; resolve to a name via the custom_activity map. */
  custom_activity_id: string | null;
  user: MondayTimelineUser | null;
}

/** A custom activity type defined in the account (Consult note, Deadline, …). */
export interface MondayCustomActivity {
  id: string;
  name: string;
  color: string | null;
  icon_id: string | null;
}
