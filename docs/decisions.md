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

---

## 2026-03-07 — Monday.com Groups as First-Class Data (Schema v6)

### Why Groups Matter

**Context**: In Monday.com, every board is divided into **groups** — and the group an item sits in carries critical semantic meaning. For example:
- **Profiles board**: "Active Clients" vs "Non-clients" vs "Closed clients" vs "Clinic Profiles (non clients)" — determines whether someone is actually a client.
- **Fee Ks**: group determines contract lifecycle stage (the `status` column is a secondary signal).
- **Open Forms**: "Open Forms" vs "Court Forms" vs "Filed" vs "Closed" vs "Denied" — determines form lifecycle.
- **Court Cases**: "Court Case" (active) vs "Inactive Court Cases" vs "Granted" vs "Ordered Removed/VD" vs "Withdrew".
- **Appointments**: "Today's consults" vs "Upcoming" vs "Past Consults" vs "Hire" vs "No Hire".
- **Motions**: "Motions to be sent" vs "Awaiting on decision" vs "Granted" vs "Denied".
- **FOIAs**: "Pending FOIAs" vs "Filed".
- **I-918Bs**: "To Be Requested" vs "Pending I918 B's" vs "Signed I918 B's" vs "Hired for U-visa" etc.

Without groups, the dashboard cannot reliably answer: "Is this person a client?", "Is this case active or closed?", "Is this form filed or still open?"

### Decision

1. **`group_title` column already exists** on `board_items` (since schema v2) and the seeder already populates it. Added a composite index `(board_key, group_title)` to make group-filtered queries fast.

2. **Added `group_title` to `profiles` table** (schema v6 migration). Profiles now carry their Monday.com board group assignment ("Active Clients", "Non-clients", etc.). This enables filtering clients vs non-clients without guessing from contract/activity data.

3. **Seeder assigns profile groups** with weighted distribution: 65% Active Clients, 20% Non-clients, 10% Closed, 5% Clinic Profiles.

4. **Group semantics are board-specific** — the meaning of groups varies by board. The query layer should use group-aware logic per board rather than a generic group filter.

### Group Definitions by Board

| Board | Groups | Semantic |
|-------|--------|----------|
| profiles | Active Clients, Non-clients, Closed clients, Clinic Profiles | Client classification |
| fee_ks | (uses status column primarily) | Contract lifecycle |
| _cd_open_forms | Open Forms, Court Forms, Interview, Filed, Filed PIPS, Closed, Denied | Form lifecycle |
| court_cases | Court Case, Inactive Court Cases, Ordered Removed/VD, Withdrew, Granted | Case outcome |
| motions | Motions to be sent, Awaiting on decision, Granted, Denied | Motion lifecycle |
| appeals | Appeals | (single group) |
| foias | Pending FOIAs, Filed | FOIA lifecycle |
| _lt_i918b_s | To Be Requested, Pending I918 B's, Signed I918 B's, Agency did not sign, etc. | I-918B lifecycle |
| address_changes | Address Changes, Payment Pending, EAD Extension Letters, Completed | Change lifecycle |
| rfes_all | USCIS RFEs, NVC RFEs, Sent Out, No Action Needed/Completed/Denied | RFE lifecycle |
| _na_originals_cards_notices | Cards, Green Notices, CYF Appts, Sent To Client | Document type |
| appointments_* | Today's consults, Upcoming, Past Consults, No Hire, Hire | Appointment lifecycle |
| _fa_jail_intakes | Jail Intakes, Scheduled, NEED TO BE SCHEDULED | Intake lifecycle |

### Weighted Group Distributions in Seeder

**Context**: The initial groups implementation hardcoded a single group per board generator (e.g., all court cases → "Court Case", all motions → "Motions to be sent"). This made the seeded data unrealistic — the dashboard couldn't exercise group-based filtering because every item was in the same group.

**Decision**: Updated all board generators to use weighted random group assignment matching production distributions. Each board now distributes items across all its real groups:
- **Court Cases**: 55% Court Case, 15% Inactive, 12% Granted, 10% Ordered Removed/VD, 8% Withdrew
- **Motions**: 35% To be sent, 30% Awaiting, 20% Granted, 15% Denied
- **FOIAs**: 60% Pending, 40% Filed
- **I-918Bs**: 30% Pending, 20% To Be Requested, 15% Signed, plus smaller percentages for resolved states
- **Appointments**: 35% Past Consults, 25% Upcoming, 15% Hire, 15% No Hire, 10% Today's consults
- And similarly for address_changes, originals, RFEs, jail intakes

**Why**: When Monday.com sync is added, `item.group.title` populates the same `group_title` column — no code changes needed. The Monday API provides both board-level groups (`boards { groups { id title } }`) and per-item group membership (`items { group { id title } }`), so new groups are auto-discovered during sync.

### Next Steps

- Use `profiles.group_title` to filter "real clients" vs consultees in search and browse views
- Use `board_items.group_title` to determine active vs closed/resolved items per board
- Expose group as a filter option in the UI where it adds value (e.g., Open Forms: show "Filed" separately from "Open")

