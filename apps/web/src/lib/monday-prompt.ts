import type { MondayConnectionStatus } from "../api";

/** localStorage key holding when the user last pressed "Not now". */
export const MONDAY_PROMPT_DISMISSED_KEY = "monday-prompt-dismissed-at";

/**
 * "Not now" quiets the prompt for a working day, not forever. localStorage
 * rather than sessionStorage because sessionStorage is per tab — every
 * "open in new tab" would ask again.
 */
export const MONDAY_PROMPT_SNOOZE_MS = 12 * 60 * 60 * 1000;

/**
 * Whether the sign-in prompt should ask this user to connect Monday.com.
 * Asks when there's no connection, or Monday refuses the one they have
 * (their writes then land under the shared account instead of their name).
 */
export function shouldPromptMondayConnect(
  status: MondayConnectionStatus,
  dismissedAt: number | null,
  now: number,
): boolean {
  if (status.oauthConfigured === false) return false;
  if (status.connected && !status.needsReconnect) return false;
  if (dismissedAt !== null && now - dismissedAt < MONDAY_PROMPT_SNOOZE_MS) return false;
  return true;
}
