// =============================================================================
// E&A full text — replace stored 250-character previews with the whole entry
// =============================================================================
//   npm run ea:full-text                       dry run: counts, reads nothing from Monday
//   npm run ea:full-text -- --apply            fetch + store, newest entries first
//   … --limit=5000                             at most this many entries (default 25,000)
//   … --db=seed                                another database
//
// Monday's timeline_items_page returns every Emails & Activities entry as a
// ~250-character plain-text preview, and that is what the sync stored until
// 2026-10-22: about half of all E&A rows end mid-sentence. The sync now stores
// new entries in full (and upgrades up to EA_FULL_TEXT_PER_RUN old ones a run);
// this does the backlog. Only the text changes — content_sig, the dedup key,
// stays the preview's, so the sync keeps recognising every row. Emails are left
// out: Monday returns only the preview for an email, even by id.
//
// 12 entries per Monday call: 25,000 entries = ~2,100 calls of the account's
// 10,000/day (Zapier shares it). Counted as "ea-full-text" (Settings → Admin →
// Monday usage). Safe to stop and re-run: a row already in full is skipped.
// =============================================================================

import Database from "better-sqlite3";
import { setApiToken, fetchTimelineItemContents, TIMELINE_PREVIEW_LENGTH, TIMELINE_FULL_TEXT_BATCH } from "@case-pipeline/monday";
import { countMondayCalls } from "./lib/monday-usage.js";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const apply = process.argv.includes("--apply");
const limit = Number(arg("limit") ?? 25_000);
const dbPath = arg("db") === "seed" ? "data/seed.db" : "data/live.db";
/** Entries per write transaction (and per progress line). */
const CHUNK = 250;

// Matches the sync's stripHtml (scripts/sync/index.ts) so text_body has the
// same shape whichever wrote it.
function stripHtml(html: string): string {
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

const db = new Database(dbPath, { readonly: !apply, timeout: 10_000 });

// Same test as mayBeTimelinePreview, in SQL: long enough, and not HTML.
const rows = db
  .prepare(`
    SELECT id, monday_timeline_id AS timelineId, body_html AS preview
    FROM client_updates
    WHERE monday_timeline_id IS NOT NULL AND content_sig IS NOT NULL AND source_type <> 'email'
      AND length(trim(COALESCE(body_html, ''))) >= ?
      AND substr(ltrim(body_html), 1, 1) <> '<'
    ORDER BY created_at_source DESC
  `)
  .all(TIMELINE_PREVIEW_LENGTH) as Array<{ id: number; timelineId: string; preview: string }>;

const todo = rows.slice(0, limit);
console.log(`${apply ? "APPLY" : "DRY RUN"} — ${dbPath}`);
console.log(`  ${rows.length} E&A entries may be cut-short previews; this run: ${todo.length} (~${Math.ceil(todo.length / TIMELINE_FULL_TEXT_BATCH)} Monday calls)`);
if (!apply) process.exit(0);

const token = process.env.MONDAY_API_TOKEN;
if (!token) {
  console.error("MONDAY_API_TOKEN is not set.");
  process.exit(1);
}
setApiToken(token);
countMondayCalls("ea-full-text", dbPath);

// Only while the row still holds the preview it was picked with.
const update = db.prepare(`UPDATE client_updates SET text_body = ?, body_html = ? WHERE id = ? AND body_html = ?`);
const totals = { completed: 0, missing: 0 };

for (let i = 0; i < todo.length; i += CHUNK) {
  const chunk = todo.slice(i, i + CHUNK);
  const contents = await fetchTimelineItemContents(chunk.map((r) => r.timelineId));
  db.transaction(() => {
    for (const row of chunk) {
      const html = contents.get(row.timelineId);
      // Deleted in Monday, or out of this token's reach: keep the preview.
      if (!html) { totals.missing++; continue; }
      // Stored even when it was not cut: it is HTML, so it is not picked again.
      if (update.run(stripHtml(html), html, row.id, row.preview).changes > 0) totals.completed++;
    }
  })();
  process.stdout.write(`\r  ${Math.min(i + CHUNK, todo.length)}/${todo.length} — ${totals.completed} completed`);
}

console.log(`\n  ${totals.completed} stored in full, ${totals.missing} not returned by Monday (kept as previews)`);
