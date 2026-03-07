# Next Steps — What to Pick Up

## Current State (after Phase 5, 2026-03-06)

Phases 1 through 5 are complete. The app has:
- Client-side routing with sidebar nav (`web/router.ts`)
- 360-degree client detail with tabs (`web/components/ClientView.tsx`)
- Landing page with 6 KPI cards (incl. Alerts), clickable counts → filtered view (`web/components/LandingPage.tsx`)
- Attorney Daily Appointments page at `/appointments` (`web/components/AppointmentsPage.tsx`)
- Enhanced search: type dropdown (Clients/Contracts/Court Cases/etc.), phone/email/address partial matching
- Filtered Clients page with priority chips, status/attorney/board type dropdowns, date range (`web/components/ClientsPage.tsx`)
- Smart Alerts page at `/alerts` — overdue deadlines, stale cases, idle contracts, grouped by severity (`web/components/AlertsPage.tsx`)
- Reusable `useUrlFilters` hook for URL-driven filter persistence
- REST API at `server.ts` serving all data from read-only SQLite

332 tests passing. All code on the `read-only` branch.

## Known Bug

Runtime error on the Clients tab:
```
TypeError: undefined is not an object (evaluating 'filteredProfiles.length')
at ClientsPage2
```

---

## Phase 6: UI Improvements & Tab Restructure

### 6a — Expand Updates/Notes in Appointments
**Problem**: The standalone Appointments page shows "Recent Notes (N)" but only 1–2 are visible in the collapsed preview (max-height 400px).

**Solution**: Both inline expand + modal.
- Add a "Show all" toggle on the collapsible section that removes the max-height limit, showing all notes inline
- Add a "View all in modal" link that opens a full-screen modal overlay with the complete notes list, scrollable, with the same filtering and grouping as `UpdatesTimeline`

**Files**: `web/components/AppointmentsPage.tsx`, `web/components/UpdatesTimeline.tsx`, new `web/components/NotesModal.tsx`

### 6b — Additional Profile Fields
**Goal**: Show Date of Birth, Place of Birth, and A-Number alongside existing fields (name, email, phone, address, priority).

**Schema changes** (`scripts/seed/lib/db/schema.ts`):
- Add columns to `profiles`: `date_of_birth TEXT`, `place_of_birth TEXT`, `a_number TEXT`

**A-Number normalization**:
- Monday.com sends varied formats: `123456789`, `123 456 789`, `A123-456-789`, `A 123 456 789`, etc.
- Store normalized: strip non-digits, store as 9-digit string
- Display as `A###-###-###` (e.g., `A123-456-789`)
- Utility function: `normalizeANumber(raw: string): string` and `formatANumber(normalized: string): string`

**Seeder**: Generate fake DOB (age 18–80), place of birth (city + country), and 9-digit A-numbers.

**Frontend**: Update `ProfileCard.tsx` and `ClientHeaderSticky.tsx` to show new fields.

**API**: Expose new fields in profile endpoints.

### 6c — Tab Restructure (360 View)

**Current tabs**: Overview | Appointments | Documents & Notices | Relations

**New tabs**: Overview | Appointments | Contracts | Active Cases | Court Cases | Documents & Notices | Relations

**Changes**:
- **Overview**: Keep Snapshot KPI cards + Timeline only. Remove Contracts and Active Cases sections from this tab.
- **Contracts**: New tab showing all Fee K entries (pending highlighted, closed collapsed) — content currently in Overview.
- **Active Cases**: New tab showing case items from boards like Open Forms, FOIAs, Appeals, Litigation, I-918B, Motions — but **excluding** items that have an `item_relationships` link to the `court_cases` board.
- **Court Cases**: New tab showing items that ARE linked to `court_cases` board entries via `item_relationships`. Displays the connected Court Case board values (hearing dates, judge, case number, etc.). These require special attention and are separated from regular USCIS/NVC cases.
- **Documents & Notices**: Placeholder for future SharePoint integration (Phase 7). Shows a message like "SharePoint integration coming soon" with brief explanation.
- **Relations**: Unchanged.

**Files**: `web/components/ClientView.tsx`, `web/components/ClientTabs.tsx`, new `web/components/ContractsTab.tsx`, new `web/components/ActiveCasesTab.tsx`, new `web/components/CourtCasesTab.tsx`

### 6d — Appointment Focus Modal

**Goal**: Allow attorney to open a single appointment in a focused modal overlay for deep review.

**Behavior**:
- Click an appointment row (or a "Focus" button) → opens a large modal overlay
- Modal shows: full appointment details, client snapshot, all notes/updates, status controls
- Attorney can read everything without navigating away from current context
- Modal is dismissible (click outside, Escape key, close button)

**Files**: New `web/components/AppointmentModal.tsx`

**Note**: Detailed design TBD — will discuss specifics in a dedicated session.

---

## Deferred — Monday.com Write-Back

The appointments page is the first feature that will need editing (update status, add notes, reschedule). `TODO(monday-write)` markers are placed in the query layer and component. See `docs/decisions.md` for the planned write-back architecture.

---

## Phase 7: SharePoint Document Integration

### Goal
View client e-files and consult files from SharePoint directly in the dashboard, without switching apps.

### Background
- Every client has an **e-file** in SharePoint: `/{Letter}/{LASTNAME, Firstname CaseNumber}/` with subfolders (FEE Ks, CC, FILINGS, COURT FILINGS, etc.)
- Every consultee has a **consult file**: `/{Year}/{LASTNAME, Firstname}/`
- Mutually exclusive — when hired, consult file moves to e-files
- Monday.com already stores the direct SharePoint folder URL per client (two columns: e-file link, consult file link)
- Azure AD app exists with `Files.ReadWrite.All`, `Sites.Read.All`, `User.Read`

### Phase 7a — Read-Only Browsing

**Schema**:
- Add `sharepoint_url` column to `profiles` table (stores the Monday.com link value)
- Seeder generates placeholder URLs for local dev

**Backend**:
- `GET /api/profiles/:id/documents` — takes stored SharePoint URL, calls Graph API to list folder contents
- Auth via client_credentials flow (tenant ID, client ID, client secret in `.env`)
- Cache folder listings ~5 min
- Graph API call: `/sites/{site-id}/drives/{drive-id}/root:/{path}:/children`

**Frontend**:
- "Documents" tab on ClientView showing file/folder tree
- Badge indicating "E-File" or "Consult File"
- Click file → opens in SharePoint browser
- Click folder → expands inline

### Phase 7b — Embedded Previews

- PDFs/images render inline in the dashboard
- Office docs use SharePoint's embed preview URL (Graph API provides `@microsoft.graph.downloadUrl` and preview endpoints)

### Phase 7c — Upload

- Upload from dashboard into the correct SharePoint subfolder
- Uses existing `Files.ReadWrite.All` permission

### Blockers Before Starting
- **SharePoint site URL** — e.g. `yourorg.sharepoint.com/sites/SiteName` (needed to construct Graph API paths)
- **Monday.com column names** — which columns hold the e-file and consult file links
- **Azure AD credentials** — tenant ID, client ID, client secret (to be added to `.env`)
