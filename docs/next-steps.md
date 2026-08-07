# Next Steps — What to Pick Up

## Current State (schema v22, 2026-08-07)

**539 tests passing.** The app runs on real Monday.com data in production, deployed via GHCR images (`.github/workflows/build-push.yml`) with a Docker Compose pull on the server.

Shipped since this document was last rewritten (2026-05-26), newest first — see `docs/nightly/` for the day-by-day account:

- **Write-back token fallback + reconnect prompt** (2026-08-07) — a personal Monday token refused on permission grounds falls back to the shared token instead of silently dropping the edit. `docs/decisions.md`, 2026-08-07.
- **Near-real-time mirror via Monday webhooks** (2026-08-06) — `POST /api/webhooks/monday/:token` + a background processor; changes land in ~1 minute instead of up to 2 hours. Scheduled syncs remain as the safety net. `docs/webhooks.md`.
- **Lossless reconciliation + Sync Health** (2026-08-05) — archive-before-delete, coverage guard, sync ledger, admin visibility into per-board coverage and the write queue.
- **In-place field editing + contract creation** (2026-08-04) — expand any Active Cases item to edit its columns; create a Fee K from a client's page.
- **Status write-back** (2026-07-30) — statuses editable from the dashboard, validated against each board's real labels.
- **Azure AD SSO + the user layer** (July) — preferences, watchlist, saved views, My Cases, admin user management, audit log; per-user Monday OAuth.
- **Data-layer hardening** (2026-06-30) — hardened SQLite, the `write_queue` outbox, encrypted backups + retention, Docker deployment.
- **Live data sync** — `DB_SOURCE=seed|live`, `npm run sync:live`, full + incremental modes.

The feature inventory below predates all of that and describes the read-only app as it stood in May. It is still broadly accurate about *those* screens, and is kept for that reason — but treat anything it says about what is missing as superseded.

<details>
<summary>Feature inventory as of 2026-05-26 (historical)</summary>

Phases 1 through 6d are complete and production-quality bugs have been resolved. The app has:
- Client-side routing with sidebar nav (`apps/web/src/router.ts`)
- 360-degree client detail with 7 tabs: Overview | Appointments | Contracts | Active Cases | Court Cases | Documents & Notices | Relations (`apps/web/src/components/ClientView.tsx`)
- Landing page with 6 KPI cards (incl. Alerts), clickable counts → filtered view (`apps/web/src/components/LandingPage.tsx`)
- Attorney Daily Appointments page at `/appointments` with "Show all" notes toggle, "Open in modal", and **Focus modal** for deep single-appointment review (`apps/web/src/components/AppointmentsPage.tsx`, `NotesModal.tsx`, `AppointmentModal.tsx`)
- Enhanced search: type dropdown (Clients/Contracts/Court Cases/etc.), phone/email/address partial matching
- Filtered Clients page with priority chips, status/attorney/board type dropdowns, date range (`apps/web/src/components/ClientsPage.tsx`)
- Smart Alerts page at `/alerts` — overdue deadlines, stale cases, idle contracts, grouped by severity (`apps/web/src/components/AlertsPage.tsx`)
- **Active Cases Board at `/active-cases`** — swim-lane grid (paralegal rows × urgency columns), color-coded cards, COURT badge for Court Forms cases, countdown labels, client name links (`apps/web/src/components/ActiveCasesPage.tsx`)
- Reusable `useUrlFilters` hook with popstate listener for URL-driven filter persistence + browser back/forward support (`apps/web/src/hooks/useUrlFilters.ts`)
- REST API at `apps/api/src/server.ts` serving all data from read-only SQLite, including `GET /api/active-cases`
- Profile fields: name, email, phone, address, priority, DOB, place of birth, A-Number (formatted as `A###-###-###`)
- Contracts tab, Active Cases tab, Court Cases tab all wired with real data
- Documents & Notices tab wired to `DocumentsTab` component (board-based docs from `DOCUMENT_BOARD_KEYS`); `SharePointPlaceholder` available for when Graph API integration lands (`apps/web/src/components/DocumentsTab.tsx`)
- Appointments query uses batch-preload pattern — 9 flat queries regardless of result count (was 9N+1); see `libs/query/src/appointments.ts` and batch functions in `updates.ts`, `contracts.ts`, `board-items.ts`, `case-summary.ts`
- Dashboard KPI "upcoming" windows are exactly 7 days inclusive (`libs/query/src/dashboard.ts`)

