// =============================================================================
// "My Cases" (P6) — one paralegal's Prescheduling + Open Forms cases
// =============================================================================
// Defaults to the caller's own staff record (staff/roster.ts; every name they go
// by counts), else their legacy paralegal_link; `?paralegal=<name>` shows
// someone else's and `?paralegal=all` everyone's (the page's switcher). A user
// who hasn't linked their board name gets needsLink=true and everyone's cases,
// so the page can prompt them without being empty. Query = libs/query/src/my-cases.ts.
// =============================================================================

import type { Request, Response } from "express";
import type BetterSqlite3 from "better-sqlite3";
import { getMyCases, type ActiveCasesOptions, type MyCasesData } from "@case-pipeline/query";
import { currentUser } from "../db/user-context.js";
import { usersDb } from "../db/users-db.js";
import { makeStaffResolver, staffForUser } from "../staff/roster.js";

type Database = BetterSqlite3.Database;

export interface MyCasesResult extends MyCasesData {
  needsLink: boolean;
  paralegalLink: string | null;
  /** Whose cases these are; null = everyone. */
  selected: string | null;
}

/** Which paralegal to show: the query param ("all" = everyone), else the caller's link. */
export function resolveSelected(param: string | undefined, link: string): string | null {
  const p = (param ?? "").trim();
  if (p.toLowerCase() === "all") return null;
  if (p) return p;
  return link || null;
}

export function handleMyCases(
  req: Request,
  res: Response,
  caseDb: Database,
  activeCases: ActiveCasesOptions = {},
): void {
  const user = currentUser(req);
  if (!user) {
    res.status(401).json({ error: "Unknown user" });
    return;
  }

  const staff = staffForUser(usersDb, user);
  const link = staff?.name ?? user.paralegal_link?.trim() ?? "";
  const param = typeof req.query.paralegal === "string" ? req.query.paralegal : undefined;
  const selected = resolveSelected(param, link);
  const includeSnoozed = req.query.includeSnoozed === "1";
  // The selected name's roster person, when it has one: their aliases count too.
  const resolve = makeStaffResolver(usersDb);
  const person = selected ? resolve(selected) : null;
  const isSelected = person ? (n: string) => resolve(n)?.id === person.id : undefined;
  const data = getMyCases(caseDb, { paralegal: selected, isSelected, includeSnoozed, activeCases });

  const result: MyCasesResult = {
    needsLink: !link,
    paralegalLink: link || null,
    selected,
    ...data,
  };
  res.json({ data: result });
}
