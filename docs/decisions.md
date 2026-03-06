# Architecture Decisions

## 2026-03-03 — Appointments Page is the Write-Back Pioneer

**Context**: Phase 3 adds the `/appointments` page, which is the first feature that will need editing/write-back to Monday.com. Today the entire app is read-only (local seed DB). The appointments page surfaces clear editing needs: updating appointment status, adding notes before a meeting, and rescheduling.

**Decision**: Build Phase 3 as read-only but leave `TODO(monday-write)` markers throughout the code at every point where a write action will be needed. This defers the write architecture while documenting exactly where it needs to go.

**Future Write-Back Architecture** (to implement when editing is enabled):

1. **Optimistic local write**: Update the local SQLite DB immediately so the UI reflects the change.
2. **Queue Monday.com API sync**: Push the mutation to a background queue (e.g., `write_queue` table with `pending`/`synced`/`failed` status).
3. **Monday.com API call**: The queue processor sends the mutation via Monday.com's GraphQL API (`change_simple_column_value`, `create_update`, etc.).
4. **Confirmation or rollback**: On success, mark as synced. On failure, surface error in UI and allow retry.

**Key files with `TODO(monday-write)` markers**:
- `lib/query/appointments.ts` — where write functions will live
- `web/components/AppointmentsPage.tsx` — where UI edit hooks will go

**Why this matters**: Every future editing feature (case status updates, note creation, document uploads) will follow this same pattern. Getting it right on appointments sets the template for the whole app.

---

## 2026-03-03 — Phase 4: Enhanced Search & Filters

### FTS5 Rebuild for Address Search (Schema v5)

**Context**: Profile search only indexed name, email, and phone. Users need to find clients by street address. FTS5 virtual tables cannot be ALTERed — columns can only be set at creation time.

**Decision**: Drop and recreate the FTS5 table and its 3 sync triggers in migration v4→v5. Repopulate from the profiles table. This is safe because FTS is a derived index, not source data.

### Dual-Strategy Search

**Context**: FTS5 tokenizes phone numbers differently than users search for them. Searching "4567" (last 4 digits) doesn't match "555-123-4567" in FTS because FTS treats each token separately.

**Decision**: `searchClients()` uses three strategies based on input shape:
1. **Phone-like** (≥4 digits, >50% digits): LIKE query on stripped phone column (`%4567%`)
2. **Email-like** (contains `@`): LIKE query on email column
3. **General text**: FTS5 prefix match (covers name, address, and general queries)

This avoids over-engineering a custom FTS tokenizer while covering the real use cases.

### Type-Filtered Search

**Context**: Users need to search contracts, court cases, open forms, etc. — not just client profiles.

**Decision**: New `/api/search?q=...&type=profiles|contracts|court_cases|...` endpoint. Type defaults to `profiles` for backward compatibility. Non-profile types use LIKE queries JOINed to profiles for client context. Kept the old `/api/clients/search` endpoint as-is.

### URL-First Filter Persistence

**Context**: Filters need to be shareable (copy URL) and persistent (remember preferences).

**Decision**: URL query params are the source of truth. `useUrlFilters` hook reads in priority order: URL params → localStorage → defaults. On change: `replaceState` + localStorage save. This makes filtered views bookmarkable and shareable while still remembering user preferences.

### Virtual Filter Statuses for KPI Click-Through

**Context**: KPI cards like "Pending Contracts" and "Paid Fee Ks" don't map to a single contract status value — they map to complex logic (e.g., "NOT IN closed statuses AND NOT IN paid statuses").

**Decision**: `listProfilesFiltered()` supports virtual status values (`pending_contracts`, `paid_fee_ks`) that expand to the same SQL logic as the dashboard KPI queries. KPI card counts link to `/clients?status=pending_contracts` etc.

---

## 2026-03-06 — Phase 5: Smart Alerts

### Alerts Computed On-the-Fly (No Alert Table)

**Context**: The app needs to surface overdue deadlines, stale cases, and idle contracts. Could store alerts in a table (pre-computed) or compute them at query time.

**Decision**: Compute alerts on-the-fly from existing `board_items`, `contracts`, and `client_updates` tables. No new schema. This keeps the read-only branch simple and avoids a stale-alert-data problem. The existing indices (`board_items(next_date)`, `board_items(status)`, `client_updates(created_at_source)`) make the queries fast enough with a 50-item cap per category.

### Three Severity Tiers

**Context**: Not all alerts are equal. An overdue deadline is more urgent than a contract waiting for work to start.

**Decision**: Three categories:
1. **Critical** (red) — Overdue deadlines: `board_items.next_date < today`, active status
2. **Warning** (yellow) — Stale cases: no `client_updates` for the profile in 30+ days
3. **Info** (amber) — Pending contracts without activity: paid contracts where the profile has no active board items

### Attorney Filter Scoping

**Context**: Board items have an `attorney` column, but contracts don't.

**Decision**: Attorney filter applies to overdue deadlines and stale cases only. Pending contracts without activity always show regardless of attorney filter, since contracts don't track which attorney handles them.

### Landing Page KPI Integration

**Decision**: Added a 6th KPI card ("Alerts") to the dashboard that shows the total count across all three categories. Clicking the count navigates to `/alerts`. The card shows count-only (no top-5 items) since alerts are better viewed in their grouped format on the dedicated page.

---

## 2026-03-06 — SharePoint Document Integration

### Direct View into SharePoint (No Local File Storage)

**Context**: Every client has an e-file and every consultee has a consult file in SharePoint. The team needs to see these documents directly from the dashboard without switching to SharePoint.

**Decision**: Integrate via Microsoft Graph API to browse SharePoint folder contents inline. No files are stored locally — the app acts as a window into SharePoint.

**Key facts**:
- **E-files** (clients): organized as `/{Letter}/{LASTNAME, Firstname CaseNumber}/` with subfolders (`FEE Ks/`, `CC/`, `FILINGS/`, `COURT FILINGS/`, etc.)
- **Consult files** (consultees): organized as `/{Year}/{LASTNAME, Firstname}/`
- **Mutually exclusive**: when a consultee becomes a client, their consult file is moved to e-files. A person has one or the other, never both.
- **Monday.com already stores the direct SharePoint link** per client (separate columns for e-file and consult file). This is the linking key — no folder-name guessing needed.

### Auth: Application Credentials (client_credentials)

**Context**: Need to decide between delegated auth (user signs in) or application auth (app accesses SharePoint as itself).

**Decision**: Use application (client_credentials) flow. The dashboard is an internal tool and the Azure AD app already has `Files.ReadWrite.All`, `Sites.Read.All`, and `User.Read`. This avoids requiring each user to authenticate with Microsoft separately.

### Phased Rollout

**Decision**: Three phases to manage complexity:
1. **Phase 1 — Read-only browsing**: List folder contents via Graph API, click to open in SharePoint. Store the SharePoint URL from Monday.com in `profiles.sharepoint_url`.
2. **Phase 2 — Embedded previews**: Render PDFs/images inline; use SharePoint's embed preview URL for Office docs.
3. **Phase 3 — Upload**: Push documents from the dashboard into the correct SharePoint subfolder.

### Caching Strategy

**Decision**: Cache folder listings for ~5 minutes. Documents don't change frequently enough to justify real-time calls, and this keeps Graph API usage low.
