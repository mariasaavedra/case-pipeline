# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run dev:api        # Start API server (Express, port 3000)
npm run dev:web        # Start web dashboard (Vite, port 5173)
npm run dev:cli        # Run CLI via tsx

# Build & Type checking
npm run build          # Build all workspaces
npm run typecheck      # Type-check all workspaces

# Testing
npm run test           # Run all workspace tests
# Run a single test file:
npx vitest run apps/api/src/some.test.ts

# Linting
npm run lint           # ESLint (flat config at eslint.config.js). Passes today; fails on new errors
npm run lint:strict    # Same, but --max-warnings=0 — the gate to adopt once the warning count hits 0

# Other
npm run preflight      # Pre-flight environment checks (Node version, npm, data dir writable)
npm run check:env      # Validate .env — the same check the API runs at startup; exits 1 if the API would refuse to boot
npm run seed           # Generate local test data (no Monday.com API needed)
npm run stats          # Export statistics from local DB
npm run stats:live     # Export statistics from live DB
```

The web app proxies `/api` requests to `localhost:3000`, so both dev servers must be running together.

## Architecture

**case-pipeline** is a config-driven automation platform for a Monday.com-based immigration law workspace. It syncs Monday.com board data into a local SQLite database and provides a dashboard, document generation, and CLI tooling.

### Monorepo Layout

npm workspaces across two top-level directories:

- `apps/api` — Express 5 REST API backed by Better-sqlite3
- `apps/web` — React 19 + Vite 6 + Tailwind 4 dashboard
- `apps/cli` — CLI with commands: `render`, `seed`, `lookup`, `sync`, `analyze`
- `libs/core` — Shared utilities and type definitions
- `libs/config` — Loads `config/boards.yaml` (board IDs, column mappings, relationships)
- `libs/monday` — Monday.com GraphQL API client with flexible column resolution strategies (`by_type`, `by_title`, `by_id`)
- `libs/query` — Typed SQLite query layer (see Query Layer section below)
- `libs/template` — Document generation via Handlebars + docxtemplater (DOCX output)
- `libs/relationship-map` — Board relationship analysis
- `libs/seed` — Faker.js-based local test data generator

TypeScript path aliases (defined in `tsconfig.base.json`) map `@case-pipeline/*` to the corresponding lib.

### Data Flow

Monday.com boards → `libs/monday` (GraphQL) → SQLite (`libs/query`) → REST API (`apps/api`) → React dashboard (`apps/web`)

Document generation: Monday.com item → `libs/template` (Handlebars context) → DOCX via `templates/`

### Configuration

Board definitions live in `config/boards.yaml` — board IDs, column mappings, and inter-board relationships are YAML, not hardcoded. The `libs/config` package loads this at runtime. `config/templates.yaml` maps Monday.com data to template variables. `config/timeline.yaml` names the case-timeline milestones per board (`loadTimelineConfig`).

### Environment Variables

See `.env.example` for the full list. Key variables:

| Variable | Required | Description |
|---|---|---|
| `MONDAY_API_TOKEN` | Yes (live data) | Monday.com API token |
| `ITEM_ID` | Yes (render pipeline) | Item ID to render a document for |
| `TEMPLATE_NAME` | No (default: `client_letter`) | Template name from `config/templates.yaml` |
| `OUTPUT_DIR` | No (default: `output`) | Output directory for rendered files |
| `PROFILES_BOARD_ID` | No | Override board ID from `config/boards.yaml` |
| `CONTRACTS_BOARD_ID` | No | Override board ID from `config/boards.yaml` |
| `MONDAY_API_VERSION` | No (default: `2024-10`) | Monday.com API version |
| `FEE_K_AUTOFILL` | No | `on` fills empty Fee K columns on Monday every 15 min: POC Full Name from the Jail Intake, AF/FF Surcharge (3%) when paid by credit card, "It will go to…" from the Fee K Types table (Settings → Firm). Needs `FEE_K_AUTOFILL_SINCE`. See `docs/features/fee-k-autofill.md` |
| `MONDAY_WEBHOOK_SECRET` | No | Enables the Monday webhook receiver + processor (near-real-time mirror refresh). See `docs/webhooks.md` |
| `SLACK_MODE` | No (default `off`) | `dry-run` logs what it would post; `on` posts with `SLACK_BOT_TOKEN` (`xoxb-`) to `SLACK_EVENTS_CHANNEL` (contract signed / payment link sent, consult prepped, mail to review, texts sent, Adobe Sign, client uploads) and `SLACK_OPS_CHANNEL` (sync / job / Monday-write failures, max 1 per kind per hour). Channel ids, not names. Sender = `apps/api/src/notify/slack.ts`. See `docs/features/sms-and-slack.md` |
| `SMS_MODE` | No (default `off`) | `dry-run` records texts without sending; `on` sends through RingCentral and needs `RINGCENTRAL_CLIENT_ID` / `_CLIENT_SECRET` / `_JWT` / `_FROM_NUMBER` (E.164). Seed data is always dry-run. See `docs/features/sms-and-slack.md` |
| `ZAPIER_ESIGN_HOOK_URL` / `ZAPIER_ESIGN_SECRET` | No | Both set (+ `API_URL`) = M22 "Send for signature": contracts to Adobe Sign through 3 Zaps. See `docs/features/esign-zapier.md` |
| `SLACK_WEBHOOK_URL` | No | Slack Incoming Webhook for contract alerts (signed / rejected / expired / recalled) |
| `LAWPAY_SLACK` | No | `on` reads LawPay payments from the "Payment Bot" posts in Slack #payments (`LAWPAY_SLACK_CHANNEL`, default C0922BS65LM) every 2 min with `SLACK_BOT_TOKEN` and updates the Fee Ks. Check first: `npm run lawpay:slack` (read-only). See `docs/features/lawpay-payments.md` |
| `LAWPAY_MAIL` | No | `on` reads LawPay receipt e-mails forwarded to importantdocuments@ every 10 min (`LAWPAY_MAIL_CRON`) and updates the Fee Ks. Needs `npm run lawpay:mail -- --login` once (adds Mail.Read). See `docs/features/lawpay-payments.md` |

tsx/Node loads `.env` automatically via `--env-file` flag in the sync command. For other scripts, ensure `.env` is present at the repo root.

### Key Design Patterns

- **Config-over-code:** Board structure is declared in YAML; column resolution supports `by_type`, `by_title`, and `by_id` strategies with fallbacks.
- **ETL pattern:** Monday.com data is explicitly mapped into SQLite schemas; queries run locally against SQLite, not the live API.
- **Seed-first development:** `npm run seed` generates realistic local data via Faker.js so the full app can run without Monday.com API calls.
- **Template-driven documents:** Handlebars templates in `templates/` are logic-light; all data preparation happens in `libs/template` before rendering.
- **Batch query pattern:** Multi-profile queries (e.g. appointments) use batch preload via `IN (...)` + `GROUP BY`, not per-row sub-queries. See `libs/query/src/appointments.ts`.
- **Write-back token policy:** Writes go out under the acting user's personal Monday OAuth token (for attribution), falling back to the shared `MONDAY_API_TOKEN` **only** when Monday refuses theirs on permission grounds — a rate limit or outage still throws so the write queue retries it. See `apps/api/src/write-auth.ts`. Adding a scope to `buildOAuthUrl` silently breaks every existing connection (Monday never widens an issued token), so a scope change must ship with the reconnect prompt. See `docs/decisions.md`, 2026-08-07.

## Query Layer (`libs/query`)

Package exports four public subpaths:

```ts
@case-pipeline/query          // index — re-exports all public types
@case-pipeline/query/types    // shared TypeScript interfaces
@case-pipeline/query/appointments  // daily appointments with batch enrichment
@case-pipeline/query/client   // profile search, filtered listing, filter options
@case-pipeline/query/relationships  // item_relationships queries
```

Internal modules (not in `package.json` exports, imported via `@case-pipeline/query/*` wildcard alias from `apps/api` handlers):

| Module | Responsibility |
|---|---|
| `appointment-boards.ts` | Which `appointments_<initials>` boards exist in the synced data. No list in code: a new attorney = `boards.yaml` entry + Settings → Attorney boards |
| `active-cases.ts` | P5 Active Cases: de-duplicated case list + per-paralegal lanes, urgency buckets |
| `alerts.ts` | Overdue deadlines + stale cases, only on boards whose date is a real deadline (`DEADLINE_BOARDS`, with each board's "finished" statuses); plus "Mail to review" |
| `appeal-deadlines.ts` | "Appeal & Federal Deadlines" alert group: BIA appeal clock on court cases "REMOVED - Appealing?" / recently "Ordered Removed" (30 days from the removal date in the item name, else last hearing), Appeals board appeal/brief due with nothing filed, Litigation due within 14 days |
| `u-visa-certifications.ts` | Alert groups "I-918B Expiring" (signed certification expiring within 45 days or expired ≤60 days ago, no U visa / I-918 Open Form sent since signing; Expiration Date else signed + 6 months) and "I-918B Requests Pending" (90+ days since the hire date, unsigned). The I-918B board is not in `DEADLINE_BOARDS` |
| `my-cases.ts` | P6 My Cases: Prescheduling + Open Forms filtered to one paralegal (or everyone), E-File from the profile else the item's mirror, card dates, PS Stage + Open Forms status labels |
| `prescheduling.ts` | P13 Prescheduling: Paid Fee Ks by PS Stage, days since hire (30/60), "not cooperating" (reminder 14+ days, no evidence since), North Pole parked |
| `pending-contracts.ts` | P14 Contracts: Pending Fee Ks by Contract Stage, aged from sent (else added) date, 30/60 days; `CONTRACT_STEPS` = the Acrobat signing + payment-link steps; `missing` = empty Fee K Type (else the older Contract for) / AF / Attorney / E-mail / Address |
| `court-cases.ts` | P15 Court Cases: active court cases with hearing/judge/method, Case Prep Status, readiness (Trial 60/90, MCH 14 days), data-cleanup flags |
| `address-changes.ts` | P18 Address Changes: open changes of address by phase (paid/our turn → client/attorney → submitted → waiting on payment), aged from Date Received (7/14 days on our turn, else 30/60), next hearing for court changes, cleanup flags |
| `workload.ts` | P20 Workload: open items per person across P5/P13/P14/P15/P19 (each page's own query, North Pole out), names resolved by the staff roster's matcher (passed in); "no one assigned" + "held only by inactive staff" (also an Alerts group) |
| `foias.ts` | P19 FOIAs: open FOIA requests by phase (decide / our turn / waiting on the agency / North Pole); "Done FOIAS" group, COMPLETED, NOT PROCEEDING or a Results Received date = done; agencies quoted vs filed; inquiry due |
| `board-columns.ts` | Per-board column schema for the in-place field editors |
| `board-items.ts` | Per-profile board item queries + `batchGetClientBoardItems` |
| `case-summary.ts` | Full 360° client summary + `batchGetClientCaseSummaries` |
| `contracts.ts` | Contract queries + `batchGetClientContracts` |
| `mail-review.ts` | Saved mail scans, the "Mail to review" Alerts group, assign/dismiss decisions |
| `mail-writeback.ts` | What an assigned notice writes to its Open Form (plan, by column title), write-back state per notice |
| `mail-layout.ts` | Reads labelled fields by word position (I-797 grid: value under its label, or inline "Label: value") |
| `mail.ts` | Mail intake: OCR-misread repair, all notice fields (receipt, case type, dates, petitioner/beneficiary/applicant, A#, DOB, section), name + date matching, auto-split of one scan into notices, match to profile + Open Form |
| `case-timeline.ts` | P3.9 Case timeline: one profile's dated milestones on five tracks (court, USCIS, fees, meetings, notes) from `config/timeline.yaml` (column → milestone per board) + rules in code (court outcome from the item name, hearing outcomes incl. "CONT. FROM", appeals with stored due date over removal + 30, motions, RFEs/denials, appointments, Fee K signing); NVC notices, FOIAs, Litigation and I-918Bs are config-only milestones; key E&A types folded into same-day filings; summary = Where it stands / Needs attention / Coming up; from `item_events`: status / group changes (kind `change`) and moved dates (`moved` per board, old date crossed out) |
| `item-history.ts` | An item's changes from `item_events` (batch per item ids; link / subitem / people / button noise out); the timeline's rules: `statusChanges` (status column + group moves, per day, no first value, not in the item's first hour) and `dateMoves` (date to date, per day, not in the first 24 h) |
| `dashboard.ts` | KPI card queries (6 cards, 7-day windows) |
| `search.ts` | Cross-type search (contracts, court cases, etc.) |
| `status-options.ts` | Each board's real status labels + colors (write-back validates against these) |
| `sync-health.ts` | Sync-run ledger, per-board coverage, write-queue depth + failures, archived rows |
| `monday-usage.ts` | Our Monday API call counts per UTC day per job (`monday_api_calls`, schema v34). The counter is `libs/monday/src/usage.ts` (`withMondayJob`, `setDefaultMondayJob`); the API flushes it every minute, the sync as it goes, the consult sweep / Drive intake at exit (`scripts/lib/monday-usage.ts`) |
| `updates.ts` | Client update queries + `batchGetClientUpdates` |

## CLI Commands (`apps/cli`)

Run with `npm run dev:cli -- <command> [options]`:

| Command | Description |
|---|---|
| `render` | Generate a DOCX document from a Monday.com item. Interactive profile selector if `--item` is omitted. |
| `seed` | Populate local `data/seed.db` with Faker.js test data (`--profiles=N`, `--contracts=N-M`, `--seed=N`). |
| `lookup` | Look up a profile or board item by ID and print its column values. |
| `sync` | Sync `config/boards.yaml` against live Monday.com board structures (`--dry-run`, `--verbose`, `--add-board`). |
| `analyze` | Generate a board relationship map as Markdown or JSON (`-o`, `--format`, `--tracked-only`). |

## API Routes (`apps/api`)

Served from `http://localhost:3000`. Every `/api/*` route requires an Azure AD bearer token (`requireAuth`); admin routes additionally pass `requireAdmin`. `/health` is the only unauthenticated route.

Data reads:

| Route | Description |
|---|---|
| `GET /api/dashboard` | 6 KPI cards (open forms, pending contracts, paid fee Ks, deadlines, hearings, alerts). Open Forms excludes `Send to North Pole` cases |
| `GET /api/dashboard/:key/items` | Every row behind one KPI card + the display-column options (`?column=` previews one) |
| `GET /api/appointments` | Daily appointments with enriched profiles, snapshots, updates, case summaries |
| `GET /api/my-day` | P4 My Day: one attorney board's appointments for one day (`?board=`, `?date=`; default = the caller's own board — `users.attorney_board`, else matched by name — and today), each with its latest consult prep, Calendly words, notes and case summary. Plan = `routes/my-day.ts` |
| `GET /api/active-cases` | P5 data: `cases` (each once, by urgency, with attorney/forms/Urgent flag) + `assignees` lanes (used by My Cases). `?includeSnoozed=1` reveals North-Pole-parked cases |
| `GET /api/prescheduling` | P13 data: Paid Fee Ks waiting for documents, with wait level, not-cooperating flag, PS Stages in workflow order |
| `GET /api/pending-contracts` | P14 data: Pending Fee Ks with age level, payment link, AF/FF, stages in pipeline order |
| `GET /api/court-cases` | P15 data: active court cases (Docket + Prep Pipeline views), stages in workflow order, Case Prep Status options |
| `GET /api/address-changes` | P18 data: open address changes with phase, age level, next hearing, flags; the board's status labels + the Status / Date Sent column ids for write-back (via `PATCH /api/board-items/:localId/status` and `/columns`) |
| `GET /api/foias` | P19 data: open FOIAs with phase, age (14/30 days our turn, 30/60 since filed), agencies still to file, cleanup flags; done count |
| `GET /api/alerts` | Grouped alerts by severity (critical / warning / info), incl. "Appeal & Federal Deadlines", "I-918B Expiring", "I-918B Requests Pending", "Mail to review" and "Assigned to inactive staff" |
| `GET /api/workload` | P20 (admin): open work per person + no one assigned + held only by inactive staff. Query = `libs/query/src/workload.ts` |
| `GET /api/search` | Cross-type search: profiles, contracts, court cases, etc. |
| `GET /api/filter-options` | Distinct values for filter dropdowns (priorities, statuses, attorneys, board types) |
| `GET /api/clients` | Filtered + paginated profile listing |
| `GET /api/clients/search` | Legacy profile-only search |
| `GET /api/clients/:id` | Full 360° case summary for one client |
| `GET /api/clients/:id/contracts` | Contracts for one client |
| `GET /api/clients/:id/board-items` | Board items grouped by board key |
| `GET /api/clients/:id/updates` | Timeline updates for one client |
| `GET /api/clients/:id/relationships` | Item relationships for one client |
| `GET /api/clients/:id/timeline` | P3.9 case timeline: dated milestones, notes per month, summary (`routes/case-timeline.ts`; mapping `config/timeline.yaml`, read once per process). Needs attention items carry `fix` = the Monday item to open; E&A events carry `updateLocalId` (for a reply) |
| `GET /api/timeline/items/:localId` | M29 event panel: one board item's editable fields with values, the ones the timeline reads first (`status`, milestone columns, the board's `edit` list). Logical key ↔ Monday column id re-resolved from `boards.yaml` (`apps/api/src/board-column-keys.ts`). Edits go through `PATCH /api/board-items/:localId/columns`, which now also updates the local `column_values` (every key the column is stored under). Also `history`: the item's changes, newest first, people named from the staff roster |
| `GET /api/board-items/:id` | Single board item detail |

Writes and user/account routes:

| Route | Description |
|---|---|
| `POST /api/profiles/:id/updates` | Post a note to Monday.com (falls back to the write queue on outage) |
| `POST /api/updates/:localId/replies` | Sub-note under a timeline entry: a real Monday reply under an update, or — for an E&A entry, which Monday can't thread — a `Re: <entry> (<date>) —` update on the same item. Stored as a `reply` row threaded by `reply_to_update_id` (plan = `routes/note-replies.ts`). Queues on outage |
| `POST /api/profiles/:id/release` | Mark a detained client released (M17): clears Det. Facility on their open court case(s) in Monday and logs a "Casenote" E&A entry on the profile (note required, release date optional). Queues on outage. Plan = `routes/detention-write.ts` |
| `PATCH /api/court-cases/:localId/prep-stage` | Move a court case to another Case Prep Status (P15 Prep Pipeline). `{stage, from}`: labels from the synced schema, 409 if the stage moved since the page loaded, local column updated optimistically, queues on outage. Plan = `routes/court-case-write.ts` |
| `PATCH /api/motions/:localId/status` | Change a motion's Status (P15 Motions tab). `{status, from, date?}`: labels from the synced schema, 409 if the status changed since; Filed also writes MTN Filed on, Granted/Denied write Dec. Date (default today, never future); local status + date updated optimistically, queues on outage. Plan = `routes/motion-write.ts` |
| `GET /api/reception/consults` | P17: consults on the active attorney boards between `?from`/`?to` (default today + 7 days), each with its latest prep (`consult_preps`, schema v29) |
| `POST /api/reception/consults/:localId/prep` | M18 consult prep: one note posted as an Update on the profile, a pinned Update on the appointment (`pin_to_top`, API 2025-07) and a "Consult Prep Note" E&A entry on the profile (falls back to "Consult note" until that type exists in Monday — looked up by name). Edited phone → profile Phone; edited description → appointment Description. Queues on outage. Plan + rules = `routes/reception.ts` |
| `POST /api/reception/consults/:localId/files` | A file uploaded in M19 (already in SharePoint) also attached to the profile's Files column. Raw body, `?name=`, `?type=` |
| `POST /api/reception/consults/:localId/profile` | Link an unlinked consult to a profile (M24): `{profileLocalId}` → the appointment's Profiles column in Monday + local row. 409 if it was linked since the page loaded (changing a link stays in Monday); queues on outage. Plan = `routes/consult-link.ts` |
| `POST /api/appointments/:localId/consult-note` | P4 consult note: `{note, fees?}` → an E&A "Consult note" on the appointment's client profile. Optional `fees` `{caseType, newCaseType?, af, ff, pf}` = a quote: a `Contract: …` line on the note + a `consult_fee_quotes` row (schema v32); no Fee K is made, the Fee K auto-fill copies it onto the one staff create in Monday (not mirrored locally; shows after the next sync). Queues on outage. Then starts the **post-consult process**: the consult sweep for that one appointment (`consult-summary.ts`, only when `CONSULT_FOLDERS=on`), which writes `CONSULT/Consultation Summary <date>.docx` with this note into the client's SharePoint folder. Plan = `routes/my-day.ts` |
| `POST /api/contracts/:id/step` | Record a signing step on a Fee K (contracts are signed in Acrobat Pro, attorney then client): `sent_for_signature` → Atty Reviewing, `attorney_signed` → Sent to Client + Contract Sent On, `client_signed` → Needs Payment Link + Signed Contract Received On, `payment_link_sent` → Payment link sent + Payment Link Sent On. Stage + date in one Monday write; `from` stale check (409); queues on outage. Plan = `routes/contract-step.ts` |
| `PATCH /api/contracts/:localId/case-field`, `PATCH /api/open-forms/:localId/case-field` | P6 case card (M27): one field per request, `{field, value, from}` — Fee K: `ps_stage`, `reminder_sent_checked_on`, `evidence_received_date`; Open Form: `status`, `target_date`, `forms_appt_date`, `forms_sent_date`. Real labels only, YYYY-MM-DD or "" (clears), no future reminder/evidence/sent date; 409 if Monday changed since; local copy updated optimistically, queues on outage. Plan = `routes/case-card-write.ts` |
| `POST /api/profiles/:localId/e-file` | P6 case card: `{url, replaces?}` → the profile's E-File (SharePoint https links only), written only when empty or still `replaces`; queues on outage |
| `PATCH /api/contracts/:id/fees` | M25 Edit contract (P14.3): everything a contract is generated from. `{fees?, caseType?, newCaseType?, attorney?, email?, address?, from}`: only what changed is written — fees / case type / attorney (People column, resolved to a Monday user) in one Fee K write; the client's e-mail / address on the **profile** (the Fee K mirrors them), never emptied. 409 if any changed on Monday since; local copies updated optimistically, queues on outage. Plan = `routes/contract-fees.ts` + `contract-info.ts` |
| `GET /api/contract-info?profile=` | Pre-fill for M11 / M2 / M25: the profile's e-mail, address and attorney, and the attorney pick list (Settings → Documents, then anyone already on a Fee K) |
| `POST /api/contracts/:id/esign` | Send for signature in Adobe Sign via Zapier (M22): raw PDF body + `?attorneyEmail=&clientEmail=` → PDF behind a 3-day random link (`GET /api/esign/files/:token/:name`, no login), Zap 1 called, step `sent_for_signature` + a note. One open agreement per Fee K (409). Rows in `esign_agreements` (schema v33). `GET /api/esign/status` = whether it's configured. Plan = `routes/esign.ts` |
| `POST /api/webhooks/zapier/:secret` | Adobe Sign events from Zaps 1–3 (unauthenticated — secret URL, constant-time compare). Matched by `[CP-n]` in the agreement name or the agreement id; rules in `esign/events.ts`: attorney signed → `attorney_signed`, all signed → `client_signed` + Monday notification to the sender + Slack, rejected/expired/recalled → note + notification, stage untouched; `signed_pdf` attaches the signed copy. A `formData` field (Zap 3) carries the client's Credit / Debit / Cash pick → the Fee K's Payment Method when empty + a "links ready" note; M21 then e-mails the LawPay links (bilingual, credit = +3% per link) from the staff member's own Outlook (Graph `Mail.Send`) for app-signed contracts only. Repeats are no-ops. See `docs/features/esign-zapier.md` |
| `GET /api/contracts/:id/document-form`, `POST /api/contracts/:id/document-generated` | Contract generation (M22) support: Monday pre-fill (client, e-mail, address, attorney, AF/FF/PF, next hearing from the client's court case) and an audit entry (`doc.contract_generated`). The contract itself is filled **in the browser** from the firm's Word templates in SharePoint (`Fee Contracts/App Templates`, staff-edited, `{{tags}}` = `apps/web/src/lib/contract-fill.ts`) and turned into a PDF by Microsoft Graph (`convertDocxToPdf`). `document-generated` (Send / each Download, not Preview) also makes the user the Fee K's **Assistant** when it has none (checked live first, never replaced). AF + FF can be filled from the firm's fee sheet in SharePoint (`FeeSheetPicker`, `lib/fee-sheet.ts`) |
| `GET/POST /api/profiles/:id/documents/g28` | G-28 (M23): GET = pre-filled form (attorney from document settings, client from Monday — mailing address split by `documents/us-address.ts`, a detained client's facility address with ICE + Respondent) + the form's box sizes; POST `{input}` = the filled official USCIS PDF (`templates/forms/g-28.pdf`, pdf-lib), 400 with `problems` when something is missing or doesn't fit, audited `doc.g28_generated` (no client details). The browser downloads it and saves a copy to the client's SharePoint folder. Nothing written to Monday. Rules = `apps/api/src/documents/g28.ts` |
| `POST /api/profiles/:id/render` | Generate a DOCX for a profile from live Monday.com data (default template `client_letter_docx`) |
| `GET /api/auth/me` | Validate token, upsert user (first user becomes admin) |
| `GET/PUT /api/preferences`, `PATCH /api/me/profile` | Per-user preferences and profile |
| `GET/POST/DELETE /api/watchlist`, `/api/saved-views`, `GET /api/me/recently-viewed` | Personalization (keyed by stable Monday item ids) |
| `GET /api/my-cases`, `GET /api/paralegals` | P6 My Cases: one paralegal's Prescheduling (Paid Fee Ks) + Open Forms cases with E-File links, editable dates and both boards' status labels (`?paralegal=<name>` / `all`; default = the caller's `paralegal_link`; `?includeSnoozed=1`). Query = `libs/query/src/my-cases.ts`. And the identity options |
| `GET/POST/DELETE /api/settings/attorney-boards` | Attorney appointment board config (mutations admin-only) |
| `GET/PUT /api/settings/kpi-columns` | Firm-wide default display column per KPI card (PUT admin-only); users override via `preferences.kpiColumns` |
| `GET/PUT /api/settings/status-overrides` | Firm-wide status label/color overrides (PUT admin-only, audited); merged over the code base map by the web's `translateStatus` |
| `GET /api/settings/status-catalog` | Distinct board-item statuses + counts, for the admin status-tag editor |
| `GET/PUT /api/settings/urgency` | Urgency thresholds (criticalDays/soonDays) + whether status urgency reorders Active Cases (PUT admin-only, audited) |
| `GET /api/settings/integrations`, `GET …/slack/channels`, `PUT /api/settings/notify`, `POST …/slack/test`, `POST …/sms/check` | Settings → Integrations (P11.5, admin-only): Slack + RingCentral status (never a secret — only whether it's set and whose it is), per-event Slack on/off + channel + failure repeat limit (`data/notify-settings.json`, audited), test post (audited, posts even in dry-run), RingCentral check (`sms/check.ts`, same as `npm run sms:check`). Channel list cached 5 min (`?refresh=1`). Plan = `routes/integrations.ts`, catalog = `notify/settings.ts` |
| `GET/PUT /api/settings/documents` | Firm address/phone/fax, attorneys (email, USCIS account, bar admissions) and detention facility addresses for generated forms, `data/document-settings.json` (defaults in `documents/document-settings.ts`; PUT admin-only, audited) |
| `GET/PUT /api/settings/fee-k-types` | Fee K Types table (P11.3.6): per Fee K Type the Spanish name, board once paid ("It will go to…" label) and fee sheet job; GET (any user, the contract forms read it) also returns Monday's Fee K Type + "It will go to…" labels; PUT admin-only, audited. `data/fee-k-types.json`, rules = `apps/api/src/fee-k-types.ts`. The Fee K auto-fill fills an empty "It will go to…" from it; M11 / M2 / M25 fill an empty AF / FF from the job's fee sheet row |
| `GET/PATCH /api/admin/users*`, `GET /api/admin/audit` | User management + audit trail (admin-only). `PATCH /api/admin/users/:id` takes `staff_id` |
| `GET/POST /api/staff`, `PATCH /api/staff/:id`, `PUT /api/staff/:id/roles`, `POST/DELETE /api/staff/:id/aliases`, `POST /api/staff/sync`, `GET /api/staff/unmatched` | Staff roster, P11.6 (admin, audited `staff.*`): everyone who works here with roles (attorney, paralegal, court paralegal, reception, billing, manager) and every spelling of their name; refresh = Monday users + names on the boards + legacy login links. users.db v15 (v17 `slack_user_id`, `npm run staff:import`). Rules = `apps/api/src/staff/roster.ts`; the ONE name matcher is `makeStaffResolver`. See `docs/features/staff-roster.md` |
| `GET/PATCH /api/staff/:id/offboarding`, `POST /api/staff/:id/offboarding/reassign` | Offboarding (admin): hand over open work (people column read live from Monday, co-assignees kept, queued on outage, mirror updated; seed data = mirror only), access off, manual steps, finish. users.db v16. Plan = `apps/api/src/staff/offboarding.ts` |
| `GET /api/admin/monday-usage` | Monday API usage (admin-only, Settings → Admin → P11.4.4): Monday's own report (`platform_api`: daily limit, per day / app / user; one call, cached 10 min, `?refresh=1`) + our per-job counts for 14 days. The limit (10,000/day) is account-wide — Zapier too — and resets at midnight UTC |
| `GET /api/admin/users/presence` | Who's online (admin-only): each active user as online (≤5 min) / idle (≤1 h) / offline, from `last_active_at`, which `requireAuth` stamps at most once a minute per user (`auth/presence.ts`). Shown in Settings → Users, polled every 30 s |
| `/api/auth/monday`, `/callback`, `/status` | Personal Monday.com OAuth connection (`routes/monday-oauth.ts`) |
| `POST /api/mail/scan`, `GET /api/mail/sample.pdf` | Mail intake: raw PDF body (`?name=`, `?sample=1`) → split notices matched to Open Forms, saved to `mail_scans`/`mail_documents` (schema v24) with the PDF under `data/mail/`; and a fake multi-notice sample built from the loaded DB. Image-only pages are OCR'd (`apps/api/src/mail/ocr.ts`, tesseract.js + vendored English model, ~1 s/page); `?scanned=1` gives an image-only sample. Nothing written to Monday at scan time |
| `GET /api/mail/documents/:id` (`/pdf` = just its pages), `GET /api/mail/open-forms?profile=`, `POST /api/mail/documents/:id/resolve` | Mail review (M15): notices flagged `needs_review` show in Alerts → "Mail to review" until assigned to an Open Form/client or dismissed with a note (audited). Sample scans drop out of Alerts after 24 h |
| `PATCH /api/mail/documents/:id/fields` | Correct what was read (M15): validates, re-matches, keeps the original reading (`original_fields`, schema v26); audited as `mail.fields_edited` with changed field names |
| `GET /api/mail/documents/:id/writeback-plan?openForm=`, `POST /api/mail/documents/:id/writeback` | Mail write-back: assigning to an Open Form writes Receipt No. (never overwrites a different one), Receipt Status → Received (receipt notices), and attaches the notice (Receipt Doc / USCIS Notice). Plan = `libs/query/src/mail-writeback.ts`, shown before Assign; executor = `apps/api/src/mail/writeback.ts`. Samples and seed rows are never written. Outage → remaining steps queued (`add_file` op reads the cut PDF from `data/mail/notice-<id>.pdf`); retry skips steps already done |
| `POST /api/jail-intakes/:localId/consult` | Book consult on a paid intake (M9): sets Consult Date + "Appt with:" only. Staff then press Create Appt in Monday, whose automations make the appointment + profile (the API can't press a button). Plan = `planIntakeConsult` in `routes/jail-intake-write.ts`; see `docs/decisions.md` 2026-09-30 |
| `GET /api/sms/config`, `POST /api/sms/send`, `PUT /api/settings/sms-templates`, `GET /api/profiles/:id/sms` | Text a client through RingCentral (M28, click-to-send — never automatic). Send refuses: `SMS_MODE=off`, a non-US number, an unfilled `{{placeholder}}`, the same text to the same number within 2 min (409). Logged in `sms_messages` (users.db v13) + audit `sms.sent` (last 4 digits only); a live send to a linked client also writes an E&A entry ("Text message" by name, else Casenote), queued on an outage. The text itself is never queued. Templates in `data/sms-templates.json` (PUT admin-only, audited). Plan = `sms/send-plan.ts`, client = `sms/ringcentral.ts` |
| `POST /api/contracts/:id/payment-links` + the LawPay receipts job | LawPay payments (no webhook — not available to us): M21 records every link it hands out (users.db `payment_links`, v14); every 2 min (`LAWPAY_SLACK=on`, preferred) `lawpay/slack-job.ts` reads the LawPay "Payment Bot" posts in Slack #payments with the app's bot — or every 10 min (`LAWPAY_MAIL=on`, fallback, needs Mail.Read admin consent) `scripts/lawpay-mail.ts` reads the LawPay receipt e-mails rafael@ forwards to importantdocuments@ (delegated Mail.Read, its own token) and `lawpay/mail-job.ts` applies each once (`lawpay_events`, keyed by e-mail id, never the card): matched by reference (the recorded link, else a Pending Fee K whose client's name is in it) → note + Monday bell to whoever sent the links + Slack; every fee paid → Contract Stage "Paid needs action" + moved to Paid Fee Ks (only from the payment-link stage). Unmatched → Slack "Payment to match". Parser = `lawpay/email.ts`, rules = `lawpay/events.ts`, apply = `routes/lawpay.ts`. See `docs/features/lawpay-payments.md` |
| `POST/GET /api/profiles/:localId/upload-links`, `PATCH/DELETE /api/upload-links/:id`, `GET /api/u/:token`, `POST /api/u/:token/files` | Client upload links (`CLIENT_UPLOADS=on`): staff create one private link per client (a new one revokes the old; token stored hashed in `upload_links`, schema v37), list what came in, extend, revoke (audited `upload_link.*`). The `/api/u/*` routes are public (the token is the key; one 404 for unknown / expired / revoked): first name + language for the client page, and one raw file per POST — type from its first bytes (PDF, JPEG, PNG, HEIC, TIFF, Word), 50 MB / file, 200 files / 1 GB per link, rate-limited, same file once — kept under `data/uploads/` in `client_uploads`. Filing: once a link has been quiet 10 min (and every 15 min, `CLIENT_UPLOADS_CRON`) the API runs `npm run uploads:file` → E-File (else Consult File) → `CAF` (created when missing), then one Monday update on the profile per batch (queued on outage) + Slack `client_upload`; stuck a day / 8 failed tries → Slack ops. Rules = `apps/api/src/uploads/rules.ts`, `filing.ts`; job = `uploads/job.ts`. The client page = `apps/web/upload.html` + `src/upload/` (its own Vite entry, es/en, camera, 2 uploads at a time with progress), served at `/u/<token>` by nginx / the Vite plugin. Staff: "Upload link" on the client header → M30 (`UploadLinkModal`: make / copy / Text it with the required `upload_link` SMS template, extend, turn off) and Documents → "Received from client" (`ClientUploadsList`). See `docs/features/client-uploads.md` |
| `POST /api/webhooks/monday/:token` | Monday.com webhook receiver (unauthenticated by design — secret URL token, constant-time compare). Persists events to the `webhook_events` inbox; a background processor applies them (deletions archived directly, notes re-fetched, column changes via targeted incremental sync). Every event is first copied into `item_events` (schema v35), the permanent item activity log (old → new value, who, when); the inbox itself is pruned after 30 days. History before 2026-08-10 comes from Monday's activity log (`npm run history:backfill`, `source = 'activity_log'`, v36). See `docs/webhooks.md` |

## Key Directories

| Path | Purpose |
|---|---|
| `config/` | `boards.yaml` (board & column definitions), `templates.yaml` (template variable mappings), `timeline.yaml` (which board dates are case-timeline milestones, P3.9) |
| `data/` | SQLite databases — `seed.db` (local dev, gitignored), `live.db` (real data, gitignored) |
| `templates/` | Handlebars `.txt` and DOCX template files used by the render pipeline; `templates/forms/` = official fillable PDFs (G-28) filled by `apps/api/src/documents/` |
| `output/` | Rendered document output (gitignored) |
| `docs/` | Architecture docs, board maps, decisions log, feature specs, nightly logs |
| `scripts/` | One-off and utility scripts (see below) |

## Utility Scripts (`scripts/`)

Run with `tsx scripts/<name>.ts`:

| Script | Description |
|---|---|
| `check-env.ts` | Validate `.env` (duplicate keys, placeholder values, token shape, localhost URLs in a production build, invalid cron). `npm run check:env`. Same code the API runs at startup — **run it on a server before deploying**, because from 2026-08-07 the API refuses to boot on a config error. `ENV_CHECK=warn` downgrades errors to warnings as an emergency override. Never prints values. |
| `health.ts` | One-shot health check (integrity, schema, sync state, counts, disk, backups). `npm run health`; exits non-zero on a hard failure. |
| `export-stats.ts` | Print DB statistics (row counts per table). `--db=live` uses `live.db`. |
| `snapshot.ts` | Fetch all 19 boards from Monday.com → `data/monday-snapshot.md` + `.json`. |
| `sample-real-data.ts` | Pull sample profile + linked item data from Monday.com → `data/samples/`. |
| `fetch-profile.ts` | Fetch a single profile by ID and dump it to stdout. |
| `mail-sample.ts` | Write the fake scanned-mail PDF (every page stamped SAMPLE) to `data/samples/sample-mail.pdf`. `npm run mail:sample` (`-- --db=live` builds it from live.db, `-- --scanned` makes it image-only for OCR). |
| `drive-intake.ts` | Client uploads in their Google Drive consult folder → the client's SharePoint `CONSULT` folder + an update with the files on the Monday appointment. `npm run drive:intake` is a dry run; `-- --apply` copies. Read-only on Drive, ledger in `drive_intake_files` (schema v30). Also links each upload folder to its appointment (`drive_folders`, schema v31) and fills the empty "Google Drive Folder" column; M18 shows it (`--links-since=` to backfill). Scheduled when `DRIVE_INTAKE=on`. See `docs/features/drive-intake.md`. |
| `mail-probe.ts` | What the mail reader makes of real PDFs, page by page (fields, split), with no DB. `npm run mail:probe -- scan.pdf [--text]`. Keep real scans out of the repo. |
| `sharepoint-links.ts` | Index every client folder in SCAL Consults / E-Files / Closed into `sp_folders` (schema v28), then propose a folder for each profile with an empty E-File / Consult File (case no. + surname, name + consult year, name). `npm run sharepoint:links -- --db=live` is read-only and writes a plan CSV to `output/`; `--apply` writes **high**-confidence links only (`--include-medium` adds medium, `--limit=N` for a trial), empty columns only, re-checked against Monday first, with a receipt CSV. Rules: `scripts/sharepoint/profile-links.ts`. See `docs/features/sharepoint-catalog.md`. |
| `tag-contract-template.ts` | Turn a contract draft's Word form fields ("Client Name", "AF", "multiply AF by .03"…) into `{{tags}}`, keeping formatting. One-off helper for existing drafts; new templates just get tags typed in. `npx tsx scripts/tag-contract-template.ts in.docx out.docx` |
| `client-uploads.ts` | Client upload links' files (`data/uploads/`) → the client's E-File → `CAF`. `npm run uploads:file` is a dry run (where each would go); `-- --apply` uploads and stamps `client_uploads` (filed / waiting / failed per file, a retry redoes only what failed; same name + size already in CAF = filed). `--quiet=N` minutes since the link's last file (default 10), `--db=seed` never writes. Run by the API when `CLIENT_UPLOADS=on`. See `docs/features/client-uploads.md` |
| `fee-k-autofill.ts` | What the Fee K auto-fill would write (POC Full Name from the Jail Intake, 3% card surcharges), empty columns only. `npm run feek:autofill -- --since=YYYY-MM-DD` is a dry run; `--apply` writes. Same code as the `FEE_K_AUTOFILL=on` schedule (`apps/api/src/fee-k-autofill.ts`). See `docs/features/fee-k-autofill.md`. |
| `history-backfill.ts` | Item history from before the webhooks: Monday's activity log per board (since each board was created) → `item_events` (`source = 'activity_log'`, schema v36), up to the board's first webhook-era event. Column changes, renames, new items, group moves, archive/delete/restore; no Call Log, no subscribe/owner noise. `npm run history:backfill` is a dry run (reads Monday, writes nothing); `-- --apply` stores (re-runs skip what's stored); `--boards=a,b`. See `docs/webhooks.md` |
| `staff-import.ts` | The firm's staff table (CSV: name, email, Monday user id, active/disabled, Slack member id, class, RC ext.) → the staff roster (users.db v17 `slack_user_id`). `npm run staff:import -- staff.csv` is a dry run; `--apply` writes (audited `staff.imported`); `-` reads stdin (server: `docker exec -i <api> npm run staff:import -- - < staff.csv`). Rules = `apps/api/src/staff/import.ts`. See `docs/features/staff-roster.md` |
| `setup-webhooks.ts` | Register/list/remove Monday.com webhooks for all tracked boards. `npm run webhooks:setup -- --url=https://<host>` (requires the API deployed with `MONDAY_WEBHOOK_SECRET` first). |
| `sync-config/` | Internal sync logic called by `npm run dev:cli -- sync`. |
| `preflight.sh` | Checks Node 22+, npm, and data directory writability. |
