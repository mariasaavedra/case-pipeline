// =============================================================================
// Client Updates Query
// =============================================================================

import type { Database } from "bun:sqlite";
import type { ClientUpdate } from "./types";

interface UpdateRow {
  local_id: string;
  profile_local_id: string;
  board_item_local_id: string | null;
  board_key: string | null;
  author_name: string;
  author_email: string | null;
  text_body: string;
  body_html: string | null;
  source_type: string;
  reply_to_update_id: string | null;
  created_at_source: string;
}

/**
 * Get all updates for a client, ordered newest first.
 */
export function getClientUpdates(
  db: Database,
  profileLocalId: string,
  limit = 50,
  offset = 0
): ClientUpdate[] {
  const rows = db
    .query(
      `SELECT local_id, profile_local_id, board_item_local_id, board_key,
              author_name, author_email, text_body, body_html,
              source_type, reply_to_update_id, created_at_source
       FROM client_updates
       WHERE profile_local_id = ?
       ORDER BY created_at_source DESC
       LIMIT ? OFFSET ?`
    )
    .all(profileLocalId, limit, offset) as UpdateRow[];

  return rows.map((row) => ({
    localId: row.local_id,
    profileLocalId: row.profile_local_id,
    boardItemLocalId: row.board_item_local_id,
    boardKey: row.board_key,
    authorName: row.author_name,
    authorEmail: row.author_email,
    textBody: row.text_body,
    bodyHtml: row.body_html,
    sourceType: row.source_type as "update" | "reply",
    replyToUpdateId: row.reply_to_update_id,
    createdAtSource: row.created_at_source,
  }));
}
