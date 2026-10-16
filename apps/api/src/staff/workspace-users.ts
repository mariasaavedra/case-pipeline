// =============================================================================
// Monday workspace users — one shared, cached copy
// =============================================================================
// Call Log, consult booking and appointment writes each kept their own cache of
// fetchWorkspaceUsers; this is the one they share now, and the staff refresh
// reads the same list. Ten minutes: people join or leave the workspace rarely,
// and a people-column write should not cost a round trip each time.
// =============================================================================

import type BetterSqlite3 from "better-sqlite3";
import { fetchWorkspaceUsers, type MondayWorkspaceUser } from "@case-pipeline/monday";
import { makeStaffResolver, normName } from "./roster.js";

const TTL_MS = 10 * 60 * 1000;
let cache: { users: MondayWorkspaceUser[]; at: number } | null = null;

/** The workspace's non-guest users, from cache when fresh. Throws if Monday fails. */
export async function getWorkspaceUsers(token: string | undefined, opts: { fresh?: boolean } = {}): Promise<MondayWorkspaceUser[]> {
  const now = Date.now();
  if (!opts.fresh && cache && now - cache.at < TTL_MS) return cache.users;
  const users = await fetchWorkspaceUsers(token);
  cache = { users, at: now };
  return users;
}

/**
 * The numeric Monday user id for a name, for a people-column write. The roster
 * first (its aliases cover "Lucy B." vs "Lucy Betteridge"), then the
 * workspace list by exact name. null when no one matches or Monday is down.
 */
export async function mondayUserIdForName(
  token: string | undefined,
  name: string | null | undefined,
  rosterDb?: BetterSqlite3.Database,
): Promise<number | null> {
  if (!name) return null;
  if (rosterDb) {
    const fromRoster = Number(makeStaffResolver(rosterDb)(name)?.mondayUserId ?? NaN);
    if (Number.isFinite(fromRoster)) return fromRoster;
  }
  const wanted = normName(name);
  const hit = (await getWorkspaceUsers(token)).find((u) => normName(u.name) === wanted);
  const id = hit ? Number(hit.id) : NaN;
  return Number.isFinite(id) ? id : null;
}

/** Test hook. */
export function resetWorkspaceUsersCache(): void {
  cache = null;
}
