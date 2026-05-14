# AGENTS.md

This file provides guidance to AI coding assistants (Claude Code, Codex, etc.) when working with code in this repository.

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
npm run lint           # Lint all workspaces

# Other
npm run preflight      # Pre-flight environment checks
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

Board definitions live in `config/boards.yaml` — board IDs, column mappings, and inter-board relationships are YAML, not hardcoded. The `libs/config` package loads this at runtime. `config/templates.yaml` maps Monday.com data to template variables.

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

tsx/Node loads `.env` automatically via `--env-file` flag in the sync command. For other scripts, ensure `.env` is present at the repo root.

### Key Design Patterns

- **Config-over-code:** Board structure is declared in YAML; column resolution supports `by_type`, `by_title`, and `by_id` strategies with fallbacks.
- **ETL pattern:** Monday.com data is explicitly mapped into SQLite schemas; queries run locally against SQLite, not the live API.
- **Seed-first development:** `npm run seed` generates realistic local data via Faker.js so the full app can run without Monday.com API calls.
- **Template-driven documents:** Handlebars templates in `templates/` are logic-light; all data preparation happens in `libs/template` before rendering.
- **Batch query pattern:** Multi-profile queries (e.g. appointments) use batch preload via `IN (...)` + `GROUP BY`, not per-row sub-queries. See `libs/query/src/appointments.ts`.

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
| `alerts.ts` | Overdue deadlines, stale cases, idle contracts |
| `board-items.ts` | Per-profile board item queries + `batchGetClientBoardItems` |
| `case-summary.ts` | Full 360° client summary + `batchGetClientCaseSummaries` |
| `contracts.ts` | Contract queries + `batchGetClientContracts` |
| `dashboard.ts` | KPI card queries (6 cards, 7-day windows) |
| `search.ts` | Cross-type search (contracts, court cases, etc.) |
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

All routes are read-only GET endpoints served from `http://localhost:3000`:

| Route | Description |
|---|---|
| `GET /api/dashboard` | 6 KPI cards (open forms, pending contracts, paid fee Ks, deadlines, hearings, alerts) |
| `GET /api/appointments` | Daily appointments with enriched profiles, snapshots, updates, case summaries |
| `GET /api/alerts` | Grouped alerts by severity (critical / warning / info) |
| `GET /api/search` | Cross-type search: profiles, contracts, court cases, etc. |
| `GET /api/filter-options` | Distinct values for filter dropdowns (priorities, statuses, attorneys, board types) |
| `GET /api/clients` | Filtered + paginated profile listing |
| `GET /api/clients/search` | Legacy profile-only search |
| `GET /api/clients/:id` | Full 360° case summary for one client |
| `GET /api/clients/:id/contracts` | Contracts for one client |
| `GET /api/clients/:id/board-items` | Board items grouped by board key |
| `GET /api/clients/:id/updates` | Timeline updates for one client |
| `GET /api/clients/:id/relationships` | Item relationships for one client |
| `GET /api/board-items/:id` | Single board item detail |

## Key Directories

| Path | Purpose |
|---|---|
| `config/` | `boards.yaml` (board & column definitions), `templates.yaml` (template variable mappings) |
| `data/` | SQLite databases — `seed.db` (local dev, gitignored), `live.db` (real data, gitignored) |
| `templates/` | Handlebars `.txt` and DOCX template files used by the render pipeline |
| `output/` | Rendered document output (gitignored) |
| `docs/` | Architecture docs, board maps, decisions log, feature specs, nightly logs |
| `scripts/` | One-off and utility scripts (see below) |

## Utility Scripts (`scripts/`)

Run with `tsx scripts/<name>.ts`:

| Script | Description |
|---|---|
| `export-stats.ts` | Print DB statistics (row counts per table). `--db=live` uses `live.db`. |
| `snapshot.ts` | Fetch all 19 boards from Monday.com → `data/monday-snapshot.md` + `.json`. |
| `sample-real-data.ts` | Pull sample profile + linked item data from Monday.com → `data/samples/`. |
| `fetch-profile.ts` | Fetch a single profile by ID and dump it to stdout. |
| `sync-config/` | Internal sync logic called by `npm run dev:cli -- sync`. |
| `preflight.sh` | Checks Node 22+, npm, and data directory writability. |
