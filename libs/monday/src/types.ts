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
  /**
   * Monday's own last-modified stamp (ISO). Tracks column edits, NOT Emails &
   * Activities: a new email logged against an item leaves this untouched, which
   * is why E&A needs its own sweep rather than an updated_at watermark. See
   * scripts/phase0-updated-at.ts for the evidence.
   */
  updated_at?: string;
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

/** One selectable value of a Monday status/single-select column, with its
 * native color. `index` is Monday's internal label index (needed for writes). */
export interface StatusOption {
  index: number;
  label: string;
  color: string | null;
  border: string | null;
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

/** A file attached to a Monday.com update. `url` opens the asset in Monday
 * (requires a Monday session); `public_url` is short-lived so we don't persist it. */
export interface MondayAsset {
  id: string;
  name: string;
  url: string;
  url_thumbnail: string | null;
  file_extension: string | null;
  file_size: number | null;
}

export interface MondayUpdate {
  id: string;
  body: string;
  created_at: string;
  creator: MondayUpdateCreator | null;
  replies: MondayReply[];
  assets: MondayAsset[] | null;
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