---

## 2026-03-07 — Phase 6: UI Improvements & Tab Restructure

### Additional Profile Fields (Schema v7)

**Context**: Attorneys need Date of Birth, Place of Birth, and A-Number visible in the client profile. Address was already in the schema but not populated by the seeder.

**Decision**: Added `date_of_birth`, `place_of_birth`, `a_number` columns to `profiles` table. A-Numbers are stored normalized (9 digits only) because Monday.com sends varied formats (`123456789`, `A123-456-789`, `123 456 789`, etc.). Display format is `A###-###-###`. Utility functions `normalizeANumber()` and `formatANumber()` handle conversion.

### Tab Restructure — Separating Concerns

**Context**: The Overview tab was overloaded with contracts, active cases, and timeline all in one view. Court cases need special attention and should not be mixed with regular USCIS/NVC cases.

**Decision**: Expanded from 4 tabs to 7:
- **Overview**: Snapshot KPI cards + Timeline only (the client's story)
- **Appointments**: Appointment entries for this client
- **Contracts**: Fee K entries (pending highlighted, closed collapsed)
- **Active Cases**: Case board items (Open Forms, FOIAs, Appeals, etc.) EXCLUDING items linked to court_cases
- **Court Cases**: Items on the `court_cases` board + any items linked to court cases via `item_relationships`
- **Documents & Notices**: Reserved as SharePoint placeholder (Phase 7)
- **Relations**: Unchanged

**Court case separation logic**: The `ClientCaseSummary` API response now includes `courtLinkedItemIds` — an array of board item IDs that have an `item_relationships` link to a `court_cases` board entry. The frontend uses this to partition items between Active Cases and Court Cases tabs. Currently only `court_cases` board items appear in the Court Cases tab (no cross-board relationships in seed data), but the architecture supports it when real Monday.com data flows in.

### Notes Expansion in Appointments

**Context**: The appointments page showed "Recent Notes (N)" but only 1-2 were visible in a 400px scrollable area.

**Decision**: Added two ways to see all notes:
1. **"Show all" toggle** — removes the max-height limit, showing all notes inline
2. **"Open in modal" button** — opens a full-screen modal overlay (`NotesModal`) with the complete notes list

Both options appear when a card has more than 2 notes. The modal supports Escape key and click-outside to dismiss.

### Unified Sticky Profile Header

**Context**: The client view had two redundant components showing profile information: a sticky header bar and a separate ProfileCard below it. After adding DOB, Place of Birth, and A-Number to the ProfileCard, the duplication became obvious.

**Decision**: Merged everything into a single sticky header that contains the full profile: avatar, name, priority badge, action buttons, email, phone, address, DOB, place of birth, and A-Number. Removed the separate ProfileCard from the view. The A-Number icon uses an "A#" text label (the standard shorthand for Alien Registration Number) instead of a generic "T" text icon. Added responsive CSS for the tab bar (reduced padding at <=768px) to accommodate 7 tabs on smaller screens.

---

## 2026-03-08 — Board ID Corrections & Calendaring Board

### Wrong Board IDs

**Context**: Running a fresh Monday.com snapshot revealed the Motions board was returning only 2 items. Investigation showed 3 board IDs in `config/boards.yaml` were pointing to the wrong boards.

**Corrections**:
| Board | Old (wrong) ID | New (correct) ID |
|-------|----------------|------------------|
| Motions | `7864109176` | `8025556892` |
| FOIAs | `7862404612` | `8025590516` |
| Appeals | `7864113013` | `3473957885` |

Updated in: `config/boards.yaml`, `scripts/fetch-profile.ts`, `scripts/sample-real-data.ts`, `docs/boards.md`.

### Calendaring Board (19th Board)

**Context**: A staff member maintains a separate "Calendaring" board (`9287895872`) to track deadline-bearing notices (hearing notices, RFEs, etc.). She links each entry to the relevant case (Court Case, RFE, or Open Form) and adds deadlines + uploads the notice document. Those dates then mirror back into the case boards.

**What it is**: A cross-cutting deadline management board. Items don't link to profiles directly — they link to cases. The profile connection is indirect (Profile → Court Case → Calendaring item).

**How it connects**:
- Calendaring → Court Cases (hearing dates, fee due dates)
- Calendaring → RFEs (due dates, warning dates, issue dates)
- Calendaring → Open Forms (interview dates)
- Case boards mirror Calendaring columns back (e.g., `hearing_date_calendaring`, `due_date_calendaring`, `warning_calendaring`)

**Decision**: Added as the 19th board in `config/boards.yaml` with a minimal column config (status, board_relation links, dates, file). The full column structure will be discovered via snapshot or `sync-config`. Calendaring items go into `board_items` with `board_key = 'calendaring'` — no schema changes needed. Relationships stored in `item_relationships`.

**Dashboard implications**: Calendaring enables a unified "Deadlines" view without stitching together queries across multiple boards. Also provides access to uploaded notice documents that live on Calendaring items (not on the case boards themselves).
