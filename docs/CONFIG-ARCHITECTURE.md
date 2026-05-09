# Config-Driven Architecture

This document describes the config-driven architecture that makes case-pipeline scalable and portable across different Monday.com workspaces.

## Overview

Instead of hardcoding Monday.com column IDs in source code, the tool uses YAML configuration files to define:

1. **Board definitions** — Board IDs and column resolution strategies
2. **Template definitions** — How Monday.com data maps to template variables

This allows adding new boards, columns, and templates without any code changes.

## Project Structure

See the [root README](../README.md) for the full monorepo layout. The config-relevant parts:

```
case-pipeline/
├── config/
│   ├── boards.yaml           # Board & column definitions
│   └── templates.yaml        # Template variable mappings
├── libs/
│   ├── monday/               # Monday.com GraphQL API client
│   │   └── src/
│   │       ├── api.ts            # Core API functions
│   │       ├── types.ts          # TypeScript interfaces
│   │       ├── column-resolver.ts    # Dynamic column resolution
│   │       └── index.ts
│   ├── config/               # Configuration loading
│   │   └── src/
│   │       ├── types.ts          # Config type definitions
│   │       ├── loader.ts         # YAML parsing + env var substitution
│   │       └── index.ts
│   └── template/             # Template utilities
│       └── src/
│           ├── mapper.ts         # Variable mapping & validation
│           └── index.ts
├── apps/
│   └── cli/                  # CLI entry point (render, seed, sync, analyze, lookup)
├── templates/                # Handlebars document templates
└── output/                   # Rendered template output
```

## Configuration Files

### config/boards.yaml

Defines Monday.com boards and how to resolve their columns:

```yaml
boards:
  profiles:
    id: "${PROFILES_BOARD_ID:18397286934}"  # Env override with default
    name: "Client Profiles"
    columns:
      email:
        resolve: by_type
        type: email

      priority:
        resolve: by_title
        pattern: "priority|status"
        types: [status, color]
        fallback:
          resolve: by_type
          type: status
```

### config/templates.yaml

Defines how Monday.com data maps to template variables:

```yaml
templates:
  client_letter:
    path: "templates/client.txt"
    source_board: profiles
    variables:
      contact_name:
        source: item.name
      email:
        source: column
        column: email
    validation:
      required: [contact_name, email]
      warn_if_empty: [phone, notes]
```

## Column Resolution Strategies

The column resolver supports three strategies:

| Strategy | Description | Example |
|----------|-------------|---------|
| `by_type` | Match by column type | `type: email` matches the email column |
| `by_title` | Match by title regex | `pattern: "priority\|status"` matches "Priority" or "Status" |
| `by_id` | Exact column ID | `id: "status5"` (fallback for edge cases) |

Each strategy supports:
- `types` — Optional array to filter by column type
- `fallback` — Another resolution to try if the first fails

## Environment Variables

Board IDs can be overridden via environment variables:

```bash
# In .env
PROFILES_BOARD_ID=18397286934
CONTRACTS_BOARD_ID=18397312752
```

The syntax `${VAR_NAME:default}` in YAML files will:
1. Use the environment variable if set
2. Fall back to the default value otherwise

## Usage

### Document generation (render)

```bash
# Interactive profile selector
npm run dev:cli -- render

# Render a specific item
npm run dev:cli -- render --item=<ITEM_ID>

# Use a different template
npm run dev:cli -- render --template=other_template

# With debug output (shows column resolution)
npm run dev:cli -- render --debug
```

With `--debug`, you'll see column resolution details:

```
Resolving columns...
  ✓ email → email (Email, email)
  ✓ phone → phone (Phone, phone)
  ✓ priority → status5 (Priority, status)
  ✗ some_column → NOT FOUND
```

## Adding New Columns

To add a new column to the pipeline:

1. **Add to boards.yaml:**
   ```yaml
   columns:
     new_column:
       resolve: by_title
       pattern: "new.*column"
       types: [text]
   ```

2. **Add to templates.yaml:**
   ```yaml
   variables:
     new_variable:
       source: column
       column: new_column
   ```

3. **Use in template:**
   ```handlebars
   New Value: {{new_variable}}
   ```

No code changes required.

## Adding New Boards

1. Add the board definition to `config/boards.yaml`
2. Create a new template in `config/templates.yaml` with `source_board` pointing to the new board
3. Optionally add an environment variable override for the board ID

## Config Synchronization

The `sync` CLI command keeps your YAML configuration in sync with Monday.com board structures.

### Usage

```bash
# Sync all boards — detect new/missing columns
npm run dev:cli -- sync

# Preview changes without writing
npm run dev:cli -- sync --dry-run

# Add a new board to config
npm run dev:cli -- sync --add-board=123456789 --board-key=new_board

# Verbose output showing all matched columns
npm run dev:cli -- sync --verbose
```

### What It Does

1. **Detects new columns** — Columns added to Monday.com that aren't in your config
2. **Detects missing columns** — Columns in config that no longer exist on the board
3. **Auto-generates config** — Creates resolution strategies for new columns
4. **Preserves existing config** — Merges new columns without overwriting existing definitions

### Example Output

```
Fetching board: profiles (18397286934)...
  Found: "Client Profiles" with 12 columns

  New columns (not in config):
    + company (text) → by_title pattern: "company"
    + linkedin (link) → by_type type: link

  Missing (in config but not on board):
    - old_field
```

## Board Relationship Analysis

The `analyze` command generates a visual map of board connections and mirror columns.

```bash
# Generate relationship map as markdown
npm run dev:cli -- analyze -o=docs/boards.md

# Show only connections between tracked boards
npm run dev:cli -- analyze --tracked-only --main-board=profiles -o=docs/boards.md

# Export as JSON
npm run dev:cli -- analyze --format=json -o=map.json
```

Use `--tracked-only` to filter out connections to boards outside the config (phantom boards). All renderers (markdown, JSON, mermaid) automatically receive filtered data.

## Data Factory (Seed)

The `seed` CLI command generates realistic test data locally using Faker.js.

### Usage

```bash
# Generate 10 profiles with 1–3 contracts each
npm run dev:cli -- seed --profiles=10 --contracts=1-3

# Reproducible data set (same output every time)
npm run dev:cli -- seed --profiles=10 --seed=42

# List all generated batches
npm run dev:cli -- seed --list
```

### Features

- **Realistic fake data** — names, emails, phone numbers, addresses, case notes
- **SQLite persistence** — stages generated data locally in `data/seed.db`
- **Reproducible generation** — `--seed` ensures identical data sets across runs

## Testing

```bash
npm run test
```

Tests cover:
- Column resolution strategies (`by_type`, `by_title`, `by_id`)
- Fallback resolution chains
- API response parsing and error handling
- Data factory generators and seeding
