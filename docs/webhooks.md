# Monday.com Webhooks — near-real-time mirror refresh

Added 2026-08-06. Before this, the local mirror (`data/live.db`) only got fresher
on the scheduled syncs: incremental every 2 hours during the workday, full at
01:00. Webhooks close that gap: when someone changes a status, creates an item,
posts a note, or deletes an item in Monday, the mirror reflects it within about
a minute — and deletions no longer wait for the nightly `--full` sweep.

The scheduled syncs **stay on**. Webhooks are best-effort delivery (Monday can
drop or delay them); the nightly full sweep remains the authoritative
reconciliation pass, and Emails & Activities still only arrive via the full
sweep (Monday has no webhook for E&A timeline changes).

## Architecture

```
Monday.com ──POST──▶ /api/webhooks/monday/<secret>     (receiver: validate + INSERT, answer 200)
                              │
                              ▼
                      webhook_events table              (durable inbox, schema v22)
                              │        drained every minute by the API (live mode)
                              ▼
              ┌───────────────┼──────────────────────┐
              ▼               ▼                      ▼
        deletions          notes               everything else
   item_deleted/archived   create/edit_update  (column changes, new items,
        │                     │                 renames, restores)
        ▼                     ▼                      ▼
   archive row into      re-fetch that item's   mark board dirty → ONE targeted
   archived_rows +       updates, upsert into   incremental sync for all dirty
   delete (recoverable   client_updates (edits  boards:
   from Admin → Sync     update the stored        sync:live --skip-timeline
   Health)               body)                              --boards=k1,k2
```

Design choices, and why:

- **The receiver does almost nothing.** Monday retries slow/failing endpoints,
  so the endpoint only authenticates, echoes the registration challenge, and
  INSERTs the event. All real work happens in the background processor.
- **Board refreshes reuse the sync pipeline.** Instead of re-implementing
  per-table writes, a column-change event just marks its board dirty and the
  processor spawns the existing `sync:live` with `--boards=…`. The incremental
  watermark means only changed items are fetched — a one-board refresh takes
  seconds, and all of the sync's safety rails (upsert, coverage gates, mapper)
  apply unchanged. A burst of events collapses into a single sync per drain.
- **Deletions are handled directly.** The event names the exact
  `monday_item_id`, so the processor archives the row into `archived_rows`
  (same shape as sync reconciliation, `run_id` NULL = webhook-initiated) and
  deletes it. Restorable from Admin → Sync Health like any archived row.
- **Direct writes take the sync advisory lock** (same discipline as the
  write-queue) so they never interleave with a full sync mid-run. The spawned
  targeted sync acquires the lock itself, and rides the API's `runSync` guard,
  so it can never overlap the 01:00 full or a 2-hourly incremental.

## Setup

Everything is driven by two env vars and one script.

**1. Generate the shared secret** and add it to the **server's** `.env`:

```bash
openssl rand -hex 32
```

```
MONDAY_WEBHOOK_SECRET=<the generated hex>
```

