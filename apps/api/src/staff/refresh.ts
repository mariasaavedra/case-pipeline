// =============================================================================
// Staff refresh — the I/O around roster.refreshStaff
// =============================================================================
// Gathers the three inputs (Monday workspace users, names on the boards, the
// attorney-board config) and applies them to users.db. Monday is optional: on
// a seed DB, or when Monday is down, the board-name and login steps still run.
// =============================================================================

import type BetterSqlite3 from "better-sqlite3";
import { usersDb } from "../db/users-db.js";
import { loadAttorneyBoards } from "../attorney-boards.js";
import { readBoardNames, refreshStaff, type RefreshResult } from "./roster.js";
import { getWorkspaceUsers } from "./workspace-users.js";

export interface StaffRefreshOutcome extends RefreshResult {
  /** Why Monday users weren't read, when they weren't. */
  mondaySkipped: string | null;
}

export async function runStaffRefresh(caseDb: BetterSqlite3.Database, token: string | undefined): Promise<StaffRefreshOutcome> {
  let workspaceUsers = null;
  let mondaySkipped: string | null = null;
  if (!token) {
    mondaySkipped = "Monday.com is not configured";
  } else {
    try {
      workspaceUsers = await getWorkspaceUsers(token, { fresh: true });
    } catch (err) {
      console.error("[staff] could not read Monday users; refreshing from the boards only:", err);
      mondaySkipped = "Monday.com could not be reached";
    }
  }
  const result = refreshStaff(usersDb, {
    workspaceUsers,
    boardNames: readBoardNames(caseDb),
    attorneyBoards: loadAttorneyBoards(),
  });
  return { ...result, mondaySkipped };
}

/** First boot after v15: fill an empty roster so My Cases / My Day keep working. */
export function seedStaffIfEmpty(caseDb: BetterSqlite3.Database, token: string | undefined): void {
  const { n } = usersDb.prepare("SELECT COUNT(*) AS n FROM staff").get() as { n: number };
  if (n > 0) return;
  runStaffRefresh(caseDb, token)
    .then((r) =>
      console.log(
        `[staff] roster seeded: ${r.mondayAdded} from Monday, ${r.boardNamesAdded} board names, ${r.loginsLinked} logins linked` +
          (r.mondaySkipped ? ` (${r.mondaySkipped})` : ""),
      ),
    )
    .catch((e) => console.error("[staff] roster seed failed:", e));
}
