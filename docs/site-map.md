# Case Pipeline — Site Map & Roadmap

## Page Map

```
/login                  ← Authentication page
│
/                       ← Landing Page (aggregate dashboard)
│
├── /clients            ← Client search & browse (current default view)
│   └── /clients/:id    ← 360-degree client detail (existing)
│       ├── Overview tab
│       ├── Documents tab
│       ├── Appointments tab
│       └── Relations tab
│
├── /appointments       ← Attorney Daily Appointments page
│                         (attorney sees today's schedule + client context)
│
├── /calendar           ← Calendar view (deadlines, hearings, appointments)
│
└── /alerts             ← Smart Alerts (items needing attention)
```

## Pages — Detail

### 1. Authentication (`/login`)
- Login screen (username/password or SSO — TBD)
- Protects all other routes
- Role awareness: attorney vs. admin vs. staff (future)
- Session management

### 2. Landing Page (`/`)
- Aggregate KPI cards (see docs/features/landing-page.md)
- Quick-access links to recent clients
- At-a-glance operational health of the firm
- Entry point to all other pages via nav

### 3. Client Search & Detail (`/clients`, `/clients/:id`)
- Already built — search, browse, 360 dashboard
- Enhancements planned:
  - Better search (by case type, attorney, status, contract ID)
  - Persistent filters and sorting on browse view
  - Print/export of client summary

### 4. Attorney Daily Appointments (`/appointments`)
- Attorney selects their name (or auto-detected after auth)
- Shows today's appointments (from appointment boards)
- Each appointment card shows:
  - Time, client name, appointment type
  - Client snapshot: priority, active cases summary, pending items
  - Quick links to client 360 page
  - Recent updates/notes for context before the meeting
- Toggle: today / this week

### 5. Calendar (`/calendar`)
- Monthly/weekly view of all dated items across boards
- Color-coded by type: deadlines, hearings, appointments
- Click any event to jump to client or board item detail
- Filter by attorney, board, status

### 6. Smart Alerts (`/alerts`)
- Overdue deadlines (next_date in the past, case not closed)
- Stale cases (no updates in 30+ days, still active)
- Pending contracts without activity
- RFEs approaching response deadlines
- Grouped by severity: critical / warning / info

## Cross-Cutting Concerns

### Navigation
- Persistent sidebar or top nav across all pages
- Current: header with search bar only
- Needed: proper nav with links to all pages

### Print / Export System
- Reusable print-friendly layout (CSS @media print)
- Per-page export: client summary, appointment sheet, alert report
- Format options: print view, PDF (future), CSV for lists

### Search & Filters
- Global search in nav (existing, profiles only)
- Enhanced: search across board items, contracts, updates
- Per-page filters: status, attorney, date range, board type
- URL-driven filters (shareable links)

### Authentication & Authorization
- To be designed: session tokens, role-based access
- Minimum: login gate before any data access
- Future: attorney sees only their cases, admin sees all

## Implementation Order (Proposed)

| Phase | Pages / Features | Why |
|-------|-----------------|-----|
| **1** | Navigation + routing + 360 view fixes | Foundation — proper nav/URL routing, plus fix existing UX issues ✅ |
| **2** | Landing Page | High value, uses existing data, visible win ✅ |
| **3** | Attorney Appointments page | High daily utility for attorneys |
| **4** | Enhanced search & filters | Improves existing pages incrementally |
| **5** | Smart Alerts | Surfaces problems proactively |
| **6** | Calendar | Nice-to-have, more complex UI |
| **7** | Authentication | Important but can be layered on last since DB is local/read-only |
| **8** | Print / Export | Polish feature, builds on existing pages |

> Auth is listed late because the app currently runs on localhost with a
> local seed DB. Once it needs to be deployed or shared, auth moves to
> phase 1. Adjust based on deployment timeline.

## Phase 1 — 360 View Fixes

Issues to address alongside the routing/nav overhaul:

### Snapshot card text truncation
- **Problem:** KPI cards (Case Status, Next Deadline, Case Type, Last Action)
  truncate long text with no way to see the rest.
- **Fix:** Click-to-expand or popover that shows the full content.
  Keep the card compact by default, but let the user drill in.

### "Last Relevant Entry" logic
- **Problem:** "Last Action" card just picks the most recent update by timestamp.
  Many updates are noise (auto-generated status changes, empty bodies).
  The card often shows something meaningless.
- **Two approaches (can coexist):**
  1. **System-defined relevance (implement first):**
     - Filter out updates with empty/very short text bodies
     - Deprioritize auto-generated or status-only changes
     - Prefer updates from human authors with substantive content
     - Rank: replies > notes > status changes
  2. **User-pinned relevance (implement when writes are enabled):**
     - Attorney can pin/flag an update as "last relevant action"
     - Pinned entry overrides system logic
     - Requires write path to DB (new column or table)
     - Natural fit alongside authentication (user identity needed)
