# Case Health Score

**Status:** Planned — not started  
**Last updated:** 2026-05-25

---

## Goal

An automatic, data-derived signal per case that indicates whether a case is on track, at risk, or stalled — without requiring anyone to manually flag it. Shows up as a subtle indicator everywhere cases appear: active cases board, client 360 view, search results, alerts.

---

## Why This Matters

The alerts page already catches overdue deadlines. The health score goes further — it catches cases that are *about to* become problems: no activity in a week, stuck in the same status for too long, approaching deadline with no recent progress. It's a proactive signal, not a reactive one.

---

## Score Dimensions

A simple composite score derived from data already in SQLite:

| Signal | Weight | Description |
|---|---|---|
| Days since last update | High | No `client_updates` entry in X days = stale |
| Target date proximity | High | < 7 days with no recent status change = at risk |
| Days in current status | Medium | Status hasn't changed in X days = possibly stuck |
| Missing required fields | Medium | Key columns blank that should be filled by this stage |
| Overdue | Critical | Past target date and not filed = red flag |

**Output:** Three tiers — `healthy` (green), `at-risk` (yellow), `critical` (red/orange). No numeric score shown to users — just the tier and the primary reason (e.g. "No update in 9 days").

---

## Implementation

**Query:** `libs/query/src/case-health.ts`  
Computed at query time, not stored — derived fresh on each request from existing data.

**API:** Health score included in the active cases endpoint response and client 360 summary. No separate endpoint needed initially.

**Frontend:**
- Small colored dot or badge on case cards (active cases board)
- Health indicator row on the client 360 Overview tab
- Filter option: "show only at-risk cases" on the active cases board and clients list

---

## Open Questions

- What is "stale" — no update in 7 days? 14 days? Should be configurable.
- Should health scores trigger notifications (digest email)? Probably yes — "3 of your cases are at risk."
- Should the score be visible to all users or only admins/attorneys?
- Thresholds should be tunable — what feels right will only become clear with real data.
