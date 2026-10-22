// =============================================================================
// E&A timeline entries → client_updates (the sync's Pass 4)
// =============================================================================
// One logical event surfaces on the profile AND its connected board items, each
// with a different monday_timeline_id, so content_sig (created_at + author +
// body) is what keeps one row per event per profile — INSERT OR IGNORE against
// its unique index.
//
// Full text. timeline_items_page hands back a ~250-char plain-text PREVIEW of
// each entry; only timeline_item(id:) has all of it. content_sig stays built
// from the preview — the dedup identity every stored row already carries — and
// only the stored text is swapped for the full entry. A row is still on its
// preview while its body_html is no longer than the page's content. Emails are
// left as previews: Monday returns only the preview (or null) for an email even
// by id (checked 2026-10-22) — the whole message lives in Outlook. Capped per
// run (`budget`) so a full sync over a backlog can't eat the account's 10,000
// calls/day; `npm run ea:full-text` does the bulk.
// =============================================================================

import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  fetchTimelineItemContents,
  mayBeTimelinePreview,
  normalizeEmailMetadata,
  type MondayTimelineItem,
} from "@case-pipeline/monday";

export type ItemMeta = { profile_local_id: string; board_item_local_id: string | null; board_key: string | null };
export type TimelineMap = Map<string, MondayTimelineItem[]>;

const US = "\x1f";

/**
 * Content signature (must match the SQL backfill in schema migration v14):
 * created_at + author + first 300 chars of the stripped body, \x1f-joined.
 */
export function contentSig(createdAt: string, author: string, strippedBody: string): string {
  return `${createdAt}${US}${author}${US}${strippedBody.slice(0, 300)}`;
}

export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/﻿/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function timelineWriter(
  db: Database.Database,
  opts: {
    batchId: number;
    itemMeta: Map<string, ItemMeta>;
    activityNames: Map<string, string>;
    /** Most entries to fetch in full this run. */
    budget: number;
    fetchContents?: (ids: string[]) => Promise<Map<string, string>>;
  },
) {
  const fetchContents = opts.fetchContents ?? ((ids: string[]) => fetchTimelineItemContents(ids));
  let budget = opts.budget;
  const totals = { inserted: 0, fullText: 0 };

  const insertTimelineItem = db.prepare(`
    INSERT OR IGNORE INTO client_updates (
      batch_id, local_id, monday_timeline_id, profile_local_id,
      board_item_local_id, board_key, author_name, author_email,
      title, text_body, body_html, source_type, activity_type_name, content_sig,
      created_at_source, raw_json, sync_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced')
  `);
  // An email's sender/recipients (TimelineItem.metadata, API 2026-07+).
  const setEmailParticipants = db.prepare(`
    UPDATE client_updates SET email_participants = ?
    WHERE profile_local_id = ? AND content_sig = ?
  `);
  const storedBodyHtml = db
    .prepare(`SELECT body_html FROM client_updates WHERE profile_local_id = ? AND content_sig = ?`)
    .pluck();
  const setFullText = db.prepare(`
    UPDATE client_updates SET text_body = ?, body_html = ?
    WHERE profile_local_id = ? AND content_sig = ? AND body_html IS NOT ?
  `);

  const sigOf = (item: MondayTimelineItem) =>
    contentSig(item.created_at, item.user?.name ?? "Unknown", stripHtml(item.content ?? ""));

  /**
   * The full text of these entries still on their preview, keyed by profile +
   * content_sig: one fetch per logical event, whichever surface it came from.
   * A failed fetch keeps the previews; the next sync tries again.
   */
  async function fullTextFor(timelineMap: TimelineMap): Promise<Map<string, string>> {
    const wanted = new Map<string, string>(); // profile␟sig → timeline item id
    for (const [mondayItemId, items] of timelineMap) {
      const meta = opts.itemMeta.get(mondayItemId);
      if (!meta) continue;
      for (const item of items) {
        const preview = item.content ?? "";
        if (item.type === "email" || !mayBeTimelinePreview(preview)) continue;
        const sig = sigOf(item);
        const key = `${meta.profile_local_id}${US}${sig}`;
        if (wanted.has(key)) continue;
        const stored = storedBodyHtml.get(meta.profile_local_id, sig) as string | null | undefined;
        if (stored && stored.length > preview.length) continue; // already full
        wanted.set(key, item.id);
      }
    }
    const full = new Map<string, string>();
    const picked = [...wanted].slice(0, Math.max(0, budget));
    if (!picked.length) return full;
    budget -= picked.length;
    try {
      const contents = await fetchContents(picked.map(([, id]) => id));
      for (const [key, id] of picked) {
        const html = contents.get(id);
        if (html && html.trim() !== "") full.set(key, html);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`\n  [E&A] full text unavailable, keeping previews (${msg.slice(0, 120)})`);
    }
    return full;
  }

  /** Store one batch; `full` from fullTextFor. */
  function insert(timelineMap: TimelineMap, full = new Map<string, string>()): void {
    db.transaction(() => {
      for (const [mondayItemId, items] of timelineMap) {
        const meta = opts.itemMeta.get(mondayItemId);
        if (!meta) continue;
        for (const item of items) {
          const author = item.user?.name ?? "Unknown";
          // Identity from the page's preview, text from the full entry when fetched.
          const sig = sigOf(item);
          const fullHtml = full.get(`${meta.profile_local_id}${US}${sig}`);
          const html = fullHtml ?? item.content ?? "";
          const stripped = stripHtml(html);
          const activityName = item.custom_activity_id ? opts.activityNames.get(item.custom_activity_id) ?? null : null;
          const res = insertTimelineItem.run(
            opts.batchId, randomUUID(), item.id,
            meta.profile_local_id, meta.board_item_local_id, meta.board_key,
            author, null,
            item.title ?? null, stripped, html || null,
            item.type, activityName, sig,
            item.created_at, JSON.stringify(item),
          );
          if (res.changes > 0) totals.inserted++;
          // New rows already carry it; one stored earlier from the preview is upgraded.
          if (fullHtml && (res.changes > 0 || setFullText.run(stripped, fullHtml, meta.profile_local_id, sig, fullHtml).changes > 0)) {
            totals.fullText++;
          }
          // Written by UPDATE, not in the INSERT: INSERT OR IGNORE skips the
          // rows already mirrored, and those are exactly the ones a full
          // sync must backfill. Keyed like the dedup index, so it lands on
          // whichever surface's row survived.
          const participants = normalizeEmailMetadata(item.metadata);
          if (participants) setEmailParticipants.run(JSON.stringify(participants), meta.profile_local_id, sig);
        }
      }
    })();
  }

  return { fullTextFor, insert, totals };
}
