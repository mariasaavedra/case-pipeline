// =============================================================================
// Note write-back — shared parsing for the routes that post a Monday update
// =============================================================================
// Three routes post a note to Monday and each had its own copy of the same
// mention-parsing expression: POST /api/profiles/:id/updates, POST
// /api/call-log/:id/notes, and POST /api/call-log. Three copies of a rule about
// who gets notified is three places for them to drift apart — the call-log
// fallback path had already lost its mentions once (see write-queue/processor).
// =============================================================================

import type { UpdateMention } from "@case-pipeline/monday";

/**
 * Normalize a client-supplied mention list into Monday's UpdateMention shape.
 *
 * Total by design: anything that is not an array of usable ids yields an empty
 * list. A malformed mention must never fail the note itself — losing a
 * notification is recoverable, losing the note is not.
 */
export function parseMentions(raw: unknown): UpdateMention[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((id): id is string | number => id != null && id !== "")
    .map((id) => ({ id: String(id), type: "User" as const }));
}

export interface ParsedNote {
  text: string;
  mentions: UpdateMention[];
}

/**
 * Parse a note body. `field` names the text property, which differs by route
 * ("text" on profile updates, "note" on call-log notes).
 */
export function parseNoteBody(raw: unknown, field: "text" | "note"): ParsedNote {
  const body = (raw ?? {}) as Record<string, unknown>;
  return {
    text: (body[field] ?? "").toString().trim(),
    mentions: parseMentions(body.mentionedUserIds),
  };
}
