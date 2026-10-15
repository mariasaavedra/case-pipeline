// =============================================================================
// Contract notifications — Monday bell + Slack
// =============================================================================
// Both best-effort: the stage and the note are already on Monday, so a missed
// notification is logged, never retried or surfaced as a failure.
//
// Slack goes through notify/slack.ts: the bot's events channel when
// SLACK_EVENTS_CHANNEL is set, else the original Incoming Webhook
// (SLACK_WEBHOOK_URL). Neither = no Slack.
// =============================================================================

import { createNotification } from "@case-pipeline/monday";
import { notifyEvent, slackEscape, withLink } from "../notify/slack.js";

export async function notifySlack(text: string, link?: string | null): Promise<void> {
  await notifyEvent("esign", withLink(slackEscape(text), link ?? null, "Open in Monday"));
}

export async function notifyMonday(userId: string | null, itemId: string, text: string, token: string | undefined): Promise<void> {
  if (!userId) return;
  try {
    await createNotification(userId, itemId, text, token);
  } catch (err) {
    console.error("[notify] Monday notification failed:", err);
  }
}
