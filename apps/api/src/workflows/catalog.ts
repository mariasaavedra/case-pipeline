// =============================================================================
// Workflows catalog (Settings → Workflows, P11.7) — every automation the app runs
// =============================================================================
// One entry per automation, in plain words: when it runs, what it does, the
// setting that switches it on, and where its run history comes from. Read-only:
// the switches stay in .env (a change needs a redeploy).
//
// Adding a background job? Add it here, and wrap its run in trackRun()
// (workflows/runs.ts) with the same key, or it shows as "never ran".
//
// `enabled()` names the setting, never its value. The cron defaults below are
// the ones server.ts schedules with; each can be overridden by its *_CRON.
// =============================================================================

import { clientUploadsConfig } from "../uploads/rules.js";
import { slackMode } from "../notify/slack.js";
import type { NotifyEventKey } from "../notify/settings.js";

export type WorkflowGroup = "monday" | "payments" | "files" | "messages" | "maintenance" | "external";

export const WORKFLOW_GROUPS: { id: WorkflowGroup; label: string }[] = [
  { id: "monday", label: "Monday data" },
  { id: "payments", label: "Contracts & payments" },
  { id: "files", label: "Client files" },
  { id: "messages", label: "Messages" },
  { id: "maintenance", label: "Maintenance" },
  { id: "external", label: "Outside the app" },
];

/**
 * Where a workflow's runs are read from: our own ledger (job_runs), a table
 * the feature already keeps one row per item in, or nothing we can see.
 */
export type WorkflowHistory = "job_runs" | "write_queue" | "webhook_events" | "slack_queue" | "esign" | "none";

export interface WorkflowContext {
  env: NodeJS.ProcessEnv;
  /** The API is on live.db (scheduled jobs only run there). */
  live: boolean;
}

export interface WorkflowSwitch {
  on: boolean;
  /** Why it's off (or what it's limited to) — names the setting, never its value. */
  reason?: string;
}

export interface WorkflowDef {
  key: string;
  name: string;
  /** "When …" — what starts it. */
  when: string;
  /** "Then …" — what it does. */
  then: string;
  group: WorkflowGroup;
  kind: "scheduled" | "event" | "external";
  /** Scheduled only: the cron, after any *_CRON override, and the zone it runs in. */
  schedule?: (env: NodeJS.ProcessEnv) => { cron: string; firmTime: boolean };
  enabled: (ctx: WorkflowContext) => WorkflowSwitch;
  history: WorkflowHistory;
  /** Slack ops event that fires when it fails (Settings → Integrations). */
  opsEvent?: NotifyEventKey;
  /** Feature doc, relative to the repo root. */
  doc?: string;
}

const isOn = (env: NodeJS.ProcessEnv, name: string) => env[name]?.trim().toLowerCase() === "on";
const isSet = (env: NodeJS.ProcessEnv, name: string) => !!env[name]?.trim();
const cronOf = (name: string, fallback: string, firmTime: boolean) => (env: NodeJS.ProcessEnv) => ({
  cron: env[name]?.trim() || fallback,
  firmTime,
});

const LIVE_ONLY: WorkflowSwitch = { on: false, reason: "Only runs on live data" };

/** Live data + an `X=on` switch: the shape most scheduled jobs share. */
function liveSwitch(name: string, ...alsoNeeds: string[]) {
  return ({ env, live }: WorkflowContext): WorkflowSwitch => {
    if (!live) return LIVE_ONLY;
    if (!isOn(env, name)) return { on: false, reason: `Off — ${name} isn't on` };
    const missing = alsoNeeds.filter((n) => !isSet(env, n));
    if (missing.length) return { on: false, reason: `Not set up — needs ${missing.join(" and ")}` };
    return { on: true };
  };
}

