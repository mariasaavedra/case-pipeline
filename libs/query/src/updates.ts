// =============================================================================
// Client Timeline Query (updates/replies + Emails & Activities, unified)
// =============================================================================

import type BetterSqlite3 from "better-sqlite3";
type Database = BetterSqlite3.Database;
import type {
  ClientUpdate,
  ClientUpdateAttachment,
  TimelineSourceType,
  TimelineCategory,
  TimelineDateRange,
} from "./types";

interface UpdateRow {
  local_id: string;
  profile_local_id: string;
  board_item_local_id: string | null;
  board_key: string | null;
  author_name: string;
  author_email: string | null;
  title: string | null;
  text_body: string;
  body_html: string | null;
  source_type: string;
  activity_type_name: string | null;
  reply_to_update_id: string | null;
  created_at_source: string;
  attachments: string | null;
}

const SELECT_COLUMNS = `local_id, profile_local_id, board_item_local_id, board_key,
              author_name, author_email, title, text_body, body_html,
              source_type, activity_type_name, reply_to_update_id, created_at_source, attachments`;

function mapRow(row: UpdateRow): ClientUpdate {
  return {
    localId: row.local_id,
    profileLocalId: row.profile_local_id,
    boardItemLocalId: row.board_item_local_id,
    boardKey: row.board_key,
    authorName: row.author_name,
    authorEmail: row.author_email,
    title: row.title,
    textBody: row.text_body,
    bodyHtml: row.body_html,
    sourceType: row.source_type as TimelineSourceType,
    activityTypeName: row.activity_type_name,
    replyToUpdateId: row.reply_to_update_id,
    createdAtSource: row.created_at_source,
    attachments: parseAttachments(row.attachments),
  };
}

/** Parse the stored attachments JSON, tolerating null/legacy/corrupt values. */
function parseAttachments(raw: string | null): ClientUpdateAttachment[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ClientUpdateAttachment[]) : [];
  } catch {
    return [];
  }
}

/**
 * Build a `source_type IN (...)` clause + params for an optional type filter.
 * Empty/undefined means "no filter" — the unified timeline.
 */
function typeFilter(types?: TimelineSourceType[]): { clause: string; params: string[] } {
  if (!types || types.length === 0) return { clause: "", params: [] };
  const placeholders = types.map(() => "?").join(",");
  return { clause: ` AND source_type IN (${placeholders})`, params: types };
}

/**
 * Build a WHERE fragment for a timeline category. This mirrors the web's
 * `matchesFilter` (UpdatesTimeline.tsx) in SQL so a filtered view returns the
 * complete set for that category, not just whatever survives filtering the
 * newest page.
 *
 * `notes` is "not an email" — deliberately defined by exclusion, so a new
 * source type appearing in the mirror shows up under Notes by default instead
 * of vanishing from every view until someone adds it to an allow-list.
 * `source_type` is NOT NULL in the schema, so a plain `<>` is safe here.
 */
function categoryFilter(category?: TimelineCategory): { clause: string; params: string[] } {
  switch (category) {
    case undefined:
    case "all":
      return { clause: "", params: [] };
    case "notes":
      return { clause: " AND source_type <> 'email'", params: [] };
  }
}

/** The day after `yyyyMmDd`, so an inclusive `to` can be compared exclusively. */
function nextDay(yyyyMmDd: string): string {
  const d = new Date(`${yyyyMmDd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Bound the query to a calendar-day range. `created_at_source` holds an ISO
 * timestamp, so a lexicographic compare against `YYYY-MM-DD` works and keeps
 * `idx_updates_created` usable: `'2026-03-01' <= '2026-03-01T09:12:00Z'` is
 * true because the date is a prefix, and the upper bound is exclusive against
 * the following day.
 *
 * The comparison is therefore in UTC, matching how the timestamps are stored.
 * An entry made late at night can land on the neighbouring day relative to the
 * date shown in the UI — the same approximation the previous "Last 30 days"
 * toggle made, and not worth a timezone column to fix.
 */
function dateRangeFilter(range?: TimelineDateRange): { clause: string; params: string[] } {
  if (!range?.from && !range?.to) return { clause: "", params: [] };
  const parts: string[] = [];
  const params: string[] = [];
  if (range.from) {
    parts.push(" AND created_at_source >= ?");
    params.push(range.from);
  }
  if (range.to) {
    parts.push(" AND created_at_source < ?");
    params.push(nextDay(range.to));
  }
  return { clause: parts.join(""), params };
}

/**
 * Batch-fetch timeline entries for multiple profiles in one query.
 * Returns a Map keyed by profileLocalId; each list is ordered newest-first
 * and capped at limitPerProfile entries. Pass `types` to restrict to specific
 * sources (e.g. only emails); omit for the unified timeline.
 */
export function batchGetClientUpdates(
  db: Database,
  profileLocalIds: string[],
  limitPerProfile: number,
  types?: TimelineSourceType[]
): Map<string, ClientUpdate[]> {
  if (profileLocalIds.length === 0) return new Map();

  const placeholders = profileLocalIds.map(() => "?").join(",");
  const filter = typeFilter(types);
  const rows = db
    .prepare(
      `SELECT ${SELECT_COLUMNS}
       FROM client_updates
       WHERE profile_local_id IN (${placeholders})${filter.clause}
       ORDER BY profile_local_id, created_at_source DESC`
    )
    .all(...profileLocalIds, ...filter.params) as UpdateRow[];

  const result = new Map<string, ClientUpdate[]>();
  for (const row of rows) {
    let list = result.get(row.profile_local_id);
    if (!list) {
      list = [];
      result.set(row.profile_local_id, list);
    }
    if (list.length < limitPerProfile) {
      list.push(mapRow(row));
    }
  }
  return result;
}

/**
 * Get a client's unified timeline, ordered newest first. Pass `types` to
 * restrict to specific sources (e.g. `["email", "note"]`); omit for everything.
 */
export function getClientUpdates(
  db: Database,
  profileLocalId: string,
  limit = 50,
  offset = 0,
  types?: TimelineSourceType[],
  category?: TimelineCategory,
  range?: TimelineDateRange
): ClientUpdate[] {
  // A category (from the timeline chips) takes precedence over a raw type list:
  // it filters by the exact same rule the web uses, computed server-side so a
  // filtered view is complete rather than "the newest page, then filtered".
  const filter =
    category && category !== "all" ? categoryFilter(category) : typeFilter(types);
  // The date bound is applied server-side for the same reason: `limit` caps the
  // NEWEST rows, so filtering a date range client-side would silently return
  // nothing for an older range on a busy profile.
  const dates = dateRangeFilter(range);
  const rows = db
    .prepare(
      `SELECT ${SELECT_COLUMNS}
       FROM client_updates
       WHERE profile_local_id = ?${filter.clause}${dates.clause}
       ORDER BY created_at_source DESC
       LIMIT ? OFFSET ?`
    )
    .all(profileLocalId, ...filter.params, ...dates.params, limit, offset) as UpdateRow[];

  return rows.map(mapRow);
}
