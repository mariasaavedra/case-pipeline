// =============================================================================
// sms_messages (users.db v13) — one row per text, dry runs included
// =============================================================================

import { usersDb } from "../db/users-db.js";

export interface SmsLogEntry {
  userId: number | null;
  toNumber: string;
  body: string;
  templateKey: string | null;
  language: string | null;
  context: string;
  profileLocalId: string | null;
  profileMondayId: string | null;
  mode: "dry-run" | "on";
  rcMessageId: string | null;
  status: string;
  error: string | null;
}

export function recordSms(e: SmsLogEntry): number {
  const r = usersDb
    .prepare(
      `INSERT INTO sms_messages
         (user_id, to_number, body, template_key, language, context, profile_local_id, profile_monday_id,
          mode, rc_message_id, status, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      e.userId, e.toNumber, e.body, e.templateKey, e.language, e.context, e.profileLocalId, e.profileMondayId,
      e.mode, e.rcMessageId, e.status, e.error,
    );
  return Number(r.lastInsertRowid);
}

/**
 * Was this exact text sent to this number in the last `seconds`? Guards a
 * double click (or a retry after a slow response) from texting a client twice.
 */
export function recentlySent(toNumber: string, body: string, seconds = 120): boolean {
  return !!usersDb
    .prepare(
      `SELECT 1 FROM sms_messages
        WHERE to_number = ? AND body = ? AND error IS NULL
          AND created_at >= datetime('now', ?)`,
    )
    .get(toNumber, body, `-${seconds} seconds`);
}

export interface SmsHistoryRow {
  id: number;
  createdAt: string;
  toNumber: string;
  body: string;
  templateKey: string | null;
  context: string;
  mode: string;
  status: string;
  error: string | null;
  senderName: string | null;
}

/** Texts sent to a profile, newest first. */
export function smsHistoryForProfile(profileMondayId: string, limit = 50): SmsHistoryRow[] {
  return usersDb
    .prepare(
      `SELECT m.id, m.created_at AS createdAt, m.to_number AS toNumber, m.body, m.template_key AS templateKey,
              m.context, m.mode, m.status, m.error, u.name AS senderName
         FROM sms_messages m LEFT JOIN users u ON u.id = m.user_id
        WHERE m.profile_monday_id = ?
        ORDER BY m.id DESC LIMIT ?`,
    )
    .all(profileMondayId, limit) as SmsHistoryRow[];
}