export const WORKFLOWS: WorkflowDef[] = [
  // ── Monday data ────────────────────────────────────────────────────────────
  {
    key: "sync_full",
    name: "Nightly full sync",
    when: "Every night",
    then: "Reload every board from Monday, including deleted items and e-mails & activities",
    group: "monday", kind: "scheduled",
    schedule: cronOf("SYNC_FULL_CRON", "0 1 * * *", false),
    enabled: liveSwitch("NIGHTLY_SYNC", "MONDAY_API_TOKEN"),
    history: "job_runs", opsEvent: "ops_sync", doc: "docs/features/live-data-sync.md",
  },
  {
    key: "sync_incremental",
    name: "Daytime sync",
    when: "Every 2 hours during the day",
    then: "Pick up column changes made in Monday since the last sync",
    group: "monday", kind: "scheduled",
    schedule: cronOf("SYNC_INCREMENTAL_CRON", "0 7-19/2 * * *", false),
    enabled: liveSwitch("NIGHTLY_SYNC", "MONDAY_API_TOKEN"),
    history: "job_runs", opsEvent: "ops_sync", doc: "docs/features/live-data-sync.md",
  },
  {
    key: "webhooks",
    name: "Live changes from Monday",
    when: "Someone changes an item in Monday",
    then: "Refresh that item here within a minute and add the change to its history",
    group: "monday", kind: "event",
    enabled: ({ env, live }) => {
      if (!live) return LIVE_ONLY;
      if (!isSet(env, "MONDAY_WEBHOOK_SECRET")) return { on: false, reason: "Off — MONDAY_WEBHOOK_SECRET isn't set" };
      if (!isSet(env, "MONDAY_API_TOKEN")) return { on: false, reason: "Not set up — needs MONDAY_API_TOKEN" };
      return { on: true };
    },
    history: "webhook_events", opsEvent: "ops_sync", doc: "docs/webhooks.md",
  },
  {
    key: "write_queue",
    name: "Retry Monday writes",
    when: "A change made here can't reach Monday (outage or rate limit)",
    then: "Retry it every minute until Monday accepts it, up to 5 tries",
    group: "monday", kind: "scheduled",
    schedule: () => ({ cron: "* * * * *", firmTime: false }),
    enabled: ({ env, live }) => {
      if (!live) return LIVE_ONLY;
      return isSet(env, "MONDAY_API_TOKEN") ? { on: true } : { on: false, reason: "Not set up — needs MONDAY_API_TOKEN" };
    },
    history: "write_queue", opsEvent: "ops_write_queue", doc: "docs/features/monday-write-back.md",
  },

  // ── Contracts & payments ───────────────────────────────────────────────────
  {
    key: "fee_k_autofill",
    name: "Fee K auto-fill",
    when: "Every 15 minutes during the day",
    then: "Fill empty Fee K columns: POC name from the Jail Intake, 3% card surcharges, \"It will go to…\"",
    group: "payments", kind: "scheduled",
    schedule: cronOf("FEE_K_AUTOFILL_CRON", "*/15 7-20 * * *", true),
    enabled: liveSwitch("FEE_K_AUTOFILL", "FEE_K_AUTOFILL_SINCE", "MONDAY_API_TOKEN"),
    history: "job_runs", opsEvent: "ops_fee_k_autofill", doc: "docs/features/fee-k-autofill.md",
  },
  {
    key: "lawpay_slack",
    name: "LawPay payments (Slack #payments)",
    when: "Every 2 minutes",
    then: "Read new Payment Bot posts, match each to its Fee K, add a note, notify the sender, move fully paid Fee Ks to Paid",
    group: "payments", kind: "scheduled",
    schedule: cronOf("LAWPAY_SLACK_CRON", "*/2 * * * *", true),
    enabled: liveSwitch("LAWPAY_SLACK", "SLACK_BOT_TOKEN"),
    history: "job_runs", opsEvent: "ops_lawpay_mail", doc: "docs/features/lawpay-payments.md",
  },
  {
    key: "lawpay_mail",
    name: "LawPay payments (receipt e-mails)",
    when: "Every 10 minutes",
    then: "Read LawPay receipts forwarded to importantdocuments@ and apply them like the Slack reader",
    group: "payments", kind: "scheduled",
    schedule: cronOf("LAWPAY_MAIL_CRON", "*/10 * * * *", true),
    enabled: liveSwitch("LAWPAY_MAIL"),
    history: "job_runs", opsEvent: "ops_lawpay_mail", doc: "docs/features/lawpay-payments.md",
  },
  {
    key: "esign",
    name: "Adobe Sign updates",
    when: "Adobe Sign reports a signature, rejection, expiry or recall (through Zapier)",
    then: "Move the Fee K to its next stage, add a note, notify the sender and Slack, attach the signed copy",
    group: "payments", kind: "event",
    // Same three settings as esignConfig() (routes/esign.ts), which isn't
    // imported here: that module opens users.db on import.
    enabled: ({ env }) => {
      const missing = ["ZAPIER_ESIGN_HOOK_URL", "ZAPIER_ESIGN_SECRET", "API_URL"].filter((n) => !isSet(env, n));
      return missing.length ? { on: false, reason: `Not set up — needs ${missing.join(", ")}` } : { on: true };
    },
    history: "esign", doc: "docs/features/esign-zapier.md",
  },

  // ── Client files ───────────────────────────────────────────────────────────
  {
    key: "consult_sweep",
    name: "Consult folders & summaries",
    when: "Every 2 hours during the day, and after a consult note",
    then: "Create the client's SharePoint consult folder and write the consultation summary into it",
    group: "files", kind: "scheduled",
    schedule: cronOf("CONSULT_SWEEP_CRON", "30 7-19/2 * * *", true),
    enabled: liveSwitch("CONSULT_FOLDERS"),
    history: "job_runs", opsEvent: "ops_consult_sweep", doc: "docs/sharepoint-folders.md",
  },
  {
    key: "drive_intake",
    name: "Google Drive uploads",
    when: "Every 15 minutes during the day",
    then: "Copy what clients put in their Drive consult folder to SharePoint, with an update on the Monday appointment",
    group: "files", kind: "scheduled",
    schedule: cronOf("DRIVE_INTAKE_CRON", "*/15 7-20 * * *", true),
    enabled: liveSwitch("DRIVE_INTAKE"),
    history: "job_runs", opsEvent: "ops_drive_intake", doc: "docs/features/drive-intake.md",
  },
  {
    key: "client_uploads",
    name: "Client upload links",
    when: "A client's upload link has been quiet 10 minutes (checked every 15)",
    then: "File what they sent in their E-File → CAF and post one update on their profile",
    group: "files", kind: "scheduled",
    schedule: cronOf("CLIENT_UPLOADS_CRON", "*/15 * * * *", true),
    enabled: ({ env, live }) => {
      if (!isOn(env, "CLIENT_UPLOADS")) return { on: false, reason: "Off — CLIENT_UPLOADS isn't on" };
      if (!clientUploadsConfig(env)) return { on: false, reason: "Not set up — needs API_URL" };
      return live ? { on: true } : { on: true, reason: "Seed data: plans only, files nothing" };
    },
    history: "job_runs", opsEvent: "ops_client_uploads", doc: "docs/features/client-uploads.md",
  },

  // ── Messages ───────────────────────────────────────────────────────────────
  {
    key: "slack_queue",
    name: "Consult ready messages",
    when: "Reception queues an attorney's \"Ready\" message (M18)",
    then: "Post it to the attorneys' Slack channel at the consult's time",
    group: "messages", kind: "scheduled",
    schedule: () => ({ cron: "* * * * *", firmTime: false }),
    enabled: ({ env }) => {
      const mode = slackMode(env);
      if (mode === "off") return { on: false, reason: "Off — SLACK_MODE is off (messages wait in the queue)" };
      return mode === "dry-run" ? { on: true, reason: "Dry run — logged, not posted" } : { on: true };
    },
    history: "slack_queue", doc: "docs/features/reception.md",
  },
  {
    key: "slack_events",
    name: "Slack notifications",
    when: "A contract is signed, a payment arrives, a client sends documents, mail is scanned…",
    then: "Post it to the Slack channel set for that event (Settings → Integrations)",
    group: "messages", kind: "event",
    enabled: ({ env }) => {
      const mode = slackMode(env);
      if (mode === "off") return { on: false, reason: "Off — SLACK_MODE is off" };
      return mode === "dry-run" ? { on: true, reason: "Dry run — logged, not posted" } : { on: true };
    },
    history: "none", doc: "docs/features/sms-and-slack.md",
  },

  // ── Maintenance ────────────────────────────────────────────────────────────
  {
    key: "backup",
    name: "Daily database backup",
    when: "Every morning, after the nightly sync",
    then: "Save a checked, encrypted copy of the database and remove the oldest copies",
    group: "maintenance", kind: "scheduled",
    schedule: cronOf("BACKUP_CRON", "30 5 * * *", false),
    enabled: ({ live }) => (live ? { on: true } : LIVE_ONLY),
    history: "job_runs", opsEvent: "ops_backup",
  },

  // ── Outside the app (we can't see whether these ran) ───────────────────────
  {
    key: "monday_create_appt",
    name: "Create Appt (Monday automation)",
    when: "Staff press Create Appt on a Jail Intake",
    then: "Monday creates the appointment on the attorney's board and the client's profile",
    group: "external", kind: "external",
    enabled: () => ({ on: true, reason: "Managed in Monday" }),
    history: "none", doc: "docs/decisions.md",
  },
  {
    key: "zapier_adobe_sign",
    name: "Adobe Sign Zaps (Zapier)",
    when: "A contract is sent for signature, or Adobe Sign reports on it",
    then: "Three Zaps create the agreement in Adobe Sign and send its events back here",
    group: "external", kind: "external",
    enabled: () => ({ on: true, reason: "Managed in Zapier" }),
    history: "none", doc: "docs/features/esign-zapier.md",
  },
];

