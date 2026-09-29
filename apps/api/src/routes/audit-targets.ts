import type BetterSqlite3 from "better-sqlite3";

export interface AuditTarget {
  /** The profile or board item's name, as synced. */
  name: string;
  /** Board key for a board item; null when the target is the profile itself. */
  boardKey: string | null;
  /** Local id of the client the target belongs to — what the Client 360 link uses. */
  profileLocalId: string | null;
}

/**
 * Resolve audit targets (stable Monday ids) to something a reader recognises:
 * a profile, or a board item plus the client it hangs off. Ids that no longer
 * resolve (deleted in Monday) are simply absent — the log still shows the row.
 */
export function resolveAuditTargets(caseDb: BetterSqlite3.Database, mondayItemIds: string[]): Map<string, AuditTarget> {
  const ids = [...new Set(mondayItemIds)];
  const out = new Map<string, AuditTarget>();
  if (ids.length === 0) return out;
  const placeholders = ids.map(() => "?").join(",");

  const profiles = caseDb
    .prepare(`SELECT monday_item_id, local_id, name FROM profiles WHERE monday_item_id IN (${placeholders})`)
    .all(...ids) as { monday_item_id: string; local_id: string; name: string }[];
  for (const p of profiles) out.set(p.monday_item_id, { name: p.name, boardKey: null, profileLocalId: p.local_id });

  const items = caseDb
    .prepare(
      `SELECT b.monday_item_id, b.name, b.board_key, b.profile_local_id, p.name AS profile_name
       FROM board_items b LEFT JOIN profiles p ON p.local_id = b.profile_local_id
       WHERE b.monday_item_id IN (${placeholders})`,
    )
    .all(...ids) as {
      monday_item_id: string;
      name: string;
      board_key: string;
      profile_local_id: string | null;
      profile_name: string | null;
    }[];
  for (const b of items) {
    if (out.has(b.monday_item_id)) continue;
    out.set(b.monday_item_id, {
      // Board items are usually already named "<client> - <form>"; only prefix the client when it isn't.
      name: b.profile_name && !b.name.startsWith(b.profile_name) ? `${b.profile_name} · ${b.name}` : b.name,
      boardKey: b.board_key,
      profileLocalId: b.profile_local_id,
    });
  }
  return out;
}
