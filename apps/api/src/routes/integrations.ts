// =============================================================================
// Settings → Integrations (P11.5) — Slack + texting status and settings
// =============================================================================
//   GET  /api/settings/integrations                 status of both + Slack event settings
//   GET  /api/settings/integrations/slack/channels  channels the bot can post to
//   PUT  /api/settings/notify                       save Slack event settings (audited)
//   POST /api/settings/integrations/slack/test      post a test message (audited)
//   POST /api/settings/integrations/sms/check       RingCentral connection check (read-only)
//
// Admin-only. Secrets never leave the server: the page learns that a token is
// set and whose it is, never the token. SLACK_MODE / SMS_MODE stay in .env.
// =============================================================================

import type { Express } from "express";
import { requireAuth, requireAdmin } from "../auth/middleware.js";
import { auditFromReq } from "../audit/log.js";
import { slackMode, sendSlackTest, SLACK_CHANNEL_VARS, type SlackChannelKind } from "../notify/slack.js";
import { NOTIFY_EVENTS, loadNotifySettings, saveNotifySettings, OPS_REPEAT_MIN, OPS_REPEAT_MAX } from "../notify/settings.js";
import { smsMode, ringCentralConfig } from "../sms/ringcentral.js";
import { checkRingCentral, TEN_DLC_NOTE } from "../sms/check.js";
import { loadSmsTemplates } from "../sms/templates.js";
import { formatUsPhone } from "@case-pipeline/core";

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface SlackChannelInfo {
  id: string;
  name: string;
  isPrivate: boolean;
  /** The bot is in it. A public channel it isn't in still works (chat:write.public), a private one doesn't. */
  isMember: boolean;
}

/** GET a Slack Web API method with the bot token. */
async function slackApi(method: string, params: Record<string, string>, fetchImpl: FetchLike): Promise<Record<string, unknown>> {
  const token = process.env.SLACK_BOT_TOKEN?.trim();
  if (!token) return { ok: false, error: "SLACK_BOT_TOKEN is not set" };
  try {
    const res = await fetchImpl(`https://slack.com/api/${method}?${new URLSearchParams(params)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    return (await res.json()) as Record<string, unknown>;
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export interface IntegrationsDeps {
  fetchImpl?: FetchLike;
  now?: () => number;
}

export function registerIntegrationRoutes(app: Express, deps: IntegrationsDeps = {}): void {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;

  // Slack's own rate limits are tight on conversations.list; the page reloads often.
  let botCache: { at: number; value: unknown } | null = null;
  let channelCache: { at: number; value: SlackChannelInfo[] | { error: string } } | null = null;
  const TTL = 5 * 60 * 1000;

  async function slackBot() {
    if (botCache && now() - botCache.at < TTL) return botCache.value;
    const r = await slackApi("auth.test", {}, fetchImpl);
    const value = r.ok ? { name: String(r.user ?? ""), team: String(r.team ?? "") } : { error: String(r.error ?? "unknown") };
    botCache = { at: now(), value };
    return value;
  }

  async function slackChannels(refresh: boolean) {
    if (!refresh && channelCache && now() - channelCache.at < TTL) return channelCache.value;
    const out: SlackChannelInfo[] = [];
    let cursor = "";
    // Up to 5 pages of 200 — plenty for a firm workspace.
    for (let page = 0; page < 5; page++) {
      const r = await slackApi(
        "conversations.list",
        { types: "public_channel,private_channel", exclude_archived: "true", limit: "200", ...(cursor ? { cursor } : {}) },
        fetchImpl,
      );
      if (!r.ok) {
        const value = { error: String(r.error ?? "unknown") };
        channelCache = { at: now(), value };
        return value;
      }
      for (const c of (r.channels as Array<Record<string, unknown>>) ?? []) {
        out.push({ id: String(c.id), name: String(c.name), isPrivate: !!c.is_private, isMember: !!c.is_member });
      }
      cursor = String((r.response_metadata as { next_cursor?: string } | undefined)?.next_cursor ?? "");
      if (!cursor) break;
    }
    out.sort((a, b) => Number(b.isMember) - Number(a.isMember) || a.name.localeCompare(b.name));
    channelCache = { at: now(), value: out };
    return out;
  }

  app.get("/api/settings/integrations", requireAuth, requireAdmin, async (_req, res) => {
    const envChannels = Object.fromEntries(
      (Object.keys(SLACK_CHANNEL_VARS) as SlackChannelKind[]).map((k) => [k, process.env[SLACK_CHANNEL_VARS[k]]?.trim() || null]),
    );
    const tokenSet = !!process.env.SLACK_BOT_TOKEN?.trim();
    const rc = ringCentralConfig();
    res.json({
      data: {
        slack: {
          mode: slackMode(),
          tokenSet,
          bot: tokenSet ? await slackBot() : null,
          webhookSet: !!process.env.SLACK_WEBHOOK_URL?.trim(),
          envChannels,
          catalog: NOTIFY_EVENTS,
          settings: loadNotifySettings(),
          opsRepeatLimits: { min: OPS_REPEAT_MIN, max: OPS_REPEAT_MAX },
        },
        sms: {
          mode: smsMode(),
          configured: !!rc,
          fromNumber: rc ? formatUsPhone(rc.fromNumber) : null,
          templates: loadSmsTemplates().length,
          tenDlcNote: TEN_DLC_NOTE,
        },
      },
    });
  });

  app.get("/api/settings/integrations/slack/channels", requireAuth, requireAdmin, async (req, res) => {
    const r = await slackChannels(req.query.refresh === "1");
    if ("error" in r) return res.status(502).json({ error: `Slack: ${r.error}` });
    res.json({ data: r });
  });

  app.put("/api/settings/notify", requireAuth, requireAdmin, (req, res) => {
    try {
      const saved = saveNotifySettings(req.body);
      auditFromReq(req, "notify_settings.updated", {
        targetType: "settings",
        targetId: "notify",
        metadata: {
          off: Object.entries(saved.events).filter(([, s]) => !s.enabled).map(([k]) => k),
          rerouted: Object.entries(saved.events).filter(([, s]) => s.channel).map(([k, s]) => `${k}→${s.channel}`),
          opsRepeatMinutes: saved.opsRepeatMinutes,
        },
      });
      res.json({ data: saved });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post("/api/settings/integrations/slack/test", requireAuth, requireAdmin, async (req, res) => {
    const channel = typeof req.body?.channel === "string" ? req.body.channel.trim() : "";
    if (!/^[CG][A-Z0-9]{8,}$/.test(channel)) return res.status(400).json({ error: "channel must be a Slack channel id" });
    const by = req.user?.name ?? "an admin";
    const r = await sendSlackTest(channel, `:test_tube: Test from Case Pipeline Settings — sent by ${by}. Notifications for this channel will look like this.`);
    auditFromReq(req, "slack.test_sent", { targetType: "settings", targetId: "notify", metadata: { channel, ok: r.ok } });
    if (!r.ok) return res.status(502).json({ error: `Slack: ${r.error}` });
    res.json({ data: { posted: true } });
  });

  app.post("/api/settings/integrations/sms/check", requireAuth, requireAdmin, async (_req, res) => {
    try {
      const r = await checkRingCentral();
      res.json({ data: { ok: r.ok, steps: r.steps } });
    } catch (err) {
      res.json({ data: { ok: false, steps: [{ ok: false, label: `check failed: ${(err as Error).message}` }] } });
    }
  });
}
