# Next Steps — What to Pick Up

## Current State (after Phase 2, 2026-02-27)

Phases 1 and 2 are complete. The app has:
- Client-side routing with sidebar nav (`web/router.ts`)
- 360-degree client detail with tabs (`web/components/ClientView.tsx`)
- Landing page with 5 KPI cards (`web/components/LandingPage.tsx`)
- REST API at `server.ts` serving all data from read-only SQLite

287 tests passing. All code on the `read-only` branch.

---

## Phase 3: Attorney Daily Appointments (`/appointments`)

**Spec**: `docs/site-map.md` § 4 (Attorney Daily Appointments)

**What to build**:
- New page at `/appointments` — attorney selects their name, sees today's appointments
- Each appointment card shows: time, client name, type, client snapshot (priority, active cases), link to 360 page
- Toggle: today / this week
- Data source: `board_items` where `board_key IN APPOINTMENT_BOARD_KEYS` (already defined in `lib/query/types.ts`)

**Where to look**:
- Router: `web/router.ts` — add `"appointments"` page type to `matchRoute()`
- Sidebar: `web/components/Sidebar.tsx` — the Appointments nav item already exists but is `disabled: true`
- Query layer pattern: follow `lib/query/dashboard.ts` for the new query module
- API handler pattern: follow `lib/api/handlers.ts` → `handleDashboard` for the new endpoint
- Component pattern: follow `web/components/LandingPage.tsx` for the page structure
- Existing appointment board keys: `APPOINTMENT_BOARD_KEYS` in `lib/query/types.ts`

**Key decisions needed**:
- How to identify the current attorney (hardcoded selector? URL param? localStorage?)
- What "client snapshot" data to show on the appointment card (reuse `getClientCaseSummary` or a lighter query?)

---

## Phase 4: Enhanced Search & Filters

- Search across board items and contracts, not just profiles
- Per-page filters: status, attorney, date range, board type
- URL-driven filters for shareable links

---

## Phase 5: Smart Alerts (`/alerts`)

- Overdue deadlines, stale cases, pending contracts without activity
- The "stale cases" KPI card deferred from Phase 2 fits here
- Grouped by severity

---

## Landing Page Polish (backlog)

These were noted but deferred from Phase 2:
- **Count click → filtered list**: clicking the count on a KPI card should navigate to a filtered view showing all items (not just top 5)
- **Stale cases card**: "no updates in 30+ days" — good candidate for Alerts page instead
- **Empty state refinement**: cards currently show "No items" — could be more informative
