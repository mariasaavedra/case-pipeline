// =============================================================================
// Write-back token strategy — personal token first, shared token as a net
// =============================================================================
// Every Monday write prefers the acting staff member's personal OAuth token, so
// the change is attributed to them in Monday. But a personal token carries only
// the scopes it was ISSUED with: `boards:write` was added to the consent screen
// on 2026-08-04, so every token minted before that date can post notes and
// nothing else. Monday never widens an existing token — the user has to
// re-consent.
//
// Before this module, such a token failed the write, the endpoint queued it, and
// the queue retried the same doomed token five times before dead-lettering it.
// The edit looked applied (live.db was updated optimistically) and then silently
// reverted on the next sync.
//
// Now a permission failure falls back to the shared service token, which does
// have the scopes — the edit lands, only the attribution is lost — and the
// user's connection is flagged so the UI can ask them to reconnect.
//
// The fallback is deliberately narrow: only failures about WHO is asking (bad,
// revoked, or under-scoped token). A rate limit, a network blip, or a Monday
// outage still throws, so the caller queues it and retries later as before —
// falling back there would just burn the shared token on the same outage.
// =============================================================================

import { AuthError, MondayApiError, RateLimitError } from "@case-pipeline/monday";

/**
 * Monday reports "your token may not do this" two different ways: an HTTP
 * 401/403 (→ AuthError), and — for a scope the token was never granted — an
 * HTTP 200 carrying a GraphQL error, which the client wraps as a generic
 * MondayApiError. Hence the message sniff alongside the status check.
 */
const PERMISSION_MESSAGE = /unauthorized|not authenticated|authentication|forbidden|permission|insufficient|scope/i;

export function isPermissionError(err: unknown): boolean {
  // A 429 is a MondayApiError too, but it is about rate, not identity.
  if (err instanceof RateLimitError) return false;
  if (err instanceof AuthError) return true;
  if (err instanceof MondayApiError) {
    if (err.statusCode === 401 || err.statusCode === 403) return true;
    if (err.statusCode != null && err.statusCode !== 200) return false;
    return PERMISSION_MESSAGE.test(err.message);
  }
  return false;
}

export interface WriteOutcome<T> {
  result: T;
  /** True when the personal token carried the write (normal path). */
  usedPersonalToken: boolean;
  /** True when the personal token was rejected and the shared token took over. */
  fellBackToSharedToken: boolean;
}

export interface TokenFallbackOptions {
  /** The acting user's personal Monday token, when they have connected one. */
  userToken?: string | null;
  /** The shared service token (MONDAY_API_TOKEN). */
  sharedToken?: string | null;
  /**
   * Called when the personal token is rejected on permission grounds, with the
   * underlying message — used to flag the connection as needing a reconnect.
   */
  onPersonalTokenRejected?: (reason: string) => void;
}

/**
 * Run a Monday write with the personal token, falling back to the shared token
 * on a permission failure. `write` receives the token to use.
 *
 * Throws when neither token can do it, or when the failure is transient — the
 * caller's existing catch (queue + retry) handles those unchanged.
 */
export async function withTokenFallback<T>(
  write: (token?: string) => Promise<T>,
  opts: TokenFallbackOptions,
): Promise<WriteOutcome<T>> {
  const { userToken, sharedToken, onPersonalTokenRejected } = opts;

  if (!userToken) {
    return {
      result: await write(sharedToken ?? undefined),
      usedPersonalToken: false,
      fellBackToSharedToken: false,
    };
  }

  try {
    return {
      result: await write(userToken),
      usedPersonalToken: true,
      fellBackToSharedToken: false,
    };
  } catch (err) {
    if (!isPermissionError(err)) throw err;

    const reason = err instanceof Error ? err.message : String(err);
    onPersonalTokenRejected?.(reason);

    // No shared token configured — nothing left to try; surface the original
    // error so the caller queues it rather than reporting a bare success.
    if (!sharedToken) throw err;

    console.warn(
      `[write-auth] personal Monday token rejected (${reason}); retrying with the shared token.`,
    );
    return {
      result: await write(sharedToken),
      usedPersonalToken: false,
      fellBackToSharedToken: true,
    };
  }
}