Monday does not sign API-created webhooks, so the secret lives in the callback
URL path and the receiver compares it in constant time. Treat it like a
password: anyone who has it can inject fake events (they'd still only trigger
re-fetches from Monday, never direct data writes — but don't share it).

**2. Redeploy the API** so the receiver is live at
`https://<host>/api/webhooks/monday/<secret>`. On boot you should see:

```
[webhooks] processor scheduled (* * * * *).
```

(If you see `[webhooks] receiver disabled` instead, the env var isn't set.)

**3. Register the webhooks** — from any machine with the repo, `.env` holding
`MONDAY_API_TOKEN` + the same `MONDAY_WEBHOOK_SECRET`:

```bash
npm run webhooks:setup -- --url=https://<public-host> --dry-run
```

```bash
npm run webhooks:setup -- --url=https://<public-host>
```

This walks every board in `config/boards.yaml` plus active attorney boards
(`data/attorney-boards.json`) and creates one webhook per (board, event) for
the default event set:

| Event | What it keeps fresh |
|---|---|
| `change_column_value` | any column edit — statuses, dates, people, numbers |
| `create_item` | new items |
| `change_name` | item renames |
| `item_deleted` / `item_archived` | removals (archived locally, recoverable) |
| `item_restored` | un-archives (board refresh re-imports the item) |
| `create_update` / `edit_update` | notes and note edits |

Monday **validates the URL at creation time** (it POSTs a `challenge` and the
receiver must echo it), so step 2 must be done before step 3, and the URL must
be public HTTPS — Monday cannot reach localhost. Registration is idempotent: a
(board, event) pair that already has a webhook is skipped, so re-running after
adding a board to `boards.yaml` (or a new attorney board in Settings) only
creates what's missing.

Other script modes:

```bash
npm run webhooks:setup -- --list
```

```bash
npm run webhooks:setup -- --remove --dry-run
```

```bash
npm run webhooks:setup -- --url=https://<host> --boards=profiles,fee_ks
```

```bash
npm run webhooks:setup -- --url=https://<host> --events=create_update,edit_update
```

**Caveat:** Monday's `webhooks` query does not return the callback URL, so the
script identifies "our" webhooks by event type. If another integration also
uses webhooks on these boards, scope with `--boards`/`--events`, especially for
`--remove`.

## Event lifecycle & statuses

Every delivery lands in `webhook_events` and moves through:

| Status | Meaning |
|---|---|
| `pending` | Received, not yet drained (or waiting out a retry backoff). |
| `processed` | Applied: row archived, notes upserted, or its board's targeted sync completed. |
| `skipped` | Nothing to do: untracked board, `delete_update` (notes deletions reconcile on the nightly full), or an event with no usable ids. |
| `failed` | 5 attempts exhausted (backoff 1m → 2m → 4m … capped 30m); `last_error` says why. |

A drain that wants to run a board refresh while another sync is in flight
defers — events stay `pending` untouched and retry next minute (that's not
counted as a failure). Processed/skipped rows are pruned after 30 days.

## Operations

Useful queries (run against `data/live.db`):

```bash
sqlite3 data/live.db "SELECT status, COUNT(*) FROM webhook_events GROUP BY status"
```

```bash
sqlite3 data/live.db "SELECT id, event_type, monday_board_id, monday_item_id, attempts, last_error FROM webhook_events WHERE status IN ('pending','failed') ORDER BY id DESC LIMIT 20"
```

Rows archived by a webhook deletion have `run_id IS NULL` in `archived_rows`
and show up in Admin → Sync Health like any reconciled row; restore works the
same way.

### Troubleshooting

- **Registration fails with a challenge/URL error** — the API isn't reachable
  at that URL, or its `MONDAY_WEBHOOK_SECRET` differs from the one in the
  environment running the script. Check `curl -s -X POST https://<host>/api/webhooks/monday/<secret> -H 'Content-Type: application/json' -d '{"challenge":"x"}'`
  — it must echo `{"challenge":"x"}`.
- **Events pile up `pending`** — the processor only runs with `DB_SOURCE=live`
  and `MONDAY_API_TOKEN` set; check the API logs for `[webhooks] drained:` lines.
  A long full sync also defers board refreshes until it finishes.
- **Events land `skipped` with "board … not in boards.yaml"** — the board isn't
  tracked. Either add it to `config/boards.yaml` (then re-run the setup script)
  or remove its webhooks (`--remove --boards=…` after adding a temporary entry,
  or delete them in Monday's UI: board → Integrations → Board Power-Ups).
- **Rotating the secret** — set the new value in `.env`, redeploy, run
  `npm run webhooks:setup -- --remove`, then re-register with the new secret in
  the environment. (Old webhooks keep POSTing the old URL and get 401s until
  removed.)

## Known limitations

- **E&A timelines** (emails, calls, consult notes) have no webhook — only the
  nightly full sync pulls them. Same for **note deletions** (`delete_update` is
  received but skipped; the nightly full reconciles).
- Webhook delivery is **best-effort**. A missed delivery self-heals at the next
  scheduled incremental (columns) or full (everything) sync — webhooks reduce
  latency, they are not the source of truth.
- `change_column_value` fires per column per item; a big bulk edit in Monday
  produces many events. That's fine — the drain collapses them into one
  targeted sync — but expect bursts in `webhook_events` after mass updates.
