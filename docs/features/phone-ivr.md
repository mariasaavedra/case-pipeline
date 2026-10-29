# Phone menu (RingCentral IVR) + call events

**Status:** phase 1 built 2026-10-29: call-events receiver + "press 1 → scheduling link by text". Not deployed.
**Owner:** Rafael

What staff asked for (Slack, 2026-10-29): press 1 for an appointment → a text
with the link; a detainee call → the queue; a case update → a ticket (a Call
Log entry); when someone answers, the client's info and the Call Log open by
themselves. All of it works on RingCentral; nothing here replaces it.

| # | Piece | Where | State |
|---|---|---|---|
| 0 | Detainee key → call queue | RingCentral Admin Portal only | To do (settings) |
| 1 | Call events: the app hears every call | `apps/api/src/phone/call-events.ts` | **Built** |
| 2 | Press 1 → scheduling link by text | `apps/api/src/phone/scheduling-text.ts` | **Built** |
| 3 | Case update key → pending Call Log entry | on #1 | Planned |
| 4 | On answer: client card + pre-filled Call Log | on #1 + web | Planned |

---

## 1. Call events

RingCentral posts every change on every call in the account (ringing, answered,
hung up…) to `POST /api/webhooks/ringcentral/<RC_WEBHOOK_SECRET>`, from one
webhook subscription to `/restapi/v1.0/account/~/telephony/sessions`.

- **Auth:** the secret is in the URL path (constant-time compare), like the
  Monday receiver. No Azure AD login: registered before the `requireAuth`
  catch-all.
- **Handshake:** when the subscription is made, RingCentral POSTs a
  `Validation-Token` header; the receiver echoes it back.
- **Fast answer:** RingCentral wants a reply within 3 s and drops a subscription
  that keeps failing, so the receiver answers 200 first and runs the listener
  afterwards.
- **One call, many events:** each listener acts on a call once, keyed by
  `telephonySessionId` (kept in memory for an hour; after a restart, the
  10-minute repeat guard on the text covers it).

### Setup (once)

1. RingCentral developer console → the app the API signs in with → add the
   **CallControl** permission (call events need it). The JWT doesn't change.
2. Server `.env`: `RC_WEBHOOK_SECRET=$(openssl rand -hex 24)`; deploy.
3. `npm run rc:subscribe -- --url=https://<host> --dry-run`, then without
   `--dry-run`. `--list` shows it, `--remove` deletes it. The subscription
   lasts 20 years (RingCentral's longest).

## 2. Press 1 → scheduling link by text

RingCentral's phone menu can't send a text; a key can only connect the call
somewhere. So "press 1" connects to an **announcement-only extension** that
says a text is on its way, and the app texts whoever reached it.

### Setup (RingCentral Admin Portal)

1. Phone System → Groups → **Announcement-Only** extension, e.g. "Scheduling
   Link", ext. 150. Greeting: *"Le enviamos un texto con el enlace para hacer su
   cita. We just texted you a link to schedule your appointment."*
2. Phone System → Auto-Receptionist → **IVR Menus** → the main menu → key **1**
   → Connect to extension → "Scheduling Link". Add the option to the menu's
   prompt.
3. Server `.env`: `RC_SCHEDULING_EXTENSION=150`.
4. The text is the SMS template **Phone menu: scheduling link** (Settings →
   Firm), with https://sharma-crawford.com/schedule-a-consultation/ written in.
   Staff can change the link there. A `{{placeholder}}` left in the text stops
   it (each call then shows as failed in Settings → Workflows, naming it).

Until the phone menu exists, staff can **transfer** a caller to the extension:
the caller hears the announcement and gets the same text.

### Rules

- The extension is matched by its RingCentral id (looked up once from the
  number, ReadAccounts), else by the number on the call.
- Hidden or non-US caller → no text (skipped). A landline gets the text attempt;
  RingCentral reports the failure in `sms_messages`.
- The same number again within 10 minutes → no second text.
- The number is exactly one client's (Phone or Phone 2) → their Preferred
  Language and an E&A "Text message" entry on their profile (queued on an
  outage). Anyone else → Spanish, the firm's default.
- `SMS_MODE` decides: `off` = nothing, `dry-run` = logged only, `on` = sent.
  Seed data is always a dry run.
- Logged like every text: `sms_messages` (context `ivr`), the audit log
  (`sms.sent` / `sms.failed`, last 4 digits only), and one `job_runs` row per
  call (`ivr_scheduling_text`, Settings → Workflows).
