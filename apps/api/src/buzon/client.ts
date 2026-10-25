// =============================================================================
// Buzón — one client: contact details, their switches, their link
// =============================================================================
// buzon_client_settings (schema v39) holds "no automatic texts" and the
// client's own reminder plan; the link is upload_links. A link made here keeps
// its token encrypted (token_enc, APP_ENCRYPTION_KEY) so the reminders can send
// it again — the hash alone can't. Without the key, reminders and Remind now
// need a new link (they say so). docs/features/buzon.md.
// =============================================================================

import type BetterSqlite3 from "better-sqlite3";
type DatabaseInstance = BetterSqlite3.Database;
import { readTextingContact } from "@case-pipeline/query";
import { firstNameOf, toUsE164 } from "@case-pipeline/core";
import { appEncryptionKey, decryptString, encryptString } from "../crypto/secrets.js";
import { clientUploadsConfig, hashToken, newToken, sqliteUtc, DEFAULT_LINK_DAYS, type Language } from "../uploads/rules.js";
import { clientLanguage, type ClientBuzonSettings, NO_CLIENT_SETTINGS } from "./rules.js";
import { sanitizeDays } from "./settings.js";

export interface BuzonClient {
  localId: string;
  mondayId: string | null;
  name: string;
  firstName: string;
  /** E.164 US number, else null. */
  phone: string | null;
  language: Language;
}

export const profileKey = (p: { localId: string; mondayId: string | null }) => p.mondayId ?? `local:${p.localId}`;

export function buzonClient(db: DatabaseInstance, localId: string): BuzonClient | null {
  const row = db.prepare(
    "SELECT local_id AS localId, monday_item_id AS mondayId, name, phone, raw_column_values AS raw FROM profiles WHERE local_id = ? AND deleted_at IS NULL",
  ).get(localId) as { localId: string; mondayId: string | null; name: string; phone: string | null; raw: string | null } | undefined;
  if (!row) return null;
  const contact = readTextingContact(row.raw);
  return {
    localId: row.localId,
    mondayId: row.mondayId,
    name: row.name,
    firstName: contact.firstName || firstNameOf(row.name),
    phone: (row.phone && toUsE164(row.phone)) || (contact.phone2 && toUsE164(contact.phone2)) || null,
    language: clientLanguage(contact.preferredLanguage),
  };
}

/** By Monday id first: a re-sync gives the profile a new local id. */
export function buzonClientByMondayId(db: DatabaseInstance, mondayId: string): BuzonClient | null {
  const row = db.prepare("SELECT local_id FROM profiles WHERE monday_item_id = ? AND deleted_at IS NULL").get(mondayId) as { local_id: string } | undefined;
  return row ? buzonClient(db, row.local_id) : null;
}

// --- Switches --------------------------------------------------------------------

export function clientSettings(db: DatabaseInstance, p: { localId: string; mondayId: string | null }): ClientBuzonSettings {
  const row = db.prepare("SELECT * FROM buzon_client_settings WHERE profile_key = ?").get(profileKey(p)) as
    | { no_auto_texts: number; reminders: string | null; reminder_days: string | null }
    | undefined;
  if (!row) return { ...NO_CLIENT_SETTINGS };
  let days: number[] | null = null;
  try {
    days = row.reminder_days ? sanitizeDays(JSON.parse(row.reminder_days)) : null;
  } catch { /* unreadable: none */ }
  return {
    noAutoTexts: row.no_auto_texts === 1,
    reminders: row.reminders === "off" || row.reminders === "custom" ? row.reminders : null,
    days,
  };
}

export function saveClientSettings(
  db: DatabaseInstance,
  p: { localId: string; mondayId: string | null },
  s: ClientBuzonSettings,
  by: string | null,
): ClientBuzonSettings {
  const days = s.reminders === "custom" ? sanitizeDays(s.days) : null;
  db.prepare(`
    INSERT INTO buzon_client_settings (profile_key, no_auto_texts, reminders, reminder_days, updated_by_name, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(profile_key) DO UPDATE SET no_auto_texts = excluded.no_auto_texts, reminders = excluded.reminders,
      reminder_days = excluded.reminder_days, updated_by_name = excluded.updated_by_name, updated_at = excluded.updated_at
  `).run(profileKey(p), s.noAutoTexts ? 1 : 0, s.reminders, days ? JSON.stringify(days) : null, by);
  return clientSettings(db, p);
}

// --- The link --------------------------------------------------------------------

export interface ActiveLink {
  id: number;
  /** The full link, when its token can be read back (token_enc); else null. */
  url: string | null;
  createdAt: string;
}

const linkClause = (p: { localId: string; mondayId: string | null }) =>
  p.mondayId
    ? { sql: "(profile_monday_id = ? OR profile_local_id = ?)", args: [p.mondayId, p.localId] }
    : { sql: "profile_local_id = ?", args: [p.localId] };

/** Encrypted for keeping, or null when there is no APP_ENCRYPTION_KEY (then nothing is kept). */
export function sealToken(token: string): string | null {
  return appEncryptionKey() ? encryptString(token) : null;
}

export function activeLink(db: DatabaseInstance, p: { localId: string; mondayId: string | null }): ActiveLink | null {
  const who = linkClause(p);
  const row = db.prepare(
    `SELECT id, token_enc, created_at FROM upload_links
      WHERE ${who.sql} AND revoked_at IS NULL AND expires_at > datetime('now') ORDER BY id DESC LIMIT 1`,
  ).get(...who.args) as { id: number; token_enc: string | null; created_at: string } | undefined;
  if (!row) return null;
  const config = clientUploadsConfig();
  let url: string | null = null;
  if (config && row.token_enc && appEncryptionKey()) {
    try {
      url = `${config.publicUrl}/u/${decryptString(row.token_enc)}`;
    } catch { /* key changed: treat as unreadable */ }
  }
  return { id: row.id, url, createdAt: row.created_at };
}

/**
 * The client's link to text: the active one when it can be read back, else a
 * new one (which turns the old one off, as M30 does). null when uploads are off.
 */
export function ensureLink(
  db: DatabaseInstance,
  client: BuzonClient,
  by: string | null,
): { id: number; url: string; made: boolean } | null {
  const config = clientUploadsConfig();
  if (!config) return null;
  const current = activeLink(db, client);
  if (current?.url) {
    // A reused link gets its 30 days back, so a reminder never points at one about to lapse.
    db.prepare("UPDATE upload_links SET expires_at = MAX(expires_at, ?) WHERE id = ?")
      .run(sqliteUtc(new Date(Date.now() + DEFAULT_LINK_DAYS * 86_400_000)), current.id);
    return { id: current.id, url: current.url, made: false };
  }
  const token = newToken();
  const who = linkClause(client);
  const id = db.transaction(() => {
    db.prepare(
      `UPDATE upload_links SET revoked_at = datetime('now'), revoked_by_name = ?
        WHERE ${who.sql} AND revoked_at IS NULL AND expires_at > datetime('now')`,
    ).run(by, ...who.args);
    return Number(db.prepare(`
      INSERT INTO upload_links (profile_local_id, profile_monday_id, token_hash, language, created_by_name, expires_at, token_enc)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      client.localId, client.mondayId, hashToken(token), client.language, by,
      sqliteUtc(new Date(Date.now() + DEFAULT_LINK_DAYS * 86_400_000)), sealToken(token),
    ).lastInsertRowid);
  })();
  return { id, url: `${config.publicUrl}/u/${token}`, made: true };
}
