# Live Data Sync Engine

**Status:** Working — validated end-to-end against real Monday.com data  
**Last updated:** 2026-06-20  
**Priority:** 🔴 Foundation — prerequisite for all other features to work with real data

## Validated live run (2026-06-20)

First full sync against production: **2892 profiles · 1399 contracts** (13 without
a resolvable profile) **· 7007 board items** across 17 boards. The API serves it
with `DB_SOURCE=live` (dashboard KPIs, client 360, contracts/board-items joins
all resolve). Two bugs found and fixed during this run:

1. **Bulk fetch dropped relations** — `fetchBoardItems` in `libs/monday/src/api.ts`
   was missing the `BoardRelationValue` fragment, so `linked_item_ids` never came
   back and *every* profile link resolved to null. Added the fragment; profile
   resolution is now 79–99% per board.
2. **`contracts.case_type`** — `contract_for` is a dropdown (`{labels:[...]}`),
   not text; the sync now reads `.labels`.

Sync hardening also added: per-board error isolation (one bad board no longer
aborts the run), orphan-contract handling (`profile_local_id` NOT NULL → `""`),
and non-destructive partial runs (`--boards` preserves other boards; only a full
run does a full replace).

**Domain notes:** `_fa_jail_intakes` (0% profile link) and `calendaring` (82%)
link to cases/are standalone rather than to profiles directly — expected, not a bug.

## Progress (2026-06-20)

- ✅ **`DB_SOURCE` env switch** — `apps/api/src/server.ts` resolves `seed`/`live`,
  validates the value, and fails fast with an actionable message if the DB is
  missing. Documented in `.env.example`. (`data/` is already gitignored.)
- ✅ **Column mapper** — `scripts/sync/mapper.ts` reshapes Monday column values
  into the exact JSON the query layer reads (`$.status.label`, `$.<key>.date`,
  `$.type.labels`, etc.), plus first-class field extraction and profile-relation
  resolution. Unit-tested offline in `scripts/sync/mapper.test.ts` (14 tests).
- ✅ **Sync orchestrator** — `scripts/sync/index.ts` (`npm run sync:live`):
  full-replace into `data/live.db`, two-pass profile linking, reuses the
  Monday client's pagination/retry/rate-limit handling.
- ⏳ **Needs a live run with `MONDAY_API_TOKEN`** to validate per-board specifics
  (esp. the `fee_ks` → contracts field mapping and profile relation keys) against
  real board structures. Cannot be verified end-to-end without the token.
- ⬜ Client updates (Monday item updates → `client_updates`) and cross-board
  `item_relationships` population are not yet wired (board_items profile link is).

---

## Goal

Build the sync engine that pulls live Monday.com board data into a local `data/live.db` SQLite database, and wire an env switch (`DB_SOURCE=seed|live`) so the app can run against either fake or real data without code changes.

---

## Why This First

Every other planned feature is currently running on Faker.js seed data. Nothing is validated against real cases, real column values, or real edge cases until this exists. Building auth, the active cases board, or reporting on top of fake data means discovering real-data surprises at the worst possible time.

---

## Approach

Two databases, one switch:
- `data/seed.db` — Faker.js data, default, safe to regenerate, used by CI
- `data/live.db` — real Monday.com data, gitignored, never leaves the developer's machine
- `DB_SOURCE=seed|live` env var selects which DB the API reads from
- Same schema, same query layer, same UI — just different data underneath

---

## What Needs to Be Built

1. **`DB_SOURCE` env switch** — `apps/api/src/server.ts` currently hardcodes `data/seed.db`. Read `DB_SOURCE` env var and resolve path to the correct database.

2. **Sync script** — `scripts/sync-live.ts` (or extend existing `apps/cli/src/commands/sync.ts`):
   - Iterates all boards in `config/boards.yaml`
   - Fetches items via `libs/monday/src/api.ts`
   - Maps `MondayItem` column values → SQLite row fields using `libs/monday/src/column-resolver.ts`
   - Upserts into `live.db` (create if not exists, using same schema as `seed.db`)
   - Handles rate limits, retries, pagination

3. **Gitignore** — add `data/live.db`, `data/live.db-wal`, `data/live.db-shm`

4. **`.env.example` update** — document `DB_SOURCE` and `MONDAY_API_TOKEN`

---

## Existing Building Blocks

All of these are already in the codebase and working:

| Building block | Location |
|---|---|
| Monday.com API client (retry, rate-limit) | `libs/monday/src/api.ts` |
| Column resolver (`by_type`, `by_title`, `by_id`) | `libs/monday/src/column-resolver.ts` |
| All 19 board IDs + column mappings | `config/boards.yaml` |
| Real data samples (already fetched) | `data/samples/*.json` |
| Snapshot script (reference for fetching all boards) | `scripts/snapshot.ts` |
| Schema + migration system | `libs/seed/src/db/schema.ts` |

---

## Open Questions

- Should sync be incremental (only changed items since last run) or full replace? Incremental is faster but more complex. Start with full replace, optimize later.
- How often should sync run? Manual trigger via CLI for now; scheduled sync (cron) is a later phase.
- What happens to `live.db` schema when `seed.db` schema gets a new migration? Sync script should run migrations on `live.db` before syncing data.
