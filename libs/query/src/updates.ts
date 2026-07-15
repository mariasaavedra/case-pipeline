// =============================================================================
// Client Timeline Query (updates/replies + Emails & Activities, unified)
// =============================================================================

import type BetterSqlite3 from "better-sqlite3";
type Database = BetterSqlite3.Database;
import type { ClientUpdate, TimelineSourceType } from "./types";

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
}

const SELECT_COLUMNS = `local_id, profile_local_id, board_item_local_id, board_key,
              author_name, author_email, title, text_body, body_html,
              source_type, activity_type_name, reply_to_update_id, created_at_source`;

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
  };
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
  types?: TimelineSourceType[]
): ClientUpdate[] {
  const filter = typeFilter(types);
  const rows = db
    .prepare(
      `SELECT ${SELECT_COLUMNS}
       FROM client_updates
       WHERE profile_local_id = ?${filter.clause}
       ORDER BY created_at_source DESC
       LIMIT ? OFFSET ?`
    )
    .all(profileLocalId, ...filter.params, limit, offset) as UpdateRow[];

  return rows.map(mapRow);
}
