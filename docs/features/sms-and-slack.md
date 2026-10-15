# SMS (RingCentral) + Slack notifications

**Status:** SMS core + Log Call button built 2026-10-15 (PR 3 below, done first); Slack and the other SMS entry points planned
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
| Payment links popup (M21) | **Text links to client** | Sends the LawPay links with the payment template, then records "Mark sent" (stage → Payment link sent) |
| Client page | **Text client** | Free text or a template, to Phone / Phone 2 |

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
| **Per-person DMs** | DM | Weekdays 8:00: each user's own cases (My Cases lanes: overdue, due ≤7 days, hearings this week). App user ↔ Slack user matched by **email** (`users.lookupByEmail`) — no mapping table. Opt-out in Preferences |
| **Workflow events** | `SLACK_EVENTS_CHANNEL` | Contract client-signed / payment link sent, consult prepped, mail scan with notices to review, SMS sent |
| **Ops failures** | `SLACK_OPS_CHANNEL` | Sync run failed, write-queue item permanently failed, scheduled job exited non-zero. Throttled: one post per kind per hour |

Content rule: client name + case type + link back to the app. **Never** A#,
DOB, receipt numbers or note bodies in Slack.

### Env

| Var | |
|---|---|
| `SLACK_MODE` | `off` (default) / `dry-run` / `on` |
| `SLACK_BOT_TOKEN` | `xoxb-…` |
| `SLACK_ALERTS_CHANNEL`, `SLACK_EVENTS_CHANNEL`, `SLACK_OPS_CHANNEL` | channel ids (`C…`); empty = that notification off |
| `SLACK_DIGEST_CRON` | default `0 8 * * 1-5` |
| `APP_BASE_URL` | for links back into the dashboard |

`check-env.ts` validates the token shapes and that `on` has what it needs.

---

## Build order (one PR each)

1. **Slack core + ops failures + workflow events** — ~2–3 h
2. **Slack daily digest + per-person DMs** — ~2 h
3. **SMS core + templates + Log Call button** — ~3–4 h
4. **SMS on Payment links + Text client** — ~1–2 h

## Setup (Rafael)

- **Slack:** api.slack.com/apps → Create app → bot scopes above → install →
  copy `xoxb-` token → invite the bot to the 3 channels.
- **RingCentral:** developers.ringcentral.com → REST API app, auth = JWT,
  permission **SMS** → create a JWT credential for the sending user → submit
  10DLC brand + campaign in RC admin.