354 tests passing.

Also built:
- `scripts/export-stats.ts` — internal DB diagnostic tool (`npm run stats` / `npm run stats:live`), runs against `seed.db` or `live.db`
- `scripts/snapshot.ts` — fetches all boards from Monday.com and produces `data/monday-snapshot.md` + `data/monday-snapshot.json`. Run this to get real board counts before building the sync.

### Schema

Database at **v8** (`libs/seed/src/db/schema.ts`). Key changes from v7:
- `board_items.paralegals TEXT` — promoted from `column_values` JSON for indexed queries
- `board_items.next_date` backfill extended to cover `$.target_date.date` for open forms (was missing from v3 migration)
- Index: `idx_board_items_paralegals ON board_items(board_key, paralegals)`

</details>

The mirror schema is now at **v22** and `users.db` at **v10**; both apply ordered, idempotent migrations on API startup, taking a snapshot first (`libs/seed/src/db/schema.ts`, `apps/api/src/db/users-db.ts`).

---

## Phase 6d — Appointment Focus Modal ✅ DONE

**Goal**: Allow attorney to open a single appointment in a focused modal overlay for deep review.

**Behavior**:
- Click an appointment row (or a "Focus" button) → opens a large modal overlay
- Modal shows: full appointment details, client snapshot, all notes/updates, status controls
- Attorney can read everything without navigating away from current context
- Modal is dismissible (click outside, Escape key, close button)

**Files**: New `web/components/AppointmentModal.tsx`

**Note**: Detailed design TBD — will discuss specifics in a dedicated session.

---

## Phase — Live Data Mode (Dual Database) ✅ DONE

Shipped as designed below. `DB_SOURCE=seed|live` switches the database, `npm run sync:live` runs the sync (full and incremental), `data/live.db` is gitignored, and both vars are documented in `.env.example`. The sync has since grown a run ledger, archive-before-delete reconciliation, and a coverage guard — see `libs/query/src/sync-health.ts` and the 2026-08-05 nightly.

### Goal
Use real Monday.com data for testing alongside the existing fake seeder data, without exposing sensitive client information in the repository.

### Approach: Two Databases, One Switch
- **`data/seed.db`** — fake data from the seeder (default, safe to regenerate)
- **`data/live.db`** — real Monday.com data, **gitignored**, never leaves the developer's machine
- **`DB_SOURCE=seed|live`** env var switches which database the app reads from
- Same schema, same query layer, same UI — just different data underneath

### Why This Over Anonymization
- Forces building the **sync engine** (Monday.com → SQLite), which is needed for production anyway — no throwaway work
- Zero PII risk — `live.db` is a local file, gitignored
- See *exactly* what production will look like — no anonymization artifacts
- Any developer without a Monday.com token just uses `seed` mode (the default)
- CI always runs against `seed` — no secrets needed

### What Needs to Be Built
1. **Env-based DB switching** — update `server.ts` (currently hardcodes `data/seed.db`) to read `DB_SOURCE` and resolve path to `seed.db` or `live.db`
2. **Sync script** (`scripts/sync.ts` or similar) — fetches from Monday.com API, maps `MondayItem` → SQLite rows across all 18 boards, writes into `live.db`
3. **Gitignore `data/live.db`** (and WAL/SHM files)
4. **Document in `.env.example`** the `DB_SOURCE` and `MONDAY_API_TOKEN` vars

### Existing Building Blocks
- API client with retry/rate-limit handling: `libs/monday/src/api.ts`
- Board config with all 19 board IDs: `config/boards.yaml`
- Column resolver: `libs/monday/src/column-resolver.ts`
- Real data samples already fetched: `data/samples/*.json`
- Snapshot script as reference for fetching all boards: `scripts/snapshot.ts`

---

## Phase — Case Progress Map (Modular Visual Workflow)

