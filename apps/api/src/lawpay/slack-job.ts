// =============================================================================
// Every 2 minutes: #payments → Fee Ks (LAWPAY_SLACK=on)
// =============================================================================
// Reads new posts in the #payments channel (LAWPAY_SLACK_CHANNEL, default
// C0922BS65LM) with the app's Slack bot (SLACK_BOT_TOKEN; it's a member and has
// channels:history), keeps the "Payment Bot" LawPay transactions whose
// reference is one of ours (slack.ts) and hands them to ingestLawPayReceipts —
// each post once (users.db lawpay_events.source = "slack:<ts>").
//
// How far it has read is kept in data/lawpay-slack-cursor.json and moves only
// after every new post was handled, so a failed run is simply read again. The
// first run looks back LAWPAY_SLACK_SINCE_DAYS (default 3). Slack limits
// history reads for apps like ours (about one a minute, 15 posts each), so
// pages are fetched one at a time and a 429 waits as Slack asks.
// =============================================================================

import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../paths.js";
import { findFeeK, ingestLawPayReceipts, type LawPayDeps, type LawPayResult, type MailReceipt } from "../routes/lawpay.js";
import { parsePaymentBotPost } from "./slack.js";

export const DEFAULT_PAYMENTS_CHANNEL = "C0922BS65LM";
const CURSOR_FILE = () => path.join(DATA_DIR, "lawpay-slack-cursor.json");

interface SlackMessage { ts: string; text?: string; subtype?: string; bot_profile?: { name?: string } }
interface HistoryPage { ok: boolean; error?: string; messages?: SlackMessage[]; has_more?: boolean; response_metadata?: { next_cursor?: string } }

export type SlackFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface DryRunRow { ts: string; payer: string | null; amount: number; reference: string; feeK: string | null; by: string | null }

export type SlackJobOutcome =
  | { ok: true; read: number; payments: number; applied: LawPayResult[]; dryRun?: DryRunRow[] }
  | { ok: false; error: string };

function readCursor(): string | null {
  try {
    return (JSON.parse(fs.readFileSync(CURSOR_FILE(), "utf8")) as { ts?: string }).ts ?? null;
  } catch {
    return null;
  }
}
function writeCursor(ts: string): void {
  fs.writeFileSync(CURSOR_FILE(), JSON.stringify({ ts, at: new Date().toISOString() }));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Every post newer than `oldest`, oldest first. Waits out rate limits. */
async function history(token: string, channel: string, oldest: string, doFetch: SlackFetch, wait: (ms: number) => Promise<unknown>): Promise<SlackMessage[]> {
  const out: SlackMessage[] = [];
  let cursor = "";
  for (let page = 0; page < 40; page++) {
    const q = new URLSearchParams({ channel, oldest, limit: "15", ...(cursor ? { cursor } : {}) });
    const res = await doFetch(`https://slack.com/api/conversations.history?${q}`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 429) {
      await wait((Number(res.headers.get("retry-after")) || 60) * 1000);
      page--;
      continue;
    }
    const body = (await res.json()) as HistoryPage;
    if (!body.ok) throw new Error(`Slack: ${body.error ?? res.status}`);
    out.push(...(body.messages ?? []));
    cursor = body.response_metadata?.next_cursor ?? "";
    if (!body.has_more || !cursor) break;
  }
  return out.sort((a, b) => Number(a.ts) - Number(b.ts));
}

let inFlight = false;

export async function runLawPaySlackJob(
  deps: LawPayDeps,
  opts: { env?: NodeJS.ProcessEnv; fetch?: SlackFetch; wait?: (ms: number) => Promise<unknown>; now?: number; dryRun?: boolean } = {},
): Promise<SlackJobOutcome | null> {
  if (inFlight) return null;
  inFlight = true;
  try {
    const env = opts.env ?? process.env;
    const token = env.SLACK_BOT_TOKEN?.trim();
    if (!token) return { ok: false, error: "SLACK_BOT_TOKEN is not set" };
    const channel = env.LAWPAY_SLACK_CHANNEL?.trim() || DEFAULT_PAYMENTS_CHANNEL;
    const sinceDays = Math.min(Math.max(Number(env.LAWPAY_SLACK_SINCE_DAYS ?? 3) || 3, 1), 30);
    // A dry run always looks back the full window and never moves the cursor.
    const oldest = (!opts.dryRun && readCursor()) || String(((opts.now ?? Date.now()) - sinceDays * 86_400_000) / 1000);

    const posts = await history(token, channel, oldest, opts.fetch ?? fetch, opts.wait ?? sleep);
    const receipts: MailReceipt[] = posts.flatMap((m) => {
      const r = m.text ? parsePaymentBotPost(m.text) : null;
      return r ? [{ ...r, messageId: `slack:${m.ts}`, receivedAt: new Date(Number(m.ts) * 1000).toISOString() }] : [];
    });
    if (opts.dryRun) {
      // What it would do — nothing stored, nothing written, the cursor stays.
      const dryRun = receipts.map((r) => {
        const m = findFeeK(deps.db, r);
        return { ts: r.messageId, payer: r.payer, amount: r.amount, reference: r.reference, feeK: m.row ? `${m.row.clientName} (${m.row.group ?? "?"})` : null, by: m.by };
      });
      return { ok: true, read: posts.length, payments: receipts.length, applied: [], dryRun };
    }
    const applied = await ingestLawPayReceipts(deps, receipts);
    if (posts.length) writeCursor(posts[posts.length - 1]!.ts);
    return { ok: true, read: posts.length, payments: receipts.length, applied };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "error" };
  } finally {
    inFlight = false;
  }
}
