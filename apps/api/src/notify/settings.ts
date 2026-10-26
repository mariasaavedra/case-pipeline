// =============================================================================
// Notification settings — which Slack posts go out, and where
// =============================================================================
// Admin-edited in Settings → Integrations (P11.5), stored in
// data/notify-settings.json. Secrets and the on/off switch stay in .env
// (SLACK_BOT_TOKEN, SLACK_MODE): this file only says, per event, whether it is
// posted and to which channel (null = the kind's channel from .env), plus how
// often the same failure may repost.
//
// The catalog below is the list of everything the app can post. A key that is
// absent from the file uses its default, so a new event ships ON without anyone
// re-saving the settings.
// =============================================================================

import fs from "node:fs";
import path from "node:path";
import type { SlackChannelKind } from "./slack.js";

export interface NotifyEventDef {
  key: string;
  kind: SlackChannelKind;
  label: string;
  /** One line for the settings page: when it posts. */
  description: string;
  /** Sent as direct messages to people, not to a channel (no channel picker). */
  dm?: boolean;
}

export const NOTIFY_EVENTS = [
  { key: "contract_signed", kind: "events", label: "Contract signed", description: "Staff record the client's signature on a Fee K (P14)" },
  { key: "payment_link_sent", kind: "events", label: "Payment link sent", description: "A Fee K moves to Payment link sent (P14 or Text links to client)" },
  { key: "consult_prepped", kind: "events", label: "Consult prepped", description: "Reception saves a consult prep (M18)" },
  { key: "consult_ready", kind: "events", label: "Consult ready (to the attorney)", description: "Reception's queued \"LB's 1:00 PM Ready\" message, posted at the consult's time (M18 → P17 Slack Queue). Set the attorneys' channel here" },
  { key: "mail_scanned", kind: "events", label: "Mail filed", description: "A piece of mail is filed to a client from the Mail page" },
  { key: "sms_sent", kind: "events", label: "Text sent", description: "A real text goes to a client (never the number or the words)" },
  { key: "esign", kind: "events", label: "Adobe Sign updates", description: "Signed / rejected / expired / recalled contracts from Adobe Sign" },
  { key: "payment_received", kind: "events", label: "Payment received", description: "A LawPay payment matched to a Fee K (and when it's fully paid)" },
  { key: "client_upload", kind: "events", label: "Client sent documents", description: "Documents a client sent through their upload link are filed in their E-File → CAF" },
  { key: "buzon", kind: "events", label: "Buzón", description: "A paid Fee K's Buzón went out (or couldn't be texted), every document on the list came in, a client stopped answering reminders" },
  { key: "ops_buzon", kind: "ops", label: "Buzón job failed", description: "The Buzón's automatic start or reminders failed" },
  { key: "target_dates_digest", kind: "events", label: "Target dates digest", description: "Weekdays at 8 AM: a direct message to each admin with the target dates overdue or due this week (P24). Goes to the admins' Slack ids in the staff roster", dm: true },
  { key: "payment_unmatched", kind: "events", label: "Payment to match", description: "A LawPay payment the app couldn't tie to a Fee K — someone should file it" },
  { key: "ops_sync", kind: "ops", label: "Sync failed", description: "A Monday sync (nightly, daytime or webhook) exits with an error" },
  { key: "ops_write_queue", kind: "ops", label: "Monday write gave up", description: "A queued write to Monday failed every retry" },
  { key: "ops_consult_sweep", kind: "ops", label: "Consult sweep failed", description: "The consult-folder / summary sweep failed" },
  { key: "ops_drive_intake", kind: "ops", label: "Drive intake failed", description: "Copying client uploads from Google Drive failed" },
  { key: "ops_client_uploads", kind: "ops", label: "Client uploads stuck", description: "Filing client uploads failed, or a client's files have had nowhere to go for a day" },
  { key: "ops_fee_k_autofill", kind: "ops", label: "Fee K auto-fill failed", description: "The Fee K auto-fill run failed" },
  { key: "ops_lawpay_mail", kind: "ops", label: "LawPay payments failed", description: "Reading LawPay payments (Slack #payments or the receipts inbox) failed" },
  { key: "ops_backup", kind: "ops", label: "Backup failed", description: "The daily database backup failed" },
] as const satisfies readonly NotifyEventDef[];

export type NotifyEventKey = (typeof NOTIFY_EVENTS)[number]["key"];

export interface NotifyEventSetting {
  enabled: boolean;
  /** Slack channel id; null = the kind's channel from .env. */
  channel: string | null;
}

export interface NotifySettings {
  events: Record<NotifyEventKey, NotifyEventSetting>;
  /** The same failure posts again only after this many minutes. */
  opsRepeatMinutes: number;
}

export const OPS_REPEAT_MIN = 5;
export const OPS_REPEAT_MAX = 24 * 60;

export function defaultNotifySettings(): NotifySettings {
  return {
    events: Object.fromEntries(NOTIFY_EVENTS.map((e) => [e.key, { enabled: true, channel: null }])) as NotifySettings["events"],
    opsRepeatMinutes: 60,
  };
}

const CHANNEL_ID_RE = /^[CG][A-Z0-9]{8,}$/;

/** Coerce untrusted input; unknown keys dropped, bad channel ids → default channel. */
export function sanitizeNotifySettings(input: unknown): NotifySettings {
  const o = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const ev = (typeof o.events === "object" && o.events !== null ? o.events : {}) as Record<string, unknown>;
  const out = defaultNotifySettings();
  for (const def of NOTIFY_EVENTS) {
    const raw = ev[def.key];
    if (typeof raw !== "object" || raw === null) continue;
    const r = raw as Record<string, unknown>;
    const channel = typeof r.channel === "string" ? r.channel.trim() : "";
    out.events[def.key] = {
      enabled: r.enabled !== false,
      channel: CHANNEL_ID_RE.test(channel) ? channel : null,
    };
  }
  const minutes = Number(o.opsRepeatMinutes);
  if (Number.isFinite(minutes)) {
    out.opsRepeatMinutes = Math.min(OPS_REPEAT_MAX, Math.max(OPS_REPEAT_MIN, Math.round(minutes)));
  }
  return out;
}

let configPath: string | null = null;
let cache: NotifySettings | null = null;

export function initNotifySettings(dataDir: string): void {
  configPath = path.join(dataDir, "notify-settings.json");
  cache = null;
}

/** Read on every post would be a disk read per event; cached, refreshed on save. */
export function loadNotifySettings(): NotifySettings {
  if (cache) return cache;
  if (!configPath) return defaultNotifySettings();
  try {
    cache = sanitizeNotifySettings(JSON.parse(fs.readFileSync(configPath, "utf-8")));
  } catch {
    cache = defaultNotifySettings();
  }
  return cache;
}

export function saveNotifySettings(input: unknown): NotifySettings {
  if (!configPath) throw new Error("notify-settings path not initialized");
  const clean = sanitizeNotifySettings(input);
  fs.writeFileSync(configPath, JSON.stringify(clean, null, 2));
  cache = clean;
  return clean;
}

export function eventDef(key: NotifyEventKey): NotifyEventDef {
  return NOTIFY_EVENTS.find((e) => e.key === key)!;
}
