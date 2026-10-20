# SMS (RingCentral) + Slack notifications

**Status:** SMS LIVE 2026-10-15 (#132, #133). Slack PR 1 (core + ops failures + workflow events) built 2026-10-15; PR 2 (digest + DMs) planned
**Owner:** Rafael

Two outbound channels, built on one shape: a small sender in `apps/api/src/notify/`,
an env flag that is `off` / `dry-run` / `on`, every send audited, nothing sent
from seed data.

---

## 1. SMS via RingCentral

### What staff get

| Where | Button | What it does |
|---|---|---|
| Log Call popup (`LogCallModal`) | **Text consult link** | Pick a template (EN / ES), preview, send to the number dialled (or the linked client's phone) |
| Payment links popup (M21) | **Text links to client** | Sends the LawPay links with the payment template; a **live** send then records "Mark sent" (stage → Payment link sent). A test-mode send marks nothing |
| Client page header (P3.0) | **Text** (next to the phone) | Free text or a template, to Phone, with Phone 2 one click away |

Language comes from the call's Language (Call Log) or the profile's Preferred
Language ("Espanol" / "English"); `{{firstName}}` from the profile's First Name
column when there is one, else the first word of the name. Payment-link texts
run 3–6 segments (each LawPay link is ~150 characters) — expected.

Every send is **click-to-send with a preview** — nothing texts a client without
a person pressing Send. (Fully automatic sends, e.g. consult reminders, are a
later phase.)

### Templates

- Stored in `data/sms-templates.json` (same pattern as `document-settings.json`),
  edited by admins in **Settings → Text templates**, audited.
- Each template: `key`, `label`, `en` text, `es` text, placeholders
  `{{firstName}}`, `{{link}}`, `{{links}}`, `{{attorney}}`, `{{firmPhone}}`.
- Starting set: `consult_link` (Calendly booking link), `payment_links`.
- Language pre-selected from the call's / profile's Language; staff can switch.
- Length shown live (160-char segments).

### Sending

- RingCentral **JWT auth** (server-to-server app, no per-user login).
  `POST /restapi/v1.0/account/~/extension/~/sms` from `RINGCENTRAL_FROM_NUMBER`.
- Plain `fetch`, no SDK. Token cached until expiry.
- After a send: an E&A **"Text message"** entry on the client's profile (when
  linked; falls back to **Casenote** until someone creates a "Text message"
  activity type in Monday — found by name, no release needed) + audit
  `sms.sent` (phone last 4 only, template key, no body) + a row in
  `sms_messages` (users.db v13).
- Dry run writes nothing to Monday: a test entry on a real client's timeline
  would read as if they'd been texted.
- The same text to the same number within 2 minutes is refused (double click).
- Outage → error shown, not queued: a text that arrives an hour late is worse
  than staff knowing it didn't go.

### Env

| Var | |
|---|---|
| `SMS_MODE` | `off` (default) / `dry-run` (logs, no send) / `on` |
| `RINGCENTRAL_SERVER_URL` | `https://platform.ringcentral.com` |
| `RINGCENTRAL_CLIENT_ID`, `RINGCENTRAL_CLIENT_SECRET`, `RINGCENTRAL_JWT` | from the RC developer app |
| `RINGCENTRAL_FROM_NUMBER` | the firm's SMS-enabled number, E.164 |

### ⚠ Before going live: 10DLC registration

US carriers block business texts from local numbers unless the number is
registered for **A2P 10DLC** (brand + campaign) in the RingCentral admin portal.
Approval takes **days to a few weeks**. Start this first; the code can run in
`dry-run` meanwhile.

---

## 2. Slack

One Slack app with a **bot token** (`chat:write`, `im:write`, `users:read`,
`users:read.email`). Posts with `chat.postMessage`.

| Notification | Where | When |
|---|---|---|
| **Daily alerts digest** | `SLACK_ALERTS_CHANNEL` | Weekdays 8:00 (firm TZ): critical + warning counts per group, top items, link to /alerts |
| **Per-person DMs** | DM | Weekdays 8:00: each user's own cases (My Cases lanes: overdue, due ≤7 days, hearings this week). Sent to the staff roster's `slack_user_id` (v17, from the staff table import — `docs/features/staff-roster.md`), so no `users.lookupByEmail` and no `users:read.email` scope. Opt-out in Preferences |
| **Workflow events** | `SLACK_EVENTS_CHANNEL` | Contract client-signed / payment link sent, consult prepped, mail scan with notices to review, SMS sent |
| **Ops failures** | `SLACK_OPS_CHANNEL` | Sync run failed, write-queue item permanently failed, scheduled job exited non-zero. Throttled: one post per kind per hour |

Content rule: client name + case type + link. **Never** A#, DOB, receipt
numbers, phone numbers, note or text bodies in Slack.

### Built (Slack PR 1, 2026-10-15)

`apps/api/src/notify/slack.ts` is the one sender (best-effort, never throws,
10 s timeout); message texts are pure functions in `notify/events.ts`.

| Event | Posted when | Link |
|---|---|---|
| :writing_hand: client signed | P14 step `client_signed` | Fee K in Monday |
| :money_with_wings: payment link sent | P14 step `payment_link_sent` (also via M21 "Text links to client") | Fee K in Monday |
| :clipboard: consult prepped | M18 prep saved | appointment in Monday |
| :envelope: mail scanned | a non-sample scan with ≥1 notice | /alerts, only when some need review |
| :speech_balloon: text sent | a **live** SMS (not dry-run) | profile in Monday |
| Adobe Sign signed / rejected / … | existing (routes/esign.ts) | Fee K in Monday |

| Ops failure (`:rotating_light:`, max 1 per key per hour) | key |
|---|---|
| A sync (full / incremental / webhook) exits non-zero | `sync:<label>` |
| A Monday write dead-letters in the write queue | `write-queue` |
| Consult sweep / Drive intake / Fee K auto-fill / daily backup fails | `consult-sweep`, `drive-intake`, `fee-k-autofill`, `backup` |

Links go to **Monday items**, not dashboard client pages: a profile's local id
changes on every nightly full sync, so `/clients/<id>` would be dead by morning.

Contract steps post from the P14 route only — the Adobe Sign receiver shares
`executeContractStep` and already posts its own message, so posting there
would double up.

The older Incoming Webhook (`SLACK_WEBHOOK_URL`, Adobe Sign alerts) keeps
working: events fall back to it whenever `SLACK_EVENTS_CHANNEL` is empty,
whatever `SLACK_MODE` says.

### Settings → Integrations (P11.5)

Admins turn each notification on or off, send it to another channel, and set
how often the same failure may repost (5 min – 24 h, default 60). Stored in
`data/notify-settings.json`; the catalog of everything the app can post is
`NOTIFY_EVENTS` in `notify/settings.ts` — a new event ships **on**, to its
kind's default channel, without anyone re-saving. The page also has **Send
test message** (posts even in dry-run) and, for texting, **Check connection**
(the same steps as `npm run sms:check`, in `sms/check.ts`).

What stays in `.env` and can't be changed from the page: the bot token, the
RingCentral credentials, `SLACK_MODE`, `SMS_MODE` and the default channel per
kind. The page sees whether each is set, never the value.

### Env

| Var | |
|---|---|
| `SLACK_MODE` | `off` (default) / `dry-run` (logs `[slack] DRY RUN → …`) / `on` |
| `SLACK_BOT_TOKEN` | `xoxb-…` (bot token — `xoxp-` / `xapp-` are refused) |
| `SLACK_EVENTS_CHANNEL`, `SLACK_OPS_CHANNEL`, `SLACK_ALERTS_CHANNEL` | channel **ids** (`C…` / `G…`, not `#name`); empty = that kind off |
| `SLACK_DIGEST_CRON` | (PR 2) default `0 8 * * 1-5` |
| `FRONTEND_URL` | already set; used for the /alerts link |

`check-env.ts` refuses `on` without a bot token, a non-bot token, or a `#name`
where an id goes; warns when `on` has no channel at all.

---

## Build order (one PR each)

1. **Slack core + ops failures + workflow events** — ~2–3 h
2. **Slack daily digest + per-person DMs** — ~2 h
3. **SMS core + templates + Log Call button** — ~3–4 h
4. **SMS on Payment links + Text client** — ~1–2 h

## Setup (Rafael)

- **Slack:** api.slack.com/apps → Create New App → From scratch, name "Case
  Pipeline", the firm's workspace → OAuth & Permissions → Bot Token Scopes:
  `chat:write` (PR 1); `im:write`, `users:read`, `users:read.email` (PR 2 DMs —
  add them now to avoid a reinstall) → Install to Workspace → copy the **Bot
  User OAuth Token** (`xoxb-…`). Create the channels (e.g. #case-events,
  #case-ops, #case-alerts), `/invite @Case Pipeline` in each, copy each
  channel's id (channel name → View channel details → bottom of About).
- **RingCentral:** developers.ringcentral.com → REST API app, auth = JWT,
  permission **SMS** → create a JWT credential for the sending user → submit
  10DLC brand + campaign in RC admin.
