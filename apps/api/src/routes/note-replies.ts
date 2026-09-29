// =============================================================================
// Sub-notes — where a reply to a timeline entry goes in Monday
// =============================================================================
// Monday threads replies only under updates (create_update's parent_id), one
// level deep. So:
//   - a Monday update → a real Monday reply under it;
//   - a reply → a reply under the same thread root (Monday has no deeper nesting);
//   - an E&A entry (email / note / activity) → Monday has no reply API for
//     timeline items, so the sub-note goes out as an update on the SAME item,
//     prefixed "Re: <entry> (<date>) —" so it reads as a reply in Monday's
//     Updates tab.
// Locally every sub-note is a `reply` row whose reply_to_update_id is the
// root's Monday id (update id or timeline id); the query layer resolves that
// to parentLocalId for threading (libs/query/src/updates.ts).
// =============================================================================

import type BetterSqlite3 from "better-sqlite3";
type DatabaseInstance = BetterSqlite3.Database;

export interface ReplyRoot {
  local_id: string;
  batch_id: number;
  profile_local_id: string;
  board_item_local_id: string | null;
  board_key: string | null;
  monday_update_id: string | null;
  monday_timeline_id: string | null;
  reply_to_update_id: string | null;
  source_type: string;
  title: string | null;
  activity_type_name: string | null;
  created_at_source: string;
}

export type ReplyPlan =
  | { ok: false; status: 404 | 409 | 400; error: string }
  | {
      ok: true;
      /** The thread root the sub-note hangs under. */
      root: ReplyRoot;
      /** The root's Monday id — stored as the reply's reply_to_update_id. */
      rootMondayId: string;
      /** The Monday item the update is posted on. */
      mondayItemId: string;
      /** Board of `mondayItemId` for a deep link; null means the Profiles board. */
      mondayBoardId: string | null;
      /** Monday parent update id; undefined for an E&A root (posted top-level). */
      parentId: string | undefined;
      /** The text posted to Monday (prefixed for an E&A root). */
      body: string;
      isEa: boolean;
    };

const ENTRY_COLS = `local_id, batch_id, profile_local_id, board_item_local_id, board_key,
  monday_update_id, monday_timeline_id, reply_to_update_id, source_type,
  title, activity_type_name, created_at_source`;

/** Decide where a sub-note on `parentLocalId` goes. Reads only; writes nothing. */
export function planReply(db: DatabaseInstance, parentLocalId: string, text: string): ReplyPlan {
  const target = db
    .prepare(`SELECT ${ENTRY_COLS} FROM client_updates WHERE local_id = ?`)
    .get(parentLocalId) as ReplyRoot | undefined;
  if (!target) return { ok: false, status: 404, error: "Timeline entry not found" };

  // Replying to a reply lands in the same thread, under its root.
  let root = target;
  if (target.reply_to_update_id) {
    const found = db
      .prepare(
        `SELECT ${ENTRY_COLS} FROM client_updates
         WHERE profile_local_id = ? AND (monday_update_id = ? OR monday_timeline_id = ?) LIMIT 1`,
      )
      .get(target.profile_local_id, target.reply_to_update_id, target.reply_to_update_id) as ReplyRoot | undefined;
    if (found) root = found;
  }

  const rootMondayId = root.monday_update_id ?? root.monday_timeline_id;
  if (!rootMondayId) {
    return { ok: false, status: 409, error: "This note hasn't reached Monday yet — try again once it syncs" };
  }
  const isEa = root.monday_update_id == null;

  // The Monday item the entry lives on: its board item, else the profile.
  const item = root.board_item_local_id
    ? (db.prepare("SELECT monday_item_id FROM board_items WHERE local_id = ?").get(root.board_item_local_id) as
        { monday_item_id: string | null } | undefined)
    : (db.prepare("SELECT monday_item_id FROM profiles WHERE local_id = ?").get(root.profile_local_id) as
        { monday_item_id: string | null } | undefined);
  const mondayItemId = item?.monday_item_id;
  if (!mondayItemId) {
    return { ok: false, status: 400, error: "The note's Monday item isn't known — cannot post a sub-note" };
  }

  // Same lookup the timeline query makes, so the new row links like the rest.
  const board = root.board_item_local_id && root.board_key
    ? (db.prepare("SELECT monday_board_id FROM board_columns WHERE board_key = ? LIMIT 1").get(root.board_key) as
        { monday_board_id: string } | undefined)
    : undefined;

  return {
    ok: true,
    root,
    rootMondayId,
    mondayItemId,
    mondayBoardId: board?.monday_board_id ?? null,
    parentId: isEa ? undefined : rootMondayId,
    body: isEa ? `${eaReplyPrefix(root)} ${text}` : text,
    isEa,
  };
}

/**
 * The header that makes an E&A sub-note read as a reply in Monday's Updates
 * tab, e.g. `Re: Casenote (Sep 12, 2026) —`. Uses the entry's subject when it
 * has one, else its activity name, else its kind.
 */
export function eaReplyPrefix(entry: Pick<ReplyRoot, "title" | "activity_type_name" | "source_type" | "created_at_source">): string {
  const kind = entry.source_type === "email" ? "Email" : entry.source_type === "note" ? "Note" : "Activity";
  const raw = (entry.title?.trim() || entry.activity_type_name?.trim() || kind).replace(/\s+/g, " ");
  const label = raw.length > 60 ? `${raw.slice(0, 57)}…` : raw;
  const d = new Date(entry.created_at_source);
  const date = Number.isNaN(d.getTime())
    ? ""
    : ` (${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })})`;
  return `Re: ${label}${date} —`;
}
