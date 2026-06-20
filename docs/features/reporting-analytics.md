# Reporting & Analytics

**Status:** Planned — not started  
**Last updated:** 2026-05-25

---

## Goal

A reporting page that answers operational and management questions using data already in SQLite — no new data collection needed. Covers case throughput, filing rates, paralegal workload, and timeline patterns.

---

## Why This Matters

The existing KPI dashboard shows current state (open cases, pending contracts, upcoming deadlines). Reporting answers historical and trend questions: are we filing more cases this quarter than last? Which form types take the longest? Is the team's workload balanced?

---

## Key Reports

### Case Throughput
- Cases filed per month (rolling 12 months)
- Breakdown by form type
- Trend line: are we accelerating or slowing down?

### Time-to-File
- Average days from case creation to filing, by form type
- Distribution: how many cases file in < 30 days, 30–60, 60–90, 90+?
- Outliers: cases that took the longest — what type were they?

### Paralegal Workload
- Active cases per paralegal (current snapshot)
- Cases filed per paralegal (last 30/90 days)
- Average time-to-file per paralegal (without this being a performance shaming tool — useful for spotting where someone needs support)

### Deadline Health
- % of cases filed on or before target date (historical)
- Average days early / late at filing

### Court vs. Form split
- How many active cases are court matters vs. standard forms at any given time
- Historical trend

---

## Data Source

All data already exists in SQLite. Mostly aggregation queries on `board_items` and `contracts` tables.

---

## New API Endpoints

```
GET /api/reports/throughput?period=12m
GET /api/reports/time-to-file
GET /api/reports/workload
GET /api/reports/deadline-health
```

**File:** `apps/api/src/routes/reports.ts`  
**Queries:** `libs/query/src/reports.ts`

---

## Frontend

**New route:** `/reports`  
**New page:** `apps/web/src/components/ReportsPage.tsx`

Use a lightweight chart library — evaluate `recharts` (already React-friendly) at implementation time. Period selector (30d / 90d / 12m / all time).

---

## Open Questions

- Who is the primary audience — attorneys (case outcomes) or admin/management (operational efficiency)?
- Should reports be exportable to CSV or PDF?
- Are there specific metrics the firm already tracks manually that this should replace?
- Paralegal performance data is sensitive — should it be admin-only or visible to everyone?
