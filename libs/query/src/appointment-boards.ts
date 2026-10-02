// =============================================================================
// Appointment boards present in the data
// =============================================================================
// Every attorney has an `appointments_<initials>` board. The set is read from
// what has been synced rather than listed in code, so an attorney added in
// Settings shows up in every query once their board has synced.
//
// GLOB, not LIKE: `_` is a LIKE wildcard, and GLOB is case-sensitive, which
// lets SQLite answer this from idx_board_items_board.
// =============================================================================

import type BetterSqlite3 from "better-sqlite3";
type Database = BetterSqlite3.Database;
import { APPOINTMENT_BOARD_PREFIX } from "./types";

export function listAppointmentBoardKeys(db: Database): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT board_key FROM board_items WHERE board_key GLOB ? ORDER BY board_key`,
    )
    .all(`${APPOINTMENT_BOARD_PREFIX}*`) as { board_key: string }[];
  return rows.map((r) => r.board_key);
}
