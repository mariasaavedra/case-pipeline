// =============================================================================
// Update Relevance Filter — used by snapshot cards to pick meaningful updates
// =============================================================================

import type { ClientUpdate } from "../api";

const STATUS_CHANGE_PATTERN = /^Status changed (to|from)/i;
const MIN_BODY_LENGTH = 10;

/**
 * Filter out empty, very short, and "Status changed to..." updates.
 */
export function filterRelevantUpdates(updates: ClientUpdate[]): ClientUpdate[] {
  return updates.filter((u) => {
    if (!u.textBody || u.textBody.trim().length < MIN_BODY_LENGTH) return false;
    if (STATUS_CHANGE_PATTERN.test(u.textBody.trim())) return false;
    return true;
  });
}

/**
 * Pick the single most relevant update for a snapshot card.
 * Priority: non-reply updates with boardKey > non-reply updates > any relevant > raw first.
 */
export function getMostRelevantUpdate(updates: ClientUpdate[]): ClientUpdate | null {
  if (updates.length === 0) return null;

  const relevant = filterRelevantUpdates(updates);
  if (relevant.length === 0) return updates[0] ?? null;

  // Prefer non-reply (eventType === "update") with a boardKey
  const withBoard = relevant.find(
    (u) => u.sourceType === "update" && u.boardKey
  );
  if (withBoard) return withBoard;

  // Prefer non-reply
  const nonReply = relevant.find((u) => u.sourceType === "update");
  if (nonReply) return nonReply;

  // Any relevant update
  return relevant[0]!;
}
