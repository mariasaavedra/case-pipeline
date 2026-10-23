# Workflows screen (P11.7) — Phase 1

Status: **built** (branch `feat/workflows-screen`). Phase 2 (a When / If / Then rule builder) is out of scope here.

Code: `apps/api/src/workflows/` (`catalog.ts`, `runs.ts`, `report.ts`), `routes/workflows.ts`, `apps/web/src/components/WorkflowsSection.tsx`.

**Adding a background job:** add it to `WORKFLOWS` in `catalog.ts` and wrap its run in `trackRun(usersDb, "<key>", …)` (or `recordRun` when the job only says at the end whether it ran). Otherwise it shows as "No runs recorded yet".

## Goal

One admin page that lists every automation the app runs, in plain words, with:

- **On / Off** (and why it's off)
- **Schedule** in words ("every 15 min, 7 am–8 pm")
- **Last run**: when, OK or failed, a one-line summary ("3 filled, 0 failed")
- **Failures in the last 7 days**, with the last 5 error messages

Read-only. No buttons that change anything.

## What exists today (the inventory)

Scheduled in `apps/api/src/server.ts` (live data only):

| Key | Name on screen | Switch | Schedule (default) | Run history today |
|---|---|---|---|---|
| `sync_full` | Nightly full sync from Monday | `NIGHTLY_SYNC` | `0 1 * * *` | `sync_runs` ✅ |
| `sync_incremental` | Daytime sync from Monday | `NIGHTLY_SYNC` | `0 7-19/2 * * *` | `sync_runs` ✅ |
| `webhooks` | Live Monday changes (webhooks) | `MONDAY_WEBHOOK_SECRET` | every minute | `sync_runs` (mode `webhook`) ✅ |
| `write_queue` | Retry Monday writes after an outage | `MONDAY_API_TOKEN` | every minute | `write_queue` rows ✅ |
| `consult_sweep` | Consult folders + summaries | `CONSULT_FOLDERS` | `30 7-19/2 * * *` | logs only ❌ |
| `drive_intake` | Google Drive uploads → SharePoint | `DRIVE_INTAKE` | `*/15 7-20 * * *` | `drive_intake_files` (per file, not per run) ❌ |
| `client_uploads` | Client upload links → E-File CAF | `CLIENT_UPLOADS` | `*/15 * * * *` | `client_uploads` (per file) ❌ |
| `lawpay_slack` | LawPay payments from Slack #payments | `LAWPAY_SLACK` | `*/2 * * * *` | `lawpay_events` (per payment) ❌ |
| `lawpay_mail` | LawPay receipt e-mails | `LAWPAY_MAIL` | `*/10 * * * *` | same ❌ |
| `fee_k_autofill` | Fee K auto-fill | `FEE_K_AUTOFILL` | `*/15 7-20 * * *` | audit rows per write ❌ |
| `slack_queue` | Queued "consult ready" Slack posts | always | every minute | `slack_queue` rows ✅ |
| `backup` | Daily database backup | always | `30 5 * * *` | files on disk ❌ |
| `wal_checkpoint` | Database housekeeping | always | hourly | ❌ (hide by default) |

Event-driven (no schedule — show "runs when it happens", last event time):

- Adobe Sign events from Zapier (`ZAPIER_ESIGN_HOOK_URL` + `_SECRET`) — `esign_agreements`
- Slack notifications — the 10 business events in `notify/settings.ts`, per-event on/off already
- Post-consult process (P4 consult note → consult sweep for one appointment)

Outside the app (static cards, no status — we can't see them):

- Monday automations: Create Appt button, Appt? (see `docs/decisions.md` 2026-09-30)
- Zapier: the 3 Adobe Sign Zaps

## Design

### 1. Run ledger — `job_runs` (users.db, next migration)

```sql
CREATE TABLE job_runs (
  id INTEGER PRIMARY KEY,
  job TEXT NOT NULL,            -- catalog key
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,         -- running | ok | failed
  summary TEXT,                 -- "3 filled, 0 failed" — never client names
  error TEXT                    -- first 500 chars
);
CREATE INDEX job_runs_job ON job_runs (job, started_at DESC);
```

- Skipped ticks ("a sync is running") are **not** recorded — they'd be most rows.
- Pruned to 14 days by the same hourly cron as the WAL checkpoint. LawPay Slack at every 2 min ≈ 10k rows in 14 days; fine.
- On boot, `running` rows older than an hour → `failed` ("interrupted by a restart"), like `slack_queue`'s `recoverInterrupted`.
- Sync, webhooks, write queue, slack queue already have their own history: the page reads those tables, no double-writing.

### 2. Recorder — `apps/api/src/workflows/runs.ts`

`trackRun(usersDb, job, fn)` → inserts `running`, awaits `fn`, stores `ok` + the summary it returns, or `failed` + the error, then rethrows so the existing `notifyOps` handling is unchanged. Each `schedule*` in `server.ts` and `uploads/job.ts` wraps its run body in it (spawned scripts: exit code 0 = ok).

### 3. Catalog — `apps/api/src/workflows/catalog.ts`

Static list, one entry per row above: `key`, `name`, `when` / `then` sentences, `group` (Monday data · Payments · Client files · Messages · Maintenance), `schedule` (cron + words), `enabled(env)` → `{ on, reason }`, `opsKey` (links to the Slack ops event), `doc` (path under `docs/`). Off reasons name the switch, never a value ("Off — FEE_K_AUTOFILL isn't on").

### 4. Route — `GET /api/workflows` (admin)

Catalog + for each: on/off, last run, failures in 7 days, last 5 errors. Seed data → every scheduled job shows "Only runs on live data".

### 5. Page — Settings → **Workflows** (P11.7, admin-only)

New entry in `TABS` in `apps/web/src/pages/SettingsPage.tsx`. Cards grouped by `group`; each card: name, "When … → …", status pill (On / Off / Not set up), "Last run 4 min ago · OK · 3 filled", "2 failures this week ▸" (expands to the errors), link to the doc. Polls every 60 s while open. Outside-the-app cards at the bottom, greyed, "Managed in Monday / Zapier".

## As built — differences from the plan

- The sync records its full and incremental runs in `job_runs` too (`sync_full`, `sync_incremental`) instead of reading `sync_runs`: webhook refreshes write `sync_runs` rows as `incremental`, so that table can't tell them apart. Webhooks show from `webhook_events`.
- The WAL checkpoint and the Monday-usage flush aren't listed (housekeeping nobody acts on). The hourly checkpoint cron prunes `job_runs`.
- Doc links show the path (the docs aren't served).

## Build order and estimate (~2½ days)

1. `job_runs` migration + `trackRun` + tests — ½ day
2. Catalog + `enabled()` checks + tests — ½ day
3. Wrap the 8 untracked schedules — ½ day
4. `GET /api/workflows` + test — ¼ day
5. Settings → Workflows tab — ¾ day
6. CLAUDE.md rows (route, users.db version), this doc → "built" — ¼ day

## Out of scope

Turning workflows on/off from the page (env flags need a redeploy; changing that is its own decision), "Run now" buttons, Phase 2 rules.
