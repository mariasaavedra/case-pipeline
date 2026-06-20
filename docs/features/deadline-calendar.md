# Deadline Calendar

**Status:** Planned — not started  
**Last updated:** 2026-05-25

---

## Goal

A calendar view overlaying all upcoming deadlines, court hearing dates, and internal target dates across every active case. Gives attorneys and staff a single place to see what's coming without jumping between boards.

---

## Why This Matters

Right now deadline visibility requires either checking the alerts page (which only shows overdue/imminent items) or opening individual cases. A calendar view gives the full picture — what's happening today, this week, this month — at a glance.

---

## Data Sources

All data already exists in SQLite:

| Event type | Source |
|---|---|
| Court hearings | `board_items` — Calendaring board, hearing date column |
| USCIS / form deadlines | `board_items` — Open Forms, evidence/deadline columns |
| Internal target dates | `board_items` — Open Forms, Target Date column |
| Contract milestones | `contracts` table — key date columns |

---

## Layout

Month/week toggle (week view default). Each day cell shows event chips — color coded by type:

| Color | Event type |
|---|---|
| Blue | Court hearing |
| Red | Hard deadline (USCIS, court filing) |
| Orange | Internal target date |
| Yellow | Contract milestone |

Clicking a chip opens the client 360 view for that case.

---

## New API Endpoint

```
GET /api/calendar?start=YYYY-MM-DD&end=YYYY-MM-DD
```

Returns all events in the date range with type, label, client name, and `clientLocalId` for linking.

**File:** `apps/api/src/routes/calendar.ts`  
**Query:** `libs/query/src/calendar.ts`

---

## Frontend

**New route:** `/calendar`  
**New page:** `apps/web/src/components/CalendarPage.tsx`

Use a lightweight calendar library or build a simple grid — evaluate at implementation time. No heavy dependencies preferred.

---

## Open Questions

- Should events be filterable by type (hearings only, deadlines only, etc.)?
- Should the calendar show events for all clients or respect some filter (e.g. by attorney)?
- Does this replace or complement the existing Alerts page?
