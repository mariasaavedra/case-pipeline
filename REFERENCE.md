# case-pipeline — Onboarding Checklist

This checklist onboards an engineer into the **concepts, architecture, and intent** behind `case-pipeline` — a config-driven automation platform for a Monday.com-based immigration law workspace.

Completion means the person understands what the repo does, why it exists, and how to extend it safely.

---

## Phase 1 — Runtime & Project Setup

**Goal:** Get the project running locally without Monday.com API access.

### Read
- Node.js 22 release notes — https://nodejs.org/en/blog/release/v22.0.0
- npm workspaces — https://docs.npmjs.com/cli/v10/using-npm/workspaces
- tsx (TypeScript execute) — https://tsx.is/

### Do
- [ ] Install Node.js 22+ and npm 10+
- [ ] Run `npm install` at the repo root
- [ ] Run `npm run seed` to generate local test data
- [ ] Run `npm run dev:api` and `npm run dev:web` together and open the dashboard
- [ ] Confirm client data appears without a Monday.com API token

### Should Understand
- Why a monorepo with `apps/` and `libs/` is better than a single script
- What `tsx` does (runs TypeScript directly without a separate compile step)
- Why seed-first development matters for a live-data system

---

## Phase 2 — Environment-Based Configuration

**Goal:** Understand why configuration is externalized via `.env` and YAML.

### Read
- The Twelve-Factor App: Config — https://12factor.net/config

### Do
- [ ] Copy `.env.example` → `.env`
- [ ] Identify which env vars are required vs optional
- [ ] Open `config/boards.yaml` and trace a column definition end-to-end into the query layer

### Should Understand
- Why secrets never live in code
- Why board structure lives in YAML (`config/boards.yaml`) rather than TypeScript
- The difference between `by_type`, `by_title`, and `by_id` column resolution strategies

---

## Phase 3 — APIs & Connectors (Monday.com)

**Goal:** Understand how the Monday.com connector works under the hood.

### Read
- Monday API authentication — https://developer.monday.com/api-reference/docs/authentication
- Monday GraphQL intro — https://developer.monday.com/api-reference/docs/introduction-to-graphql
- GraphQL basics — https://graphql.org/learn/queries/

### Do
- [ ] Inspect the GraphQL client in `libs/monday/src/`
- [ ] Add one additional column to a board definition in `config/boards.yaml`
- [ ] Run `npm run dev:cli -- sync --dry-run` and observe what changes would be applied
- [ ] Add explicit error handling for a missing column

### Should Understand
- GraphQL vs REST
- API tokens and scopes
- What a "connector" is responsible for vs what the ETL layer does

---

## Phase 4 — Data Mapping & Transformation (ETL)

**Goal:** Understand explicit mapping and why it is intentional.

### Read
- ETL fundamentals — https://www.ibm.com/topics/etl

### Do
- [ ] Trace data from `libs/monday` → `libs/query` → `apps/api` → `apps/web`
- [ ] Modify a column mapping in `config/boards.yaml` and observe the effect in the dashboard
- [ ] Add a derived field in the query layer (`libs/query/src/`)
- [ ] Add a default value for a missing column

### Should Understand
- Schema mismatch between Monday.com's flexible columns and a typed SQLite schema
- Why implicit mappings fail at scale
- Why queries run against local SQLite instead of the live API

---

## Phase 5 — Templating & Document Generation

**Goal:** Understand logic-light, versioned document generation.

### Read
- Handlebars guide — https://handlebarsjs.com/guide/
- docxtemplater — https://docxtemplater.com/docs/

### Do
- [ ] Run `npm run dev:cli -- render` and generate a document interactively
- [ ] Open `config/templates.yaml` and trace a variable mapping into `libs/template/src/`
- [ ] Add a conditional section to a Handlebars template in `templates/`
- [ ] Add a new template variable and wire it end-to-end

### Should Understand
- Separation of logic and presentation
- Why templates belong in source control
- How `config/templates.yaml` drives variable resolution without hardcoding

---

## Phase 6 — CLI & Tooling

**Goal:** Understand the CLI as the primary operator interface.

### Do
- [ ] Run each CLI command with `--help`: `render`, `seed`, `sync`, `analyze`, `lookup`
- [ ] Run `npm run dev:cli -- lookup <name>` to pull a 360 case summary
- [ ] Run `npm run dev:cli -- analyze --tracked-only -o=docs/boards.md` and open the output
- [ ] Run `npm run dev:cli -- sync --discover` and review the board list

### Should Understand
- Why the CLI exists alongside the dashboard (operator automation vs human browsing)
- How `apps/cli` delegates to `libs/` without duplicating logic

---

## Phase 7 — Operational Thinking

**Goal:** Think like an automation platform owner, not a script author.

### Read
- Choose boring technology — https://boringtechnology.club/
- Alerting and failure modes — https://www.honeycomb.io/blog/stop-alerting-on-call/

### Do
- [ ] Identify all failure points in the sync → query → render pipeline
- [ ] Decide which failures should page a human
- [ ] Add structured logs for each major step in a command
- [ ] Propose where run history should live

### Should Understand
- Fail-fast systems
- Auditability and observability
- Automation as infrastructure

---

## Completion Criteria

Someone who completes this checklist should be able to:

- Explain exactly what this repo does and why it exists
- Add a new board definition to `config/boards.yaml` without touching TypeScript
- Add a new template variable end-to-end
- Extend the CLI with a new command
- Design the next workflow step on top of this platform
