// =============================================================================
// RingCentral call events — the receiver (docs/features/phone-ivr.md)
// =============================================================================
// POST /api/webhooks/ringcentral/:token — RingCentral calls it for every change
// on every call in the account (the telephony/sessions subscription that
// `npm run rc:subscribe` creates). It is the base the phone features build on;
// today one listens: a caller who pressed 1 in the IVR lands on the
// announcement-only extension RC_SCHEDULING_EXTENSION and gets the scheduling
// link by text (scheduling-text.ts).
//
// Same rules as the Monday receiver: authenticate (secret in the URL path,
// RC_WEBHOOK_SECRET, constant-time compare), echo the subscription handshake,
// answer 200 at once — RingCentral wants an answer within 3 seconds and drops
// a subscription that keeps failing — and do the work afterwards.
//
// One call sends many events (ringing, answered, hung up…), each listing the
// call's parties. A call is acted on once: the first event that shows a party
// on the extension, keyed by telephonySessionId.
// =============================================================================

import type { Express, Request, Response } from "express";
import { timingSafeEqual } from "node:crypto";

export function rcWebhookSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const s = env.RC_WEBHOOK_SECRET?.trim();
  return s ? s : null;
}

/** The announcement-only extension number (e.g. "150") that "press 1" connects to, else null. */
export function schedulingExtension(env: NodeJS.ProcessEnv = process.env): string | null {
  const s = env.RC_SCHEDULING_EXTENSION?.trim();
  return s && /^\d{1,8}$/.test(s) ? s : null;
}

function tokenMatches(provided: string, secret: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(secret, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

interface RcEndpoint {
  phoneNumber?: unknown;
  extensionId?: unknown;
  extensionNumber?: unknown;
}

interface RcParty {
  extensionId?: unknown;
  direction?: unknown;
  from?: RcEndpoint;
  to?: RcEndpoint;
  status?: { code?: unknown };
}

/** What a call event says, reduced to what the features read. */
export interface CallEvent {
  telephonySessionId: string;
  /** The outside caller's number as RingCentral sent it (E.164), else null (blocked / anonymous). */
  callerNumber: string | null;
  parties: { extensionId: string | null; extensionNumber: string | null; direction: string | null; status: string | null }[];
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);

/** The event from a notification body, or null when it isn't a telephony session event. */
export function parseCallEvent(payload: unknown): CallEvent | null {
  const body = (payload as { body?: unknown } | null)?.body as
    | { telephonySessionId?: unknown; parties?: unknown }
    | undefined;
  if (!body || typeof body !== "object") return null;
  const telephonySessionId = str(body.telephonySessionId);
  if (!telephonySessionId || !Array.isArray(body.parties)) return null;
  const parties = body.parties as RcParty[];
  // The caller is the `from` of an inbound party — every party of an inbound
  // call carries it, the extension's own party included.
  const inbound = parties.find((p) => str(p?.direction) === "Inbound" && str(p?.from?.phoneNumber));
  return {
    telephonySessionId,
    callerNumber: inbound ? str(inbound.from!.phoneNumber) : null,
    parties: parties.map((p) => ({
      extensionId: str(p?.extensionId) ?? str(p?.to?.extensionId),
      extensionNumber: str(p?.to?.extensionNumber),
      direction: str(p?.direction),
      status: str(p?.status?.code),
    })),
  };
}

/** Did this call reach the extension (by its id, or its number when the id isn't known)? */
export function reachedExtension(event: CallEvent, ext: { id: string | null; number: string }): boolean {
  return event.parties.some(
    (p) => p.direction === "Inbound" && ((ext.id != null && p.extensionId === ext.id) || p.extensionNumber === ext.number),
  );
}

/** Calls already acted on, by telephonySessionId. Kept an hour — a call's events arrive within it. */
export class SeenCalls {
  private seen = new Map<string, number>();
  constructor(private readonly now: () => number = Date.now, private readonly keepMs = 60 * 60_000) {}

  /** True the first time a call is offered, false after. */
  first(id: string): boolean {
    const t = this.now();
    for (const [k, at] of this.seen) if (t - at > this.keepMs) this.seen.delete(k);
    if (this.seen.has(id)) return false;
    this.seen.set(id, t);
    return true;
  }
}

export interface CallEventResult {
  status: number;
  headers?: Record<string, string>;
  body: Record<string, unknown>;
  /** The parsed event to act on after answering, when there is one. */
  event?: CallEvent;
}

/** Core handler, free of Express. `validationToken` = the Validation-Token request header. */
export function handleCallEvent(token: string, validationToken: string | undefined, payload: unknown): CallEventResult {
  const secret = rcWebhookSecret();
  if (!secret) return { status: 503, body: { error: "Call events not configured (RC_WEBHOOK_SECRET missing)" } };
  if (!tokenMatches(token, secret)) return { status: 401, body: { error: "Invalid webhook token" } };

  // Subscription handshake: RingCentral POSTs with a Validation-Token header
  // and expects it back on the response (JSON content type, tiny body).
  if (validationToken) return { status: 200, headers: { "Validation-Token": validationToken }, body: {} };

  const event = parseCallEvent(payload);
  if (!event) return { status: 200, body: { ok: true, ignored: true } };
  return { status: 200, body: { ok: true }, event };
}

/** Express glue. Register BEFORE the /api/ requireAuth catch-all. `onCall` runs after the answer is sent. */
export function registerRingCentralWebhook(app: Express, onCall: (event: CallEvent) => Promise<void>): void {
  app.post("/api/webhooks/ringcentral/:token", (req: Request, res: Response) => {
    const result = handleCallEvent(String(req.params.token ?? ""), req.get("Validation-Token") ?? undefined, req.body);
    if (result.headers) res.set(result.headers);
    res.status(result.status).json(result.body);
    if (result.event) {
      onCall(result.event).catch((err) => console.error("[rc-events] handling a call failed:", err));
    }
  });
}
