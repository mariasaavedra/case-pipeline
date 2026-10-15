// =============================================================================
// Slack — one sender for every notification the app posts
// =============================================================================
// A Slack bot token (chat.postMessage) and a channel per kind, from .env:
//
//   events  SLACK_EVENTS_CHANNEL  contract signed / payment link sent, consult
//                                 prepped, mail to review, text sent, Adobe Sign
//   ops     SLACK_OPS_CHANNEL     a sync, scheduled job or Monday write failed
//   alerts  SLACK_ALERTS_CHANNEL  the morning digest (next PR)
//
// On top of that, Settings → Integrations (notify/settings.ts) turns each event
// on or off, can send it to another channel, and sets how often the same
// failure may repost. SLACK_MODE=off (default) / dry-run (logs what it would
// post) / on stays in .env. For `events` only, the older Incoming Webhook
// (SLACK_WEBHOOK_URL, the Adobe Sign alerts) still works when no channel is
// set, so turning the bot on never silences those.
//
// Everything here is best-effort: a post never throws and never delays the
// request that caused it beyond its own 10 s timeout. Content rule: client name,
// case type, a link — never A#, date of birth, receipt numbers, phone numbers,
// note or text bodies. See docs/features/sms-and-slack.md.
// =============================================================================

import { loadNotifySettings, eventDef, type NotifySettings, type NotifyEventKey } from "./settings.js";

export type SlackMode = "off" | "dry-run" | "on";
export type SlackChannelKind = "events" | "ops" | "alerts";

export const SLACK_CHANNEL_VARS: Record<SlackChannelKind, string> = {
  events: "SLACK_EVENTS_CHANNEL",
  ops: "SLACK_OPS_CHANNEL",
  alerts: "SLACK_ALERTS_CHANNEL",
};

export function slackMode(env: NodeJS.ProcessEnv = process.env): SlackMode {
  const v = env.SLACK_MODE?.trim().toLowerCase();
  return v === "on" || v === "dry-run" ? v : "off";
}

