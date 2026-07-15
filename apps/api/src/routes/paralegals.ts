// =============================================================================
// GET /api/paralegals — distinct paralegal names across the boards
// =============================================================================
// Powers the "I am" dropdown for linking a user to their board identity, used
// both in self-service Settings and the admin panel. Only paralegals are listed
// (the `paralegals` people-column), NOT attorneys — "My Cases" groups the
// open-forms workload by paralegal, so an attorney name would never match.
// =============================================================================

import type { Request, Response } from "express";
import type BetterSqlite3 from "better-sqlite3";

type Database = BetterSqlite3.Database;

export function handleParalegals(_req: Request, res: Response, caseDb: Database): void {
  const rows = caseDb
    .prepare("SELECT DISTINCT paralegals FROM board_items WHERE paralegals IS NOT NULL AND paralegals != ''")
    .all() as { paralegals: string | null }[];

  // The people-column stores multiple assignees as a comma-separated string.
  const names = new Set<string>();
  for (const row of rows) {
    if (!row.paralegals) continue;
    for (const part of row.paralegals.split(",")) {
      const name = part.trim();
      if (name) names.add(name);
    }
  }

  res.json({ data: [...names].sort((a, b) => a.localeCompare(b)) });
}
