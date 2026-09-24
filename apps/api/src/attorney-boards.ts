// =============================================================================
// Attorney appointment boards config
// =============================================================================
// Which Monday boards feed the appointments/calendar views, stored as a JSON
// file rather than in the database: it is deployment configuration an admin
// edits through Settings, not synced data, and it must survive a DB restore.
//
// Shared between the Settings routes that edit it and the read routes
// (appointments, calendar) that consume it.
// =============================================================================

import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./paths.js";

export interface AttorneyBoard {
  boardKey: string;
  mondayBoardId: string;
  /** Compact badge shown beside an appointment, e.g. "LB". */
  displayName: string;
  /**
   * The attorney's full name, as it reads in Monday's Attorney people column
   * ("Lucy Betteridge"). Optional: entries predating this field fall back to
   * displayName, which is fine for a badge and poor for a "who is the attorney?"
   * picker — which is why the field exists.
   */
  attorneyName?: string;
  /**
   * Whether this board's appointments appear in the daily appointments and
   * calendar reads. NOT a statement about the attorney: it gates data, and
   * turning it off hides their existing appointments.
   */
  active: boolean;
  /**
   * Whether this attorney is offered when booking a NEW consult. Independent of
   * `active`, because the two questions genuinely differ: an attorney who has
   * stopped taking consults still has a board and a history worth reading.
   *
   * Absent means "same as `active`", so boards configured before this field
   * existed stay bookable without a migration.
   */
  acceptingConsults?: boolean;
}

export const ATTORNEY_BOARDS_PATH = path.join(DATA_DIR, "attorney-boards.json");

/** Read the configured boards; an absent or unreadable file means "none yet". */
export function loadAttorneyBoards(): AttorneyBoard[] {
  try {
    return JSON.parse(fs.readFileSync(ATTORNEY_BOARDS_PATH, "utf-8")) as AttorneyBoard[];
  } catch {
    return [];
  }
}

export function saveAttorneyBoards(boards: AttorneyBoard[]): void {
  fs.writeFileSync(ATTORNEY_BOARDS_PATH, JSON.stringify(boards, null, 2));
}

/** Just the keys of the boards currently switched on. */
export function activeBoardKeys(): string[] {
  return loadAttorneyBoards()
    .filter((b) => b.active)
    .map((b) => b.boardKey);
}

/** Whether a board should be offered when booking a new consult. */
export function isBookable(board: AttorneyBoard): boolean {
  return board.acceptingConsults ?? board.active;
}

/**
 * The boards a new appointment may be created on, in display order.
 *
 * This is the only list the New Appointment picker reads, which is what makes
 * onboarding an attorney a settings change rather than a deploy: add their
 * board here and they appear. An attorney who has stopped taking consults is
 * removed from it by `acceptingConsults: false` while their board stays
 * `active`, so their history keeps reading normally.
 */
export function bookableBoards(): AttorneyBoard[] {
  return loadAttorneyBoards()
    .filter(isBookable)
    .sort((a, b) => (a.attorneyName ?? a.displayName).localeCompare(b.attorneyName ?? b.displayName));
}
