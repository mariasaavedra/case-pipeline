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
  displayName: string;
  active: boolean;
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