### Goal
Give staff and attorneys an instant, visual understanding of where any client's cases stand — what's done, what's pending, and what's missing — without digging through boards.

### Core Concept: Modular Lifecycle Maps
Each case type (court case, open form, fee K, appeal, FOIA, I-918B, etc.) has its own defined lifecycle — a sequence of expected stages and artifacts. The dashboard assembles a per-client view by snapping together only the modules relevant to that client's actual cases.

**Example**: A client with a court case + an open form + a fee K sees three progress modules. A client with just a consult sees one. Each module shows its own stages independently.

### How It Works

**1. Define workflows per case type**
Each board type gets a stage map — the expected milestones in order. Examples:

- **Court Case**: NTA filed → Hearing scheduled → Evidence deadline → Brief filed → WPS filed → Application filed → Individual Hearing → Decision
- **Open Form (USCIS)**: Form assigned → Forms sent to client → Forms appointment → Filed → Receipt received → Biometrics → Interview scheduled → Interview → Decision
- **Fee K (Contract)**: Contract created → Sent to client → Signed → Payment received → Hire date set → Paralegal assigned
- **Appeal**: Notice of Appeal filed → Brief schedule received → Brief due → Brief filed → Decision
- **FOIA**: Request filed → Acknowledgment received → Results received → Follow-up

**2. Derive stage from existing data**
Each stage maps to concrete data points already in the boards:
- A column value being non-empty (e.g., `brief_filed_on` has a date → "Brief filed" is complete)
- A status column value (e.g., status = "Filed" → that stage is done)
- A file column having an attachment
- A date column being in the past vs future

No manual stage tracking needed — the map reads what's already in Monday.com/SQLite.

**3. Visual rendering**
- Horizontal progress bar or stepped pipeline per case
- Completed stages: solid/green, collapsed
- Current stage: highlighted/active
- Future stages: gray/outlined
- Missing/overdue: red flag (e.g., evidence deadline passed but no evidence filed)

**4. Assembled per profile**
The client's 360 view shows all their active case modules stacked. Completed cases collapse to a single "done" line. The attorney sees at a glance: "3 active matters, court case is at hearing stage, open form waiting on receipt, fee K fully signed."

### What Needs to Be Built
1. **Workflow definitions** — YAML or TypeScript config defining stages per board type, with the column/condition that marks each stage complete
2. **Stage resolver** — function that takes a board item's column values and returns which stages are complete/pending/overdue
3. **CaseProgressMap component** — React component rendering the visual pipeline for one case
4. **ProfileProgressView component** — assembles all CaseProgressMap modules for a client
5. **Integration** — new tab or section in ClientView (possibly the Overview tab)

### Why This Matters
This is the feature that turns the dashboard from a "data viewer" into a "case management tool." Staff stops asking "what's the status?" — they see it. Attorneys stop forgetting deadlines — they're red on the map. New staff understands a case in seconds instead of clicking through 5 boards.

---

## Monday.com Write-Back ✅ LIVE (partial)

No longer deferred. Shipped and in daily use:

- **Notes** — `POST /api/profiles/:id/updates`
- **Status** — `PATCH /api/board-items/:id/status`, validated against the board's real labels
- **Any simple column** — `PATCH /api/board-items/:id/columns` (status, dropdown, date, numbers, text)
- **Create a contract** — `POST /api/profiles/:id/contracts`

All four share the same rails: personal Monday token with a shared-token fallback (`apps/api/src/write-auth.ts`), the durable `write_queue` outbox for outages, an optimistic local write, and an audit-log entry.

**Still TODO**: `reschedule` (a date-column op is stubbed in `apps/api/src/write-queue/processor.ts`), and complex column types (people, board relations, files) which the generic column endpoint deliberately rejects.

See `docs/decisions.md` — 2026-03-03 for the original design, 2026-08-07 for the token policy.

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
- `SharePointPlaceholder` component already in place (`web/components/SharePointPlaceholder.tsx`) — ready to replace with real implementation

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
- Replace `SharePointPlaceholder` in `DocumentsTab.tsx` with real file/folder tree
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
