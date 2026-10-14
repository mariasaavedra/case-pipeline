// =============================================================================
// Contract notifications — Monday bell + Slack
// =============================================================================
// Both best-effort: the stage and the note are already on Monday, so a missed
// notification is logged, never retried or surfaced as a failure.
//
// Slack is an Incoming Webhook (one channel, no Slack app or bot token):
// SLACK_WEBHOOK_URL. Unset = no Slack.
// =============================================================================

import { createNotification } from "@case-pipeline/monday";

export function slackConfigured(): boolean {
  return /^https:\/\/hooks\.slack\.com\//.test(process.env.SLACK_WEBHOOK_URL?.trim() ?? "");
}

export async function notifySlack(text: string, link?: string | null): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL?.trim();
  if (!url || !slackConfigured()) return;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: link ? `${text} <${link}|Open in Monday>` : text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) console.error(`[notify] Slack answered ${res.status}`);
  } catch (err) {
    console.error("[notify] Slack failed:", err);
  }
}

export async function notifyMonday(userId: string | null, itemId: string, text: string, token: string | undefined): Promise<void> {
  if (!userId) return;
  try {
    await createNotification(userId, itemId, text, token);
  } catch (err) {
    console.error("[notify] Monday notification failed:", err);
  }
}
