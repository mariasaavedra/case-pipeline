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

Full list, with what each switch turns on: [`docs/reference/env-vars.md`](docs/reference/env-vars.md) (and `.env.example`). Live data needs `MONDAY_API_TOKEN`; `npm run seed` needs nothing. Feature switches (`*_MODE`, `X=on`) are off unless set. `npm run check:env` validates `.env` the same way the API does at startup.

tsx/Node loads `.env` automatically via `--env-file` flag in the sync command. For other scripts, ensure `.env` is present at the repo root.

### Key Design Patterns

- **Config-over-code:** Board structure is declared in YAML; column resolution supports `by_type`, `by_title`, and `by_id` strategies with fallbacks.
- **ETL pattern:** Monday.com data is explicitly mapped into SQLite schemas; queries run locally against SQLite, not the live API.
- **Seed-first development:** `npm run seed` generates realistic local data via Faker.js so the full app can run without Monday.com API calls.
- **Template-driven documents:** Handlebars templates in `templates/` are logic-light; all data preparation happens in `libs/template` before rendering.
- **Batch query pattern:** Multi-profile queries (e.g. appointments) use batch preload via `IN (...)` + `GROUP BY`, not per-row sub-queries. See `libs/query/src/appointments.ts`.
- **Write-back token policy:** Writes go out under the acting user's personal Monday OAuth token (for attribution), falling back to the shared `MONDAY_API_TOKEN` **only** when Monday refuses theirs on permission grounds — a rate limit or outage still throws so the write queue retries it. See `apps/api/src/write-auth.ts`. Adding a scope to `buildOAuthUrl` silently breaks every existing connection (Monday never widens an issued token), so a scope change must ship with the reconnect prompt. See `docs/decisions.md`, 2026-08-07.

## Staff manual (P22) — update it with every merge

The in-app manual (`/manual`, sidebar → **Manual**, top bar **? Help**) is the staff's reference. Its chapters are Markdown in `apps/web/src/manual/chapters/` (format: `apps/web/src/manual/README.md`).

**Every PR that changes what staff see or do updates the manual in the same PR**, before it is merged:

- Edit the chapter whose `routes:` covers the changed page (new steps, renamed buttons, removed features), and bump its `updated:` date. Button names exactly as on screen, in **bold**; plain language, no file paths or API names.
- A new page → a new chapter with `routes:` set (`manual.test.ts` fails typecheck until the page is listed in `NEEDS_CHAPTER`).
- A user-visible change also gets an entry at the top of `apps/web/src/changelog.ts` (it feeds the manual's "What's new").
- Nothing staff would notice (refactor, tests, infra) → write `Manual: n/a — <why>` in the PR description.

CI's `manual` job fails a PR that changes `apps/web/src/components|pages/*.tsx` or `apps/api/src/routes/` without touching the manual or the changelog, unless the description says `Manual: n/a`.

## Reference — read the file when the task touches it

| What | Where |
|---|---|
| Every API route, what it reads/writes, its plan file | [`docs/reference/api-routes.md`](docs/reference/api-routes.md) |
| `libs/query` modules (one per page/feature) and its public subpaths | [`docs/reference/query-layer.md`](docs/reference/query-layer.md) |
| Utility scripts (`npm run …`), dry-run vs `--apply` | [`docs/reference/scripts.md`](docs/reference/scripts.md) |
| CLI commands (`render`, `seed`, `lookup`, `sync`, `analyze`) | [`docs/reference/cli.md`](docs/reference/cli.md) |
| Environment variables | [`docs/reference/env-vars.md`](docs/reference/env-vars.md) |
| A feature's design and rules | `docs/features/<feature>.md` |
| Why something is the way it is | `docs/decisions.md` (dated entries) |

Adding a route, query module, script or env var → add its row to the matching reference file in the same PR.

Rules that run through those tables:

- **Auth:** every `/api/*` route requires an Azure AD bearer token (`requireAuth`); admin routes also `requireAdmin`. `/health` and the secret-URL / token routes (`/api/webhooks/*`, `/api/u/:token`, `/api/esign/files/*`) are the only unauthenticated ones.
- **Monday writes:** send `from` (the value the page loaded) and return 409 if Monday changed since; update the local copy optimistically; on an outage, queue in `write_queue` instead of failing. Real status labels only (`status-options.ts`).
- **Seed and sample data never write to Monday** or text anyone.
- **Background jobs:** a new one = an entry in `apps/api/src/workflows/catalog.ts` + `trackRun` with the same key (Settings → Workflows).
- **Scripts that write:** dry run by default, `--apply` to write, empty columns only, re-read from Monday before writing.

## Key Directories

| Path | Purpose |
|---|---|
| `config/` | `boards.yaml` (board & column definitions), `templates.yaml` (template variable mappings), `timeline.yaml` (which board dates are case-timeline milestones, P3.9) |
| `data/` | SQLite databases — `seed.db` (local dev, gitignored), `live.db` (real data, gitignored) |
| `apps/web/src/manual/` | P22 staff manual: one Markdown chapter per page in `chapters/`, loaded by `manual.ts`. Keep it current with every merge (see Staff manual above) |
| `templates/` | Handlebars `.txt` and DOCX template files used by the render pipeline; `templates/forms/` = official fillable PDFs (G-28) filled by `apps/api/src/documents/` |
| `output/` | Rendered document output (gitignored) |
| `docs/` | Architecture docs, board maps, decisions log (`decisions.md`), feature specs (`features/`), nightly logs |
| `docs/reference/` | The lookup tables: env vars, API routes, query modules, CLI, scripts |
| `scripts/` | One-off and utility scripts (`docs/reference/scripts.md`) |
