// =============================================================================
// GET /api/board-people — distinct paralegal/attorney names across the boards
// =============================================================================
// Powers the "Soy: [name]" dropdown for linking a user to their board identity,
// used both in self-service Settings and the admin panel. Names are stored as
// comma-separated people-column strings on board_items.
// =============================================================================

import type { Request, Response } from "express";
import type BetterSqlite3 from "better-sqlite3";

type Database = BetterSqlite3.Database;

export function handleBoardPeople(_req: Request, res: Response, caseDb: Database): void {
  const rows = caseDb
    .prepare("SELECT DISTINCT paralegals, attorney FROM board_items")
    .all() as { paralegals: string | null; attorney: string | null }[];

  const names = new Set<string>();
  for (const row of rows) {
    for (const field of [row.paralegals, row.attorney]) {
      if (!field) continue;
      for (const part of field.split(",")) {
        const name = part.trim();
        if (name) names.add(name);
      }
    }
  }

  res.json({ data: [...names].sort((a, b) => a.localeCompare(b)) });
}
