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

## Deferred — Monday.com Write-Back

The appointments page is the first feature that will need editing (update status, add notes, reschedule). `TODO(monday-write)` markers are placed in the query layer and component. See `docs/decisions.md` for the planned write-back architecture.

---

## Phase 6: SharePoint Document Integration

### Goal
View client e-files and consult files from SharePoint directly in the dashboard, without switching apps.

### Background
- Every client has an **e-file** in SharePoint: `/{Letter}/{LASTNAME, Firstname CaseNumber}/` with subfolders (FEE Ks, CC, FILINGS, COURT FILINGS, etc.)
- Every consultee has a **consult file**: `/{Year}/{LASTNAME, Firstname}/`
- Mutually exclusive — when hired, consult file moves to e-files
- Monday.com already stores the direct SharePoint folder URL per client (two columns: e-file link, consult file link)
- Azure AD app exists with `Files.ReadWrite.All`, `Sites.Read.All`, `User.Read`

### Phase 6a — Read-Only Browsing

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

### Phase 6b — Embedded Previews

- PDFs/images render inline in the dashboard
- Office docs use SharePoint's embed preview URL (Graph API provides `@microsoft.graph.downloadUrl` and preview endpoints)

### Phase 6c — Upload

- Upload from dashboard into the correct SharePoint subfolder
- Uses existing `Files.ReadWrite.All` permission

### Blockers Before Starting
- **SharePoint site URL** — e.g. `yourorg.sharepoint.com/sites/SiteName` (needed to construct Graph API paths)
- **Monday.com column names** — which columns hold the e-file and consult file links
- **Azure AD credentials** — tenant ID, client ID, client secret (to be added to `.env`)
