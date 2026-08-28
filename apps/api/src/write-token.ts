// =============================================================================
// Write token strategy
// =============================================================================
// Shared by every route that writes to Monday.com on a staff member's behalf.
// Lived in server.ts as a closure over MONDAY_API_TOKEN; extracted so route
// modules can be registered independently of the server bootstrap.
//
// See docs/decisions.md (2026-08-07) for why a scope change here silently
// breaks every existing connection.
// =============================================================================

import type { Request } from "express";
import type { TokenFallbackOptions } from "./write-auth.js";
import { getUserMondayToken, markMondayTokenRejected } from "./routes/monday-oauth.js";

/**
 * Token strategy for a write made by an authenticated staff member: their
 * personal Monday token first (for attribution), the shared service token as
 * the net when Monday rejects it on permission grounds — and their connection
 * gets flagged so Settings can ask them to reconnect.
 */
export function makeWriteTokenOptions(sharedToken: string | undefined) {
  return function writeTokenOptions(req: Request): TokenFallbackOptions {
    const oid = req.user?.oid ?? "";
    return {
      userToken: oid ? getUserMondayToken(oid) : null,
      sharedToken,
      onPersonalTokenRejected: (reason) => markMondayTokenRejected(oid, reason),
    };
  };
}

/** The bound form route modules receive. */
export type WriteTokenOptions = ReturnType<typeof makeWriteTokenOptions>;
