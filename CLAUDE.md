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
- `libs/query` — Typed SQLite query layer (exports subpaths: `./types`, `./appointments`, `./client`, `./relationships`)
- `libs/template` — Document generation via Handlebars + docxtemplater (DOCX output)
- `libs/relationship-map` — Board relationship analysis
- `libs/seed` — Faker.js-based local test data generator

TypeScript path aliases (defined in `tsconfig.base.json`) map `@case-pipeline/*` to the corresponding lib.

### Data Flow

Monday.com boards → `libs/monday` (GraphQL) → SQLite (`libs/query`) → REST API (`apps/api`) → React dashboard (`apps/web`)

Document generation: Monday.com item → `libs/template` (Handlebars context) → DOCX via `templates/`

### Configuration

Board definitions live in `config/boards.yaml` — board IDs, column mappings, and inter-board relationships are YAML, not hardcoded. The `libs/config` package loads this at runtime.

Required environment variables (see `.env.example`):
- `MONDAY_API_TOKEN` — required for live data
- `ITEM_ID` — required for the main document render pipeline

### Key Design Patterns

- **Config-over-code:** Board structure is declared in YAML; column resolution supports `by_type`, `by_title`, and `by_id` strategies with fallbacks.
- **ETL pattern:** Monday.com data is explicitly mapped into SQLite schemas; queries run locally against SQLite, not the live API.
- **Seed-first development:** `npm run seed` generates realistic local data via Faker.js so the full app can run without Monday.com API calls.
- **Template-driven documents:** Handlebars templates in `templates/` are logic-light; all data preparation happens in `libs/template` before rendering.
