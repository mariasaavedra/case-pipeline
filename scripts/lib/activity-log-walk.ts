// =============================================================================
// Walk a board's Monday activity log backwards in time
// =============================================================================
// Monday's `activity_logs(page:)` stops at 10,000 entries, so paging alone
// can't reach a busy board's early history. Instead each request asks for the
// newest `pageSize` entries before `to`, and `to` then moves to just past the
// oldest entry seen (+1 ms, since the API takes millisecond times while entries
// carry 100 ns ones); ids already seen are dropped, so entries sharing that
// millisecond are neither lost nor counted twice. Used by
// scripts/history-backfill.ts.
// =============================================================================

import { activityLogTime, type ActivityLogEntry } from "../../apps/api/src/webhooks/item-events.js";

/** The newest entries strictly before `to` (ISO), newest first, at most the page size. */
export type FetchBefore = (to: string) => Promise<ActivityLogEntry[]>;

/** Calls `onBatch` with each run of new entries, newest first, until the board's log is exhausted. */
export async function walkActivityLog(
  fetchBefore: FetchBefore,
  until: string,
  pageSize: number,
  onBatch: (batch: ActivityLogEntry[]) => void,
  warn: (message: string) => void = () => {},
): Promise<void> {
  const seen = new Set<string>();
  let to = until;
  for (;;) {
    const fetched = await fetchBefore(to);
    const batch = fetched.filter((e) => !seen.has(e.id));
    const fetchedOldest = Math.min(...fetched.map((e) => Date.parse(activityLogTime(e.created_at) ?? "") || Infinity));
    if (batch.length === 0) {
      // A full page we've all seen = over pageSize entries in one millisecond (a
      // big batch action): step past that millisecond rather than stop.
      if (fetched.length < pageSize || !Number.isFinite(fetchedOldest) || to === new Date(fetchedOldest).toISOString()) return;
      warn(`over ${pageSize} entries at ${new Date(fetchedOldest).toISOString()}; some of that millisecond may be missed`);
      to = new Date(fetchedOldest).toISOString();
      continue;
    }
    for (const e of batch) seen.add(e.id);
    onBatch(batch);
    if (fetched.length < pageSize || !Number.isFinite(fetchedOldest)) return;
    to = new Date(fetchedOldest + 1).toISOString();
  }
}
