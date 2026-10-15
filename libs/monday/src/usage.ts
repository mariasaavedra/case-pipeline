// =============================================================================
// Monday API call counter — which job spent the daily call budget
// =============================================================================
// Monday caps the whole account at a number of API calls per day (10,000 on
// our plan, reset at midnight UTC), shared by every token and integration —
// Zapier included. Monday's own report (`platform_api.daily_analytics`) says
// how many calls a TOKEN made, not which of our jobs made them; on 2026-10-14
// we hit the cap and could only infer the nightly full sync was the cause.
//
// Every request attempt (retries too — Monday counts each one) increments a
// counter keyed by UTC day + the job running it. The job comes from
// `withMondayJob` (AsyncLocalStorage, so it follows awaits into the call),
// else the process default (`setDefaultMondayJob`, e.g. "sync:full" in the sync
// child process), else "app". The host process drains the counts into SQLite
// (`monday_api_calls`) — this module has no DB of its own.

import { AsyncLocalStorage } from "node:async_hooks";
import { mondayRequest } from "./api";

const jobContext = new AsyncLocalStorage<string>();
let defaultJob = "app";
const counts = new Map<string, number>(); // "<YYYY-MM-DD>|<job>" → calls

export interface MondayCallCount {
  /** UTC day, the same day Monday's daily limit counts in. */
  day: string;
  job: string;
  calls: number;
}

/** Run `fn` with every Monday call inside it counted under `job`. */
export function withMondayJob<T>(job: string, fn: () => T): T {
  return jobContext.run(job, fn);
}

/** The job a call is counted under when no `withMondayJob` is active. */
export function setDefaultMondayJob(job: string): void {
  defaultJob = job;
}

/** Count one request attempt. Called by the request loop in api.ts. */
export function recordMondayCall(now: Date = new Date()): void {
  const key = `${now.toISOString().slice(0, 10)}|${jobContext.getStore() ?? defaultJob}`;
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

/** Take the counts since the last drain (and reset them). */
export function drainMondayCallCounts(): MondayCallCount[] {
  const out: MondayCallCount[] = [];
  for (const [key, calls] of counts) {
    const [day, job] = key.split("|", 2) as [string, string];
    out.push({ day, job, calls });
  }
  counts.clear();
  return out;
}

// =============================================================================
// Monday's own report: the account's daily limit and usage (platform_api)
// =============================================================================

export interface MondayPlatformUsage {
  /** Calls per day the account may make (all tokens and apps together). */
  dailyLimit: number | null;
  /** When Monday last refreshed these numbers (it lags a few minutes). */
  lastUpdated: string | null;
  /** Newest day first, as Monday returns it. UTC days. */
  byDay: { day: string; usage: number }[];
  /** Over Monday's window (about two weeks). A personal token shows as app "11". */
  byApp: { appId: string; name: string | null; usage: number }[];
  byUser: { name: string | null; usage: number }[];
}

const PLATFORM_USAGE_QUERY = `{
  platform_api {
    daily_limit { base }
    daily_analytics {
      last_updated
      by_day { day usage }
      by_app { app { name } api_app_id usage }
      by_user { user { name } usage }
    }
  }
}`;

interface PlatformUsageResponse {
  data: {
    platform_api: {
      daily_limit: { base: number | null } | null;
      daily_analytics: {
        last_updated: string | null;
        by_day: { day: string; usage: number }[] | null;
        by_app: { app: { name: string | null } | null; api_app_id: string; usage: number }[] | null;
        by_user: { user: { name: string | null } | null; usage: number }[] | null;
      } | null;
    } | null;
  };
}

/** Read the account's daily limit + usage. Costs one call. Needs API 2025-04+. */
export async function fetchPlatformUsage(tokenOverride?: string): Promise<MondayPlatformUsage> {
  const res = await mondayRequest<PlatformUsageResponse>(PLATFORM_USAGE_QUERY, undefined, tokenOverride, "2025-04");
  const p = res.data.platform_api;
  const a = p?.daily_analytics;
  return {
    dailyLimit: p?.daily_limit?.base ?? null,
    lastUpdated: a?.last_updated ?? null,
    byDay: a?.by_day ?? [],
    byApp: (a?.by_app ?? []).map((r) => ({ appId: r.api_app_id, name: r.app?.name ?? null, usage: r.usage })),
    byUser: (a?.by_user ?? []).map((r) => ({ name: r.user?.name ?? null, usage: r.usage })),
  };
}
