# Target Dates (P24) + weekday Slack digest

The Open Forms **Target Date** (`date_mkkws221`) is the firm's internal goal
for a case. The admin sets it; a paralegal who needs more time asks the
attorney for an extension; the attorney grants it; the admin moves the date.

## What ships

| Piece | Where |
|---|---|
| Admin-only target date | `PATCH /api/open-forms/:localId/case-field` refuses `target_date` from a non-admin (403). The P6 case card shows it read-only to staff. Rule = `CASE_FIELDS.open_form.target_date.adminOnly` in `apps/api/src/routes/case-card-write.ts` |
| Extension note | The same PATCH with `extension: { grantedBy?, reason? }` also posts an update on the Open Form: "Target date moved Nov 3, 2026 → Nov 17, 2026 — extension granted by LB. Reason: … (Rafael, from the app)". Queued on outage. `targetDateNote()` |
| P24 page | `/target-dates`, admin-only (sidebar item hidden from staff). Groups: Overdue · Due in 7 days · 8–14 days · Later · No target date; paralegal filter; per row: status, paralegal(s), date + days left, **Moved n×**, **Changed by …** when the last change wasn't an admin's; **Move date / Set date** (M33) |
| API | `GET /api/target-dates` (admin) — `apps/api/src/routes/target-dates.ts` over `libs/query/src/target-dates.ts` |
| Digest | Weekdays 8 AM firm time (`TARGET_DATES_DIGEST_CRON`), live data only: a Slack DM to each active admin whose staff roster entry has a Slack member id. Counts, then Overdue and Due in the next 7 days grouped by paralegal (20 lines per section max), link to P24. `apps/api/src/notify/target-dates-digest.ts`; job run in Settings → Workflows |

## Rules

- **Which cases:** P5's list (`getActiveCases`): Open Forms in the "Open Forms" and "Court Forms" groups. North Pole cases with a future return date are counted, not listed.
- **Buckets** from the firm's today: `< 0` overdue, `0–7` week, `8–14` two weeks, `> 14` later, no date = none.
- **Moves** = `dateMoves()` on `item_events` (one per day, from one date to another, not in the item's first 24 h).
- **Changed by someone else:** the last `item_events` change to the column has a Monday user id that isn't an active admin's (via `users.staff_id → staff.monday_user_id`). Unknown when there is no user id or no admin is linked to the roster. A Monday automation counts as someone else.
- Monday itself can't be locked: anyone with board access can still edit the column there. The page flags it instead.

## Turning the digest on / off

- Settings → Integrations → **Target dates digest** (on by default, shows "Direct message" instead of a channel).
- `SLACK_MODE` applies (`dry-run` logs the message). Needs `SLACK_BOT_TOKEN` with `chat:write`; the bot DMs from its App Home.
- No admin with a Slack id in Settings → Staff = nothing sent (the run says so).
