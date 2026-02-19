# Case Pipeline

A config-driven read-only analysis and document generation platform for Monday.com, connected to a production immigration law workspace with 18 tracked boards.

> **Branch: `read-only`** - All Monday.com write operations have been removed. This branch is safe to run against production data.

---

## Features

- **Client Dashboard** - Web-based 360-degree view of any client: profile, contracts, active cases, pending items, appointments, and full updates/notes timeline
- **Updates Timeline** - Centralized feed of all Monday.com updates, replies, and automation emails across every board — grouped by date with threaded replies
- **Query Layer** - Typed functions for client search (FTS5), contracts, board items, updates, and full case summaries
- **JSON API** - RESTful endpoints served by `Bun.serve()` for the dashboard and future integrations
- **Document Generation** - Create documents from Monday.com data using Handlebars templates with interactive profile selection
- **Test Data Seeding** - Generate realistic test data locally with Faker.js and SQLite (no Monday.com sync)
- **Configuration Sync** - Keep board configurations in sync with Monday.com using YAML-based definitions
- **Relationship Analysis** - Visualize board connections, mirror columns, and data flow with phantom board filtering

---

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) runtime (v1.0+)
- Monday.com API token

### Installation

```bash
bun install
```

### Configuration

Create a `.env` file with your Monday.com credentials:

```env
MONDAY_API_TOKEN=your_api_token_here
```

Board configurations are defined in `config/boards.yaml`.

---

## CLI Usage

The unified CLI provides access to all functionality:

```bash
bun cli.ts <command> [options]
```

### Commands

| Command | Description |
|---------|-------------|
| `render` | Generate documents from Monday.com items |
| `seed` | Generate istic test data locally (SQLite) |
| `lookup` | Search clients and view 360 case summary |
| `sync` | Synchronize board configuration with Monday.com |
| `analyze` | Analyze board relationships and generate maps |

### Examples

```bash
# Interactive document generation - browse and select a profile
bun cli.ts render

# Render a specific item
bun cli.ts render --item=123456789

# Generate 10 test profiles with 2-3 contracts each
bun cli.ts seed --profiles=10 --contracts=2-3

# Search for a client by name
bun cli.ts lookup Garcia

# View full 360 case summary by ID
bun cli.ts lookup --id=<local_id>

# Start the web dashboard
bun run dev

# Sync board configuration
bun cli.ts sync

# Discover all boards in workspace
bun cli.ts sync --discover

# Generate relationship map as markdown
bun cli.ts analyze -o=docs/boards.md

# Generate map showing only tracked board connections
bun cli.ts analyze --tracked-only --main-board=profiles -o=docs/boards.md

# Export relationship data as JSON
bun cli.ts analyze --format=json -o=map.json
```

Run `bun cli.ts <command> --help` for detailed options.

---

## Architecture

### Config-Driven Design

Board definitions live in `config/boards.yaml`, making it easy to:
- Add new boards without code changes
- Define column mappings with fallback strategies
- Configure relationships between boards

### Column Resolution

Columns are resolved using flexible strategies:
- `by_type` - Match by Monday.com column type
- `by_title` - Match by column title (case-insensitive)
- `by_id` - Match by exact column ID

Strategies can be chained for fallback behavior.

### Project Structure

```
├── cli.ts                    # Main CLI entry point
├── cli/commands/             # CLI command implementations
├── server.ts                 # Web server (Bun.serve)
├── config/
│   └── boards.yaml           # Board configuration
├── lib/
│   ├── api/                  # API route handlers
│   ├── config/               # Configuration loading
│   ├── monday/               # Monday.com API client
│   ├── query/                # Query layer (search, contracts, board items, updates, case summary)
│   ├── relationship-map/     # Board analysis
│   └── template/             # Template rendering
├── web/
│   ├── index.html            # Dashboard entry point
│   ├── app.tsx               # React root component
│   ├── config.ts             # Board display config (add/remove boards here)
│   └── components/           # React components
├── scripts/
│   ├── seed/                 # Data seeding tools
│   ├── fetch-profile.ts      # Fetch any Monday.com profile by item ID
│   └── sync-config/          # Configuration sync
└── templates/                # Handlebars templates
```

---

## Development

### Running Tests

```bash
bun test
```

### Type Checking

```bash
bun run typecheck
```

### Package Scripts

```bash
bun run dev              # Start web dashboard (localhost:3000)
bun run cli <command>    # Run CLI
bun run render           # Shortcut for render command
bun run seed             # Shortcut for seed command
bun run sync             # Shortcut for sync command
bun run analyze          # Shortcut for analyze command
```

---

## Design

The dashboard uses a **warm editorial** aesthetic: Fraunces serif for display headings, Outfit sans-serif for body text, and a deep navy + amber accent palette. Updates are shown with author initials (deterministic colors), date-grouped sections, and threaded reply indentation.

## Documentation

- [Architecture Guide](docs/CONFIG-ARCHITECTURE.md) - Detailed system design and patterns
- [Monday.com Domain Map](docs/monday-domain-map.md) - Board relationships and case flow
- [Board Relationship Map](docs/boards.md) - Visual map of all 18 tracked boards and their connections
- [Client Updates Plan](docs/plan-client-updates.md) - Design plan for centralized updates/notes timeline

---

## License

Private - Internal use only.
