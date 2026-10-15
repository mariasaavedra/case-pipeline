// =============================================================================
// Slack — one sender for every notification the app posts
// =============================================================================
// A Slack app with a bot token (chat.postMessage), one channel per kind:
//
//   events  SLACK_EVENTS_CHANNEL  contract signed / payment link sent, consult
//                                 prepped, mail to review, text sent, Adobe Sign
//   ops     SLACK_OPS_CHANNEL     a sync, scheduled job or Monday write failed —
//                                 at most one post per kind per hour
//   alerts  SLACK_ALERTS_CHANNEL  the morning digest (next PR)
//
// An empty channel id = that kind is off. SLACK_MODE=off (default) / dry-run
// (logs what it would post) / on. For `events` only, the older Incoming
// Webhook (SLACK_WEBHOOK_URL, the Adobe Sign alerts) still works when no bot
// channel is set, so turning the bot on never silences those.
//
// Everything here is best-effort: a post never throws and never delays the
// request that caused it beyond its own 10 s timeout. Content rule: client name,
// case type, a link — never A#, date of birth, receipt numbers or note text.
// See docs/features/sms-and-slack.md.
// =============================================================================

export type SlackMode = "off" | "dry-run" | "on";
export type SlackChannelKind = "events" | "ops" | "alerts";

const CHANNEL_VARS: Record<SlackChannelKind, string> = {
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
  fetchImpl?: FetchLike;
  now?: () => number;
  log?: (msg: string) => void;
}

/**
 * Builds a sender. The module-level `postSlack` / `notifyOps` / `notifyEvent`
 * use the real environment; tests build their own with fakes.
 */
export function createSlackNotifier(deps: SlackDeps = {}) {
  const env = () => deps.env ?? process.env;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((m: string) => console.log(m));
  const lastOps = new Map<string, number>();

  /** Post `text` (already mrkdwn) to the channel for `kind`. True when it was posted (or would be, in dry-run). */
  async function postSlack(kind: SlackChannelKind, text: string): Promise<boolean> {
    const e = env();
    const mode = slackMode(e);
    const channel = e[CHANNEL_VARS[kind]]?.trim();
    const webhook = kind === "events" && !channel ? e.SLACK_WEBHOOK_URL?.trim() : undefined;
    if (mode === "off" && !webhook) return false;
    if (!channel && !webhook) return false;

    if (mode === "dry-run") {
      log(`[slack] DRY RUN → ${kind}: ${text}`);
      return true;
    }
    try {
      if (channel && mode === "on") {
        const token = e.SLACK_BOT_TOKEN?.trim();
        if (!token) {
          log("[slack] SLACK_BOT_TOKEN is not set — nothing posted");
          return false;
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
          log(`[slack] ${kind} post refused: ${body.error ?? `HTTP ${res.status}`}`);
          return false;
        }
        return true;
      }
      if (webhook && /^https:\/\/hooks\.slack\.com\//.test(webhook)) {
        const res = await fetchImpl(webhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) log(`[slack] webhook answered ${res.status}`);
        return res.ok;
      }
      return false;
    } catch (err) {
      log(`[slack] ${kind} post failed: ${(err as Error).message}`);
      return false;
    }
  }

  /**
   * Something broke that nobody is watching for. Throttled per `key` (e.g.
   * "sync:full", "write-queue") to one post an hour, so a job failing every 15
   * minutes is one message, not a flood. The throttle is per process: a
   * restart may repeat one.
   */
  async function notifyOps(key: string, text: string, throttleMs = 60 * 60 * 1000): Promise<boolean> {
    const last = lastOps.get(key);
    if (last !== undefined && now() - last < throttleMs) return false;
    const posted = await postSlack("ops", `:rotating_light: ${text}`);
    if (posted) lastOps.set(key, now());
    return posted;
  }

  /** Something happened staff want to hear about. Not throttled. */
  function notifyEvent(text: string): Promise<boolean> {
    return postSlack("events", text);
  }

  return { postSlack, notifyOps, notifyEvent };
}

const shared = createSlackNotifier();
export const postSlack = shared.postSlack;
export const notifyOps = shared.notifyOps;
export const notifyEvent = shared.notifyEvent;

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
