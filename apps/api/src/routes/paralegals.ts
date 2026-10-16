// =============================================================================
// GET /api/paralegals — the paralegals a user can say they are
// =============================================================================
// Powers the "I am" dropdown for linking a user to their board identity, used
// both in self-service Settings and the admin panel. Active staff with a
// paralegal role, from the roster (staff/roster.ts). Before the roster is
// seeded, falls back to the distinct names in the `paralegals` people-column.
// Attorneys are NOT listed — "My Cases" groups the open-forms workload by
// paralegal, so an attorney would never have a lane.
// =============================================================================

import type { Request, Response } from "express";
import type BetterSqlite3 from "better-sqlite3";
import { usersDb } from "../db/users-db.js";
import { listStaff, splitPeople } from "../staff/roster.js";

type Database = BetterSqlite3.Database;

export function paralegalNames(rosterDb: Database, caseDb: Database): string[] {
  const roster = listStaff(rosterDb);
  if (roster.length > 0) {
    return roster
      .filter((s) => s.active && (s.roles.includes("paralegal") || s.roles.includes("court_paralegal")))
      .map((s) => s.name)
      .sort((a, b) => a.localeCompare(b));
  }

  const rows = caseDb
    .prepare("SELECT DISTINCT paralegals FROM board_items WHERE paralegals IS NOT NULL AND paralegals != ''")
    .all() as { paralegals: string | null }[];
  // The people-column stores multiple assignees as a comma-separated string.
  const names = new Set<string>();
  for (const row of rows) for (const name of splitPeople(row.paralegals)) names.add(name);
  return [...names].sort((a, b) => a.localeCompare(b));
}

export function handleParalegals(_req: Request, res: Response, caseDb: Database): void {
  res.json({ data: paralegalNames(usersDb, caseDb) });
}
