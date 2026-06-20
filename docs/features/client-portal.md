# Client Portal

**Status:** Planned — long term  
**Last updated:** 2026-05-25

---

## Goal

A separate, client-facing interface where clients can log in to see their own case status, upcoming appointments, and key milestones — without calling the office.

---

## Why This Matters

A significant portion of client calls and emails are status inquiries: "What's happening with my case?" "When is my next appointment?" A self-service portal reduces that load on staff, improves client satisfaction, and sets professional expectations around transparency.

---

## Scope (Phase 1 — Read Only)

What a client can see after logging in:

- Their active cases and current status
- Upcoming appointments and hearing dates
- Key milestones (filed, receipt received, biometrics scheduled, etc.)
- Their assigned paralegal and attorney (name only)
- Documents they've been asked to provide (if tracked)

What they **cannot** see: internal notes, paralegal assignments, target dates, fee details, other clients' data.

---

## Auth

Separate from the staff auth system. Options:

- **Email + magic link** — client receives a login link via email, no password needed. Simple, no credential management.
- **Microsoft B2C** — Azure AD's consumer identity service. More complex but consistent with the existing Azure AD setup.
- **Email + password** — simplest to implement but requires password reset flows.

Magic link is the recommended starting point — low friction, no password to forget, works well for clients who log in infrequently.

---

## Architecture Considerations

- Completely separate frontend route prefix (`/portal`) or a separate app (`apps/portal`)
- Strict data scoping on the API — client tokens can only query their own `localId`
- No access to internal endpoints (`/api/admin`, `/api/active-cases`, etc.)
- Profile must have a verified email address to enable portal access

---

## Open Questions

- Is this actually wanted by clients, or is the firm's communication preference phone/email?
- What language(s) does the portal need to support? (Immigration clients are often non-English speakers.)
- Does the firm want to control which clients get portal access (invite-only) or open it to all?
- What counts as "safe to show" vs. "internal only"? Needs input from the attorneys.
- Mobile-first design likely required — clients are less likely to be on desktop.

---

## Dependencies

- Auth system (Phase 1) must exist first — portal auth builds on the same infrastructure
- Live data sync — portal is useless on seed data
- This is the largest lift of all planned features — recommend deferring until all other phases are stable
