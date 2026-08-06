// =============================================================================
// Monday.com webhook receiver
// =============================================================================
// POST /api/webhooks/monday/:token — the URL Monday calls when a subscribed
// board event fires (see scripts/setup-webhooks.ts for registration).
//
// Design: the receiver does the absolute minimum — authenticate the caller,
// echo Monday's registration challenge, and INSERT the event into the durable
// webhook_events inbox — then answers 200 immediately. Monday retries slow or
// failing endpoints, so anything that could block (a Monday re-fetch, a
// targeted sync) belongs in the background processor, never here.
//
// Auth: Monday does not sign API-created webhooks, so the shared secret lives
// in the URL path (MONDAY_WEBHOOK_SECRET) and is compared in constant time.
// The route is registered BEFORE the requireAuth catch-all in server.ts —
// Monday cannot send an Azure AD bearer token.
// =============================================================================

import type BetterSqlite3 from "better-sqlite3";
type Database = BetterSqlite3.Database;
import type { Express, Request, Response } from "express";
import { timingSafeEqual } from "node:crypto";

/** Shape of the interesting fields in a Monday webhook event payload. */
interface MondayWebhookEvent {
  type?: unknown;
  boardId?: unknown;
  pulseId?: unknown;
}

export function webhookSecret(): string | null {
  const s = process.env.MONDAY_WEBHOOK_SECRET?.trim();
  return s ? s : null;
}

function tokenMatches(provided: string, secret: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(secret, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface WebhookResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Core handler, kept free of Express so it is directly unit-testable.
 * `token` is the path segment; `body` is the parsed JSON payload.
 */
export function handleMondayWebhook(db: Database, token: string, body: unknown): WebhookResult {
  const secret = webhookSecret();
  if (!secret) {
    // Not configured — tell Monday to stop retrying (it treats 4xx/5xx as
    // retryable for a while; a clear 503 shows up in its integration log).
    return { status: 503, body: { error: "Webhook receiver not configured (MONDAY_WEBHOOK_SECRET missing)" } };
  }
  if (!tokenMatches(token, secret)) {
    return { status: 401, body: { error: "Invalid webhook token" } };
  }

  const payload = (body ?? {}) as { challenge?: unknown; event?: MondayWebhookEvent };

  // Registration handshake: Monday POSTs { challenge } at create_webhook time
  // and expects the same JSON echoed back.
  if (typeof payload.challenge === "string") {
    return { status: 200, body: { challenge: payload.challenge } };
  }

  const event = payload.event;
  if (!event || typeof event !== "object" || typeof event.type !== "string") {
    // Unknown shape — acknowledge (200) so Monday doesn't retry-storm us, but
    // record nothing. Logged for visibility.
    console.warn("[webhook] ignored payload without event.type");
    return { status: 200, body: { ok: true, ignored: true } };
  }

  db.prepare(
    `INSERT INTO webhook_events (event_type, monday_board_id, monday_item_id, payload)
     VALUES (?, ?, ?, ?)`,
  ).run(
    event.type,
    event.boardId != null ? String(event.boardId) : null,
    event.pulseId != null ? String(event.pulseId) : null,
    JSON.stringify(payload),
  );

  return { status: 200, body: { ok: true } };
}

/** Express glue. Register BEFORE the /api/ requireAuth catch-all. */
export function registerMondayWebhook(app: Express, db: Database): void {
  app.post("/api/webhooks/monday/:token", (req: Request, res: Response) => {
    try {
      const result = handleMondayWebhook(db, String(req.params.token ?? ""), req.body);
      res.status(result.status).json(result.body);
    } catch (err) {
      // An insert failure must not surface details to an unauthenticated caller.
      console.error("[webhook] receiver error:", err);
      res.status(500).json({ error: "Internal error" });
    }
  });
}
