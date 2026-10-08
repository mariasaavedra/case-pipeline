// =============================================================================
// The client's Drive upload folder → the appointment's "Google Drive Folder"
// =============================================================================
// Zapier makes one "Consult Documents <name> - <date> at <time>" folder per
// booking and sends the client its link. The intake job matches each folder to
// its appointment like a file (scripts/drive/match.ts) and writes the link to
// the appointment's "Google Drive Folder" text column (R, M, LB, CR), so
// reception and M18 can open it.
//
// A reschedule makes a new branch, so one appointment can match several
// folders; the newest is the one the client was sent last and wins. The column
// is written only when empty or when it holds one of those older folders —
// a link someone typed in Monday is never replaced.
// =============================================================================

export function driveFolderUrl(id: string): string {
  return `https://drive.google.com/drive/folders/${id}`;
}

/** The folder id in a Drive link ("…/drive/folders/<id>?usp=…", "…open?id=<id>"), else null. */
export function driveFolderIdOf(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(/\/folders\/([A-Za-z0-9_-]{10,})/) ?? text.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  return m ? m[1]! : null;
}

export interface MatchedFolder {
  id: string;
  createdTime: string;
  appointmentLocalId: string;
}

/** Per appointment, the newest matched folder (the one the client was sent last). */
export function newestPerAppointment<T extends MatchedFolder>(folders: T[]): Map<string, T> {
  const out = new Map<string, T>();
  for (const f of folders) {
    const have = out.get(f.appointmentLocalId);
    if (!have || f.createdTime > have.createdTime) out.set(f.appointmentLocalId, f);
  }
  return out;
}

export type ColumnDecision = "write" | "already-set" | "other-link-kept";

/**
 * Whether to write `folderId`'s link over the column's `current` text.
 * `olderIds` = the other folders matched to the same appointment (earlier
 * bookings of it): a link to one of those is ours to replace.
 */
export function columnDecision(current: string | null | undefined, folderId: string, olderIds: ReadonlySet<string>): ColumnDecision {
  if (!current?.trim()) return "write";
  const have = driveFolderIdOf(current);
  if (have === folderId) return "already-set";
  if (have && olderIds.has(have)) return "write";
  return "other-link-kept";
}