// -----------------------------------------------------------------------------
// Cron → words. Covers the shapes server.ts uses; anything else shows the cron.
// -----------------------------------------------------------------------------

function clock(hour: number, minute = 0): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  const m = minute ? `:${String(minute).padStart(2, "0")}` : "";
  return `${h}${m} ${hour < 12 ? "am" : "pm"}`;
}

const NUM = /^\d+$/;

export function describeCron(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  const [min, hour, dom, mon, dow] = parts as [string, string, string, string, string];
  if (dom !== "*" || mon !== "*" || dow !== "*") return cron;

  const range = /^(\d+)-(\d+)(?:\/(\d+))?$/.exec(hour);
  const hours = range ? `, ${clock(Number(range[1]))}–${clock(Number(range[2]))}` : "";
  if (hour !== "*" && !range && !NUM.test(hour)) return cron;

  if (min === "*" && hour === "*") return "Every minute";
  const every = /^\*\/(\d+)$/.exec(min);
  if (every && (hour === "*" || (range && !range[3]))) return `Every ${every[1]} minutes${hours}`;
  if (!NUM.test(min)) return cron;
  const m = Number(min);
  if (hour === "*") return m === 0 ? "Every hour" : `Every hour at :${String(m).padStart(2, "0")}`;
  if (NUM.test(hour)) return `Daily at ${clock(Number(hour), m)}`;
  if (range?.[3]) {
    const start = Number(range[1]);
    const end = Number(range[2]);
    const last = end - ((end - start) % Number(range[3]));
    return `Every ${range[3]} hours, ${clock(start, m)}–${clock(last, m)}`;
  }
  return cron;
}
