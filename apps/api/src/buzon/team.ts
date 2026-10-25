// =============================================================================
// Buzón — telling the people on a Fee K (docs/features/buzon.md)
// =============================================================================
// A Monday bell on the Fee K to its Paralegal and Assistant (people columns,
// mirrored as names; the staff roster turns a name into a Monday user), plus a
// Slack "buzon" post (Settings → Integrations). No one on the Fee K = Slack only.
// =============================================================================

import type BetterSqlite3 from "better-sqlite3";
type DatabaseInstance = BetterSqlite3.Database;
import { createNotification } from "@case-pipeline/monday";
import { getBoardColumnsFor } from "@case-pipeline/query";
import { usersDb } from "../db/users-db.js";
import { makeStaffResolver, splitPeople } from "../staff/roster.js";
import { mondayItemUrl, notifyEvent, slackEscape, withLink } from "../notify/slack.js";

export interface FeeKTeam {
  names: string[];
  mondayUserIds: string[];
}

/** The Fee K's Paralegal(s) and Assistant, by the roster. */
export function feeKTeam(db: DatabaseInstance, feeKMondayId: string): FeeKTeam {
  const row = db.prepare(`
    SELECT json_extract(raw_column_values, '$.paralegal.label') AS paralegal,
           json_extract(raw_column_values, '$.assistant.label') AS assistant
      FROM contracts WHERE monday_item_id = ? AND deleted_at IS NULL
  `).get(feeKMondayId) as { paralegal: string | null; assistant: string | null } | undefined;
  if (!row) return { names: [], mondayUserIds: [] };
  const resolve = makeStaffResolver(usersDb);
  const names = [...new Set([...splitPeople(row.paralegal), ...splitPeople(row.assistant)])];
  const ids = names.map((n) => resolve(n)).filter((s) => s?.active && s.mondayUserId).map((s) => s!.mondayUserId!);
  return { names, mondayUserIds: [...new Set(ids)] };
}

/** Bell everyone on the Fee K, then Slack. Never throws: telling staff must not stop the work. */
export async function tellFeeKTeam(
  db: DatabaseInstance,
  token: string | undefined,
  feeKMondayId: string | null,
  bell: string,
  slack: { text: string; profileMondayId: string | null },
): Promise<void> {
  if (feeKMondayId && token) {
    for (const userId of feeKTeam(db, feeKMondayId).mondayUserIds) {
      try {
        await createNotification(userId, feeKMondayId, bell, token);
      } catch (err) {
        console.error("[buzon] Monday notification failed:", err);
      }
    }
  }
  const link = mondayItemUrl(getBoardColumnsFor(db, "profiles")?.mondayBoardId, slack.profileMondayId);
  try {
    await notifyEvent("buzon", withLink(`:mailbox_with_mail: ${slackEscape(slack.text)}`, link, "Monday"));
  } catch (err) {
    console.error("[buzon] Slack post failed:", err);
  }
}
