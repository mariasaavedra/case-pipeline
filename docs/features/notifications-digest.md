# Notifications & Daily Digest

**Status:** Planned — not started  
**Last updated:** 2026-05-25

---

## Goal

Proactive alerts delivered to paralegals and attorneys without requiring them to open the dashboard. Primary form: a daily morning email digest. Secondary form: in-app notifications for urgent events.

---

## Why This Matters

The current alerts page is passive — you have to go look. Most people don't open a dashboard unprompted every morning. A digest lands in their inbox at 8am and surfaces exactly what they need to act on that day.

---

## Daily Digest (Phase 1)

A scheduled email sent each morning to each paralegal and attorney containing:

- **Their cases due this week** — sorted by target date, with client name, form type, and days remaining
- **Overdue cases** — anything past target date that hasn't been filed
- **Upcoming court hearings** — hearings in the next 7 days
- **Stale cases** — cases with no update in X days (configurable)

Each item links directly to the relevant client 360 view.

### Implementation

- **Scheduler:** A cron job or Node `setInterval` in a lightweight script — `scripts/send-digest.ts`
- **Email:** SendGrid or SMTP (nodemailer). Add credentials to `.env`.
- **Recipient list:** Derived from the Paralegals column on active cases — no manual list to maintain. Each person gets only their own cases.
- **Trigger:** `npm run digest` or a system cron at 8am local time

### Dependencies

- `nodemailer` (SMTP) or `@sendgrid/mail` (SendGrid API)
- Email credentials in `.env`

---

## In-App Notifications (Phase 2)

A notification bell in the top nav. Unread count badge. Clicking opens a panel with recent alerts:

- Case just went overdue
- New case assigned to you
- Court date added to one of your cases

### Implementation

- `notifications` table in `users.db` (from the auth phase)
- `GET /api/notifications` — unread notifications for current user
- `POST /api/notifications/:id/read` — mark as read
- Frontend: bell icon in header, polling or WebSocket for live updates

---

## Open Questions

- What email provider is preferred? (SendGrid, SMTP via Microsoft 365, other?)
- Should the digest be opt-out per user, or always-on?
- What time zone should the scheduler use?
- For in-app notifications: polling interval vs WebSocket — decide at implementation time based on expected usage volume.

---

## Dependencies on Other Features

- **Auth (Phase 1)** — in-app notifications require knowing who the current user is
- **Live data sync** — digest is only useful with real data
