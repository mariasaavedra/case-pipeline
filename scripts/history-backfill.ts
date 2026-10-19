// =============================================================================
// History backfill — Monday's activity log → item_events (schema v36)
// =============================================================================
//   npm run history:backfill                   dry run: reads Monday, writes nothing
//   npm run history:backfill -- --apply        stores the history in live.db
//   … --boards=calendaring,court_cases         only these boards (boards.yaml keys)
//
// item_events has every change since the webhooks started (2026-08-10). Monday
// keeps each board's activity log since the board was created, so this pages
// through it per board, up to that board's first webhook-era event (so the two
// never overlap; a board with none yet goes up to now), and stores the changes
// to items: column changes, renames, new items, group moves, archive / delete /
// restore. Left out: subscribe / owner noise and board housekeeping (views,
// column settings), and the Call Log board (calls, not case history).
//
// Safe to stop and re-run: an entry already stored (same activity log id) is
// skipped. Monday calls are counted as "history-backfill" (Settings → Sync
// health); expect a few hundred, well under the 10,000/day account limit.
// =============================================================================

import Database from "better-sqlite3";
import { loadBoardsConfig } from "@case-pipeline/config";
import { mondayRequest, setApiToken } from "@case-pipeline/monday";
import { countMondayCalls } from "./lib/monday-usage.js";
import { walkActivityLog } from "./lib/activity-log-walk.js";
import { fromActivityLog, insertHistoryEvents, type ActivityLogEntry, type HistoryEvent } from "../apps/api/src/webhooks/item-events.js";

/** Boards whose history isn't case history. */
const SKIP_BOARDS = new Set(["call_log"]);
const PAGE = 1000;

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const apply = process.argv.includes("--apply");
const only = arg("boards")?.split(",").map((b) => b.trim()).filter(Boolean);
const dbPath = arg("db") === "seed" ? "data/seed.db" : "data/live.db";

const token = process.env.MONDAY_API_TOKEN;
if (!token) {
  console.error("MONDAY_API_TOKEN is not set.");
  process.exit(1);
}
setApiToken(token);
countMondayCalls("history-backfill", dbPath);

const db = new Database(dbPath, { readonly: !apply });
const hasV36 = (db.prepare("SELECT name FROM pragma_table_info('item_events') WHERE name = 'activity_log_id'").get() as unknown) != null;
const hasSource = (db.prepare("SELECT name FROM pragma_table_info('item_events') WHERE name = 'source'").get() as unknown) != null;
if (apply && !hasV36) {
  console.error(`${dbPath} has no item_events.activity_log_id — start the API once on this version so the v36 migration runs.`);
  process.exit(1);
}

const boards = await loadBoardsConfig();
const keys = Object.keys(boards).filter((k) => !SKIP_BOARDS.has(k) && (!only || only.includes(k)));
if (only) for (const k of only) if (!boards[k]) console.warn(`  unknown board key: ${k}`);

let calls = 0;
/** The newest `PAGE` entries before `to` (Monday returns newest first). */
async function before(boardId: string, to: string): Promise<ActivityLogEntry[]> {
  calls++;
  const r = await mondayRequest<{ data: { boards: { activity_logs: ActivityLogEntry[] | null }[] } }>(
    `query ($ids: [ID!], $to: ISO8601DateTime, $limit: Int) {
       boards(ids: $ids) { activity_logs(to: $to, limit: $limit, page: 1) { id event created_at user_id data } }
     }`,
    { ids: [boardId], to, limit: PAGE },
  );
  return r.data.boards[0]?.activity_logs ?? [];
}

const totals = { entries: 0, kept: 0, added: 0 };
const byEvent: Record<string, number> = {};
console.log(`${apply ? "APPLY" : "DRY RUN"} — ${keys.length} board(s), into ${dbPath}\n`);

for (const key of keys) {
  const boardId = String(boards[key]!.id);
  // Up to the board's first webhook-era event, so the two sources never overlap.
  // (A v35 database — dry run before the migration — has only webhook rows.)
  const firstWebhook = (db
    .prepare(`SELECT MIN(changed_at) AS t FROM item_events WHERE ${hasSource ? "source = 'webhook' AND " : ""}monday_board_id = ?`)
    .get(boardId) as { t: string | null }).t;
  const until = firstWebhook ?? new Date().toISOString();

  // Monday stops paging at 10,000 entries, so walk back in time instead (lib/activity-log-walk.ts).
  let entries = 0, kept = 0, added = 0;
  let oldest = null as string | null; // set inside the callback
  try {
    await walkActivityLog(
      (to) => before(boardId, to),
      until,
      PAGE,
      (batch) => {
        entries += batch.length;
        const events = batch
          .map((e) => fromActivityLog(e, key, boardId))
          .filter((e): e is HistoryEvent => e !== null && e.changedAt < until);
        kept += events.length;
        for (const e of events) {
          byEvent[e.eventType] = (byEvent[e.eventType] ?? 0) + 1;
          if (!oldest || e.changedAt < oldest) oldest = e.changedAt;
        }
        if (apply && events.length) added += insertHistoryEvents(db, events);
      },
      (m) => console.warn(`  ${key}: ${m}`),
    );
  } catch (err) {
    console.error(`  ${key}: stopped — ${(err as Error).message}. Re-run to continue (stored entries are skipped).`);
  }
  totals.entries += entries;
  totals.kept += kept;
  totals.added += added;
  console.log(
    `  ${key.padEnd(30)} ${String(entries).padStart(6)} entries, ${String(kept).padStart(6)} kept` +
      (apply ? `, ${String(added).padStart(6)} added` : "") +
      `  (${oldest?.slice(0, 10) ?? "—"} → ${until.slice(0, 10)})`,
  );
}

console.log(`\n${totals.entries} entries read, ${totals.kept} worth keeping${apply ? `, ${totals.added} added` : ""}; ${calls} Monday call(s).`);
console.log("By event:", JSON.stringify(byEvent));
if (!apply) console.log("Nothing was written. Add --apply to store it.");
db.close();
