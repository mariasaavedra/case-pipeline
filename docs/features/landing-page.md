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

## Card Click-Through
Clicking a card opens a modal listing **every** case behind the number, not just
the 5 previewed. `GET /api/dashboard/:key/items` returns all rows plus each row's
full Monday column blob, so re-picking the displayed column is a client-side
re-render with no extra round-trip.

## Display Column
Each card shows one configurable Monday column on its rows (the board tag it used
to show just repeated the card's own heading). Which column is a two-layer setting:

1. firm-wide default in `data/kpi-columns.json` — admins write it via
   `PUT /api/settings/kpi-columns` (audited as `kpi_columns.updated`),
2. per-user override in `preferences.kpiColumns`.

The user layer wins per card key, so changing the default never overwrites
someone's own pick — it only moves the floor for everyone who hasn't chosen. The
column options offered are the logical column keys from `config/boards.yaml` that
at least one row on the card actually has a value for, ranked by coverage.

## North Pole Exclusion
The Open Forms card ignores cases whose status is `Send to North Pole`, count and
list alike. Note this is **stricter** than the Active Cases board, which hides a
parked case only while its `north_pole_until` return date is still in the future.
The dashboard is a "what needs attention" counter, not a work board.

## Key Files
- `libs/query/src/dashboard.ts` — `getDashboardKpis(db, opts)`, `getKpiCardDetail(db, key, opts)`
- `libs/query/src/dashboard.test.ts` — unit tests
- `apps/api/src/server.ts` — `/api/dashboard`, `/api/dashboard/:key/items` (inline: the
  display column depends on the authenticated user, which the Fetch-style handlers don't carry)
- `apps/api/src/routes/kpi-columns.ts` — global default + per-user resolution
- `apps/web/src/components/LandingPage.tsx` — React component
- `apps/web/src/components/KpiDetailModal.tsx` — click-through list + column picker
- `apps/web/src/utils/columnValue.ts` — Monday shaped value → display string
- `apps/web/src/api.ts` — `fetchDashboard()`, `fetchKpiCardItems()`

## Resolved Questions
- Hearings: implemented both 7-day and month range with a toggle (user picks)
- Stale cases card: not added yet — candidate for Phase 5 (Smart Alerts)