/** Escape text for Slack mrkdwn — &, < and > are control characters there. */
export function slackEscape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** `<url|label>` — a link in Slack mrkdwn. */
export function slackLink(url: string, label: string): string {
  return `<${url}|${slackEscape(label)}>`;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface SlackDeps {
  env?: NodeJS.ProcessEnv;
  settings?: () => NotifySettings;
  fetchImpl?: FetchLike;
  now?: () => number;
  log?: (msg: string) => void;
}

/** What a post did — the test button shows it. */
export type SlackPostResult = { ok: true; dryRun: boolean } | { ok: false; error: string };

/**
 * Builds a sender. The module-level exports use the real environment and the
 * saved settings; tests build their own with fakes.
 */
export function createSlackNotifier(deps: SlackDeps = {}) {
  const env = () => deps.env ?? process.env;
  const settings = deps.settings ?? loadNotifySettings;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((m: string) => console.log(m));
  const lastOps = new Map<string, number>();

  /**
   * The one place that talks to Slack. `force` = an admin pressed "Send test
   * message": post whatever SLACK_MODE says, as long as there is a token.
   */
  async function send(
    channel: string | null, kind: SlackChannelKind, text: string, force = false,
  ): Promise<SlackPostResult> {
    const e = env();
    const mode = force ? "on" : slackMode(e);
    const webhook = kind === "events" && !channel ? e.SLACK_WEBHOOK_URL?.trim() : undefined;
    if (mode === "off" && !webhook) return { ok: false, error: "SLACK_MODE is off" };
    if (!channel && !webhook) return { ok: false, error: `no ${kind} channel set` };

    if (mode === "dry-run") {
      log(`[slack] DRY RUN → ${kind}${channel ? ` (${channel})` : ""}: ${text}`);
      return { ok: true, dryRun: true };
    }
    try {
      if (channel && mode === "on") {
        const token = e.SLACK_BOT_TOKEN?.trim();
        if (!token) {
          log("[slack] SLACK_BOT_TOKEN is not set — nothing posted");
          return { ok: false, error: "SLACK_BOT_TOKEN is not set" };
        }
        const res = await fetchImpl("https://slack.com/api/chat.postMessage", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
          body: JSON.stringify({ channel, text, unfurl_links: false, unfurl_media: false }),
          signal: AbortSignal.timeout(10_000),
        });
        // Slack answers 200 with { ok: false, error } for most failures.
        const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!body.ok) {
          const error = body.error ?? `HTTP ${res.status}`;
          log(`[slack] ${kind} post refused: ${error}`);
          return { ok: false, error };
        }
        return { ok: true, dryRun: false };
      }
      if (webhook && /^https:\/\/hooks\.slack\.com\//.test(webhook)) {
        const res = await fetchImpl(webhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) log(`[slack] webhook answered ${res.status}`);
        return res.ok ? { ok: true, dryRun: false } : { ok: false, error: `webhook HTTP ${res.status}` };
      }
      return { ok: false, error: "nothing to post to" };
    } catch (err) {
      log(`[slack] ${kind} post failed: ${(err as Error).message}`);
      return { ok: false, error: (err as Error).message };
    }
  }

  const envChannel = (kind: SlackChannelKind) => env()[SLACK_CHANNEL_VARS[kind]]?.trim() || null;

  /** Where an event goes: its own channel from Settings, else its kind's from .env. Null = turned off. */
  function route(key: NotifyEventKey): { kind: SlackChannelKind; channel: string | null } | null {
    const s = settings().events[key];
    if (!s.enabled) return null;
    const { kind } = eventDef(key);
    return { kind, channel: s.channel ?? envChannel(kind) };
  }

  /** Post to the kind's .env channel (the digest; no per-event settings). */
  async function postSlack(kind: SlackChannelKind, text: string): Promise<boolean> {
    return (await send(envChannel(kind), kind, text)).ok;
  }

  /** Something happened staff want to hear about. */
  async function notifyEvent(key: NotifyEventKey, text: string): Promise<boolean> {
    const r = route(key);
    return r ? (await send(r.channel, r.kind, text)).ok : false;
  }

  /**
   * Something broke that nobody is watching for. The same `throttleKey`
   * (default: the event key; "sync:full" vs "sync:webhook" are separate) posts
   * again only after Settings' repeat limit (default 60 min), so a job failing
   * every 15 minutes is one message, not a flood. Per process: a restart may
   * repeat one.
   */
  async function notifyOps(key: NotifyEventKey, text: string, throttleKey: string = key): Promise<boolean> {
    const r = route(key);
    if (!r) return false;
    const last = lastOps.get(throttleKey);
    if (last !== undefined && now() - last < settings().opsRepeatMinutes * 60_000) return false;
    const posted = (await send(r.channel, r.kind, `:rotating_light: ${text}`)).ok;
    if (posted) lastOps.set(throttleKey, now());
    return posted;
  }

  /** Settings → Integrations → "Send test message". Posts even when SLACK_MODE isn't on. */
  function sendTest(channel: string, text: string): Promise<SlackPostResult> {
    return send(channel, "events", text, true);
  }

  return { postSlack, notifyOps, notifyEvent, sendTest };
}

const shared = createSlackNotifier();
export const postSlack = shared.postSlack;
export const notifyOps = shared.notifyOps;
export const notifyEvent = shared.notifyEvent;
export const sendSlackTest = shared.sendTest;

/**
 * Fire-and-forget: start the post, never await it in a request path. The
 * promise already swallows its own errors; this only marks intent.
 */
export function inBackground(p: Promise<unknown>): void {
  void p;
}

// -----------------------------------------------------------------------------
// Links — stable ones only. A profile's local id is regenerated by the nightly
// full sync, so a dashboard link to /clients/<localId> would break by morning;
// a Monday item link never does.
// -----------------------------------------------------------------------------

export const MONDAY_ACCOUNT_URL = "https://scaltheclinic.monday.com";

export function mondayItemUrl(boardId: string | null | undefined, itemId: string | null | undefined): string | null {
  return boardId && itemId ? `${MONDAY_ACCOUNT_URL}/boards/${boardId}/pulses/${itemId}` : null;
}

/** A dashboard page ("/alerts"), or null when FRONTEND_URL isn't set. */
export function appUrl(path: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const base = env.FRONTEND_URL?.trim().replace(/\/+$/, "");
  return base ? `${base}${path}` : null;
}

/** "text — <link|label>" when there is a link, else just the text. */
export function withLink(text: string, url: string | null, label: string): string {
  return url ? `${text} — ${slackLink(url, label)}` : text;
}
