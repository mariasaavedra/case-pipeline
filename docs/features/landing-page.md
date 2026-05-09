# Landing Page — Aggregate Dashboard

**Status: Implemented** (Phase 2, 2026-02-27)

## Purpose
Give the team a "manager glance" before drilling into any specific client.
This is the first thing users see at `/`.

## KPI Cards

| Card | Source | Filter | Order |
|------|--------|--------|-------|
| Open Forms | `board_items` where `board_key = "_cd_open_forms"` | `group_title = "Open Forms"` | `created_at DESC` |
| Pending Contracts | `contracts` table | `status NOT IN (closed ∪ paid)` | `created_at DESC` |
| Paid Fee Ks | `contracts` table | `status IN PAID_CONTRACT_STATUSES` | `created_at DESC` |
| Upcoming Deadlines | All `board_items` | `next_date` between today and today+7d | `next_date ASC` |
| Upcoming Hearings | `board_items` where `board_key = "court_cases"` | `next_date` in range (toggle) | `next_date ASC` |
| Alerts | Computed on-the-fly from `board_items` + `client_updates` | Overdue deadlines / stale cases / idle contracts | count only, links to `/alerts` |

## Behavior
- Each card shows a count (large number) and a top-5 item list
- Each item row shows: item name, date (if applicable), board tag, client name as link to `/clients/:id`
- Cards refresh on page load (no polling — read-only DB)
- Greeting header changes by time of day (morning / afternoon / evening)
- Responsive grid: 3-col on desktop, 2-col on tablet, 1-col on mobile

## Hearings Toggle
- "7 days" (default) vs "This month" — client-side toggle chip
- Passes `hearingRange=7d|month` query param to `GET /api/dashboard`

## Key Files
- `libs/query/src/dashboard.ts` — `getDashboardKpis(db, opts)`
- `libs/query/src/dashboard.test.ts` — unit tests
- `apps/api/src/handlers/handlers.ts` — `handleDashboard()`
- `apps/web/src/components/LandingPage.tsx` — React component
- `apps/web/src/api.ts` — `fetchDashboard()`

## Resolved Questions
- Hearings: implemented both 7-day and month range with a toggle (user picks)
- Stale cases card: not added yet — candidate for Phase 5 (Smart Alerts)
