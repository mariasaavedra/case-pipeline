// =============================================================================
// "My Cases" — the caller's own active cases
// =============================================================================
// Reuses getActiveCases (grouped by paralegal) and returns just the lane that
// matches the caller's paralegal_link. If the user hasn't linked their board
// name yet, returns needsLink=true so the UI can prompt them in Settings.
// =============================================================================

import type { Request, Response } from "express";
import type BetterSqlite3 from "better-sqlite3";
import { getActiveCases, type ActiveCase } from "@case-pipeline/query";
import { currentUser } from "../db/user-context.js";

type Database = BetterSqlite3.Database;

export interface MyCasesResult {
  needsLink: boolean;
  paralegalLink: string | null;
  cases: ActiveCase[];
}

export function handleMyCases(req: Request, res: Response, caseDb: Database): void {
  const user = currentUser(req);
  if (!user) {
    res.status(401).json({ error: "Unknown user" });
    return;
  }

  const link = user.paralegal_link?.trim() ?? "";
  if (!link) {
    const empty: MyCasesResult = { needsLink: true, paralegalLink: null, cases: [] };
    res.json({ data: empty });
    return;
  }

  const { assignees } = getActiveCases(caseDb);
  const mine = assignees.find((a) => a.name.toLowerCase() === link.toLowerCase());
  const result: MyCasesResult = {
    needsLink: false,
    paralegalLink: user.paralegal_link,
    cases: mine?.cases ?? [],
  };
  res.json({ data: result });
}
