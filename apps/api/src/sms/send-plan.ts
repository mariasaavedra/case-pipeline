// =============================================================================
// SMS send — request validation and the E&A entry, as pure functions
// =============================================================================
// The route (routes/sms.ts) owns the I/O; the decisions that could text the
// wrong person or the wrong words live here, tested in send-plan.test.ts.
// =============================================================================

import { toUsE164, formatUsPhone, unfilledPlaceholders, smsSegments } from "@case-pipeline/core";
import type { CreateTimelineItemInput } from "@case-pipeline/monday";

/** Where in the app a text was sent from — kept on the log row and the audit entry. */
export const SMS_CONTEXTS = ["call_log", "payment_links", "client", "upload_link", "buzon"] as const;
export type SmsContext = (typeof SMS_CONTEXTS)[number];

/** Longest body accepted: 6 GSM segments. Longer texts arrive split and out of order on some phones. */
export const SMS_BODY_MAX = 918;

export interface SmsSendRequest {
  to: string;
  body: string;
  context: SmsContext;
  templateKey: string | null;
  language: "en" | "es" | null;
  profileLocalId: string | null;
}

export function parseSmsSendBody(raw: unknown): { ok: true; value: SmsSendRequest } | { ok: false; error: string } {
  const b = (raw ?? {}) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");

  const to = toUsE164(s(b.to));
  if (!to) return { ok: false, error: "to must be a US phone number (10 digits)" };

  const body = s(b.body);
  if (!body) return { ok: false, error: "body is required" };
  if (body.length > SMS_BODY_MAX) return { ok: false, error: `the text is too long (max ${SMS_BODY_MAX} characters)` };
  const unfilled = unfilledPlaceholders(body);
  if (unfilled.length) return { ok: false, error: `fill in ${unfilled.map((p) => `{{${p}}}`).join(", ")} before sending` };

  const context = s(b.context) as SmsContext;
  if (!SMS_CONTEXTS.includes(context)) return { ok: false, error: `context must be one of ${SMS_CONTEXTS.join(", ")}` };

  const lang = s(b.language);
  return {
    ok: true,
    value: {
      to,
      body,
      context,
      templateKey: s(b.templateKey) || null,
      language: lang === "en" || lang === "es" ? lang : null,
      profileLocalId: s(b.profileLocalId) || null,
    },
  };
}

/**
 * The Emails & Activities entry on the client's profile:
 *
 *   title:   Text sent to (816) 555-1234
 *   content: the text, as sent
 */
export function smsActivity(
  req: Pick<SmsSendRequest, "to" | "body">,
  profileMondayId: string,
  customActivityId: string,
): CreateTimelineItemInput {
  const segs = smsSegments(req.body).segments;
  return {
    itemId: profileMondayId,
    title: `Text sent to ${formatUsPhone(req.to)}`,
    customActivityId,
    content: req.body + (segs > 1 ? `\n\n(${segs} SMS segments)` : ""),
    phone: req.to,
  };
}
