# Case Pipeline

A config-driven analysis and document generation platform for Monday.com, connected to a production immigration law workspace with 18 tracked boards.

---

## Features

- **Landing Dashboard** - Firm-wide KPI cards at a glance: open forms, pending contracts, paid Fee Ks, upcoming deadlines, and upcoming hearings — with counts and top-5 item lists
- **Client Dashboard** - Web-based 360-degree view of any client: profile, contracts, active cases, pending items, appointments, and full updates/notes timeline
- **Updates Timeline** - Centralized feed of all Monday.com updates, replies, and automation emails across every board — grouped by date with threaded replies
- **Query Layer** - Typed functions for client search (FTS5), contracts, board items, updates, and full case summaries
- **JSON API** - RESTful endpoints served by Express for the dashboard and future integrations
- **Document Generation** - Create documents from Monday.com data using Handlebars templates with interactive profile selection
- **Test Data Seeding** - Generate realistic test data locally with Faker.js and SQLite (no Monday.com sync)
- **Configuration Sync** - Keep board configurations in sync with Monday.com using YAML-based definitions
- **Relationship Analysis** - Visualize board connections, mirror columns, and data flow with phantom board filtering

---

## Quick Start

### Prerequisites

- Node.js 22+
- npm 10+
- Monday.com API token

### Installation

```bash
npm install
```

### Configuration

Create a `.env` file with your Monday.com credentials:

```env
MONDAY_API_TOKEN=your_api_token_here
```

Board configurations are defined in `config/boards.yaml`.

---

## Development

```bash
npm run dev:api    # Start API server (localhost:3000)
npm run dev:web    # Start web dashboard (localhost:5173)
npm run dev:cli    # Run CLI via tsx
```

Both `dev:api` and `dev:web` must be running together — the web app proxies `/api` to port 3000.

### Tests & Type Checking

```bash
npm run preflight   # Pre-flight environment checks
npm run test        # Run all tests
npm run typecheck   # Type-check all workspaces
npm run lint        # Lint all workspaces
```

---

## CLI Usage

```bash
npm run dev:cli -- <command> [options]
```

| Command | Description |
|---------|-------------|
| `render` | Generate documents from Monday.com items |
| `seed` | Generate realistic test data locally (SQLite) |
| `lookup` | Search clients and view 360 case summary |
| `sync` | Synchronize board configuration with Monday.com |
| `analyze` | Analyze board relationships and generate maps |

### Examples

```bash
# Interactive document generation - browse and select a profile
npm run dev:cli -- render

# Render a specific item
npm run dev:cli -- render --item=123456789

# Generate 10 test profiles with 2-3 contracts each
npm run dev:cli -- seed --profiles=10 --contracts=2-3

# Search for a client by name
npm run dev:cli -- lookup Garcia

# View full 360 case summary by ID
npm run dev:cli -- lookup --id=<local_id>

# Sync board configuration
npm run dev:cli -- sync

# Discover all boards in workspace
npm run dev:cli -- sync --discover

# Generate relationship map as markdown
npm run dev:cli -- analyze -o=docs/boards.md

# Generate map showing only tracked board connections
npm run dev:cli -- analyze --tracked-only --main-board=profiles -o=docs/boards.md

# Export relationship data as JSON
npm run dev:cli -- analyze --format=json -o=map.json
```

---

## Architecture

### Monorepo Structure

npm workspaces split across `apps/` and `libs/`:

```
apps/
  api/               # Express REST API
  cli/               # CLI entry point and commands
  web/               # React 19 + Vite + Tailwind dashboard
libs/
  core/              # Shared utilities and types
  config/            # boards.yaml loading
  monday/            # Monday.com GraphQL client
  query/             # Typed SQLite query layer
  template/          # Handlebars + docxtemplater document generation
  relationship-map/  # Board analysis
  seed/              # Faker.js test data generation
config/
  boards.yaml        # Board IDs, column mappings, relationships
  templates.yaml     # Template variable mappings and validation
templates/           # Handlebars document templates
```

### Config-Driven Design

Board definitions live in `config/boards.yaml`, making it easy to add new boards without code changes and define column mappings with fallback strategies.

### Column Resolution

Columns are resolved using flexible strategies that can be chained for fallback behavior:
- `by_type` — match by Monday.com column type
- `by_title` — match by column title (case-insensitive)
- `by_id` — match by exact column ID

### Data Flow

Monday.com boards → `libs/monday` (GraphQL) → SQLite (`libs/query`) → REST API (`apps/api`) → React dashboard (`apps/web`)

Document generation: Monday.com item → `libs/template` (Handlebars context) → DOCX output

---

## Design

The dashboard uses a **warm editorial** aesthetic: Fraunces serif for display headings, Outfit sans-serif for body text, and a deep navy + amber accent palette. Updates are shown with author initials (deterministic colors), date-grouped sections, and threaded reply indentation.

---

## Documentation

- [Architecture Guide](docs/CONFIG-ARCHITECTURE.md) - Detailed system design and patterns
- [Monday.com Domain Map](docs/monday-domain-map.md) - Board relationships and case flow
- [Board Relationship Map](docs/boards.md) - Visual map of all 18 tracked boards and their connections

---

## License

Private - Internal use only.
