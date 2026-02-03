# Config-Driven Architecture

This document describes the config-driven architecture implemented to make the case-pipeline tool scalable and portable across different Monday.com workspaces.

## Overview

Instead of hardcoding Monday.com column IDs in the source code, the tool now uses YAML configuration files to define:

1. **Board definitions** - Board IDs and column resolution strategies
2. **Template definitions** - How Monday.com data maps to template variables

This allows adding new boards, columns, and templates without any code changes.

## Project Structure

```
case-pipeline/
├── config/
│   ├── boards.yaml           # Board & column definitions
│   └── templates.yaml        # Template variable mappings
├── lib/
│   ├── monday/               # Shared Monday.com API utilities
│   │   ├── api.ts            # Core API functions
│   │   ├── api.test.ts       # API tests
│   │   ├── types.ts          # TypeScript interfaces
│   │   ├── column-resolver.ts    # Dynamic column resolution
│   │   ├── column-resolver.test.ts # Column resolver tests
│   │   └── index.ts          # Re-exports
│   ├── config/               # Configuration loading
│   │   ├── types.ts          # Config type definitions
│   │   ├── loader.ts         # YAML parsing + env var substitution
│   │   └── index.ts          # Re-exports
│   └── template/             # Template utilities
│       ├── mapper.ts         # Variable mapping & validation
│       └── index.ts          # Re-exports
├── scripts/
│   ├── seed/                 # Test data seeding
│   │   ├── index.ts          # CLI entry point
│   │   ├── seed-profiles.ts  # Profile generation
│   │   ├── seed-contracts.ts # Contract generation
│   │   └── lib/              # Generators and constants
│   └── sync-config/          # Config synchronization tool
│       ├── index.ts          # CLI entry point
│       └── lib/              # Differ, reporter, YAML generator
├── index.ts                  # Main entry point
├── templates/                # Handlebars templates
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
- `types` - Optional array to filter by column type
- `fallback` - Another resolution to try if the first fails

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

### Running the main pipeline

```bash
# Normal run
bun index.ts

# With debug output (shows column resolution)
bun index.ts --debug

# Use a different template
TEMPLATE_NAME=other_template bun index.ts
```

### Debug output

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

No code changes required!

## Adding New Boards

1. Add the board definition to `config/boards.yaml`
2. Create a new template in `config/templates.yaml` with `source_board` pointing to the new board
3. Optionally add an environment variable override for the board ID

## Shared Library

The `lib/monday/` module is shared between:
- Main pipeline (`index.ts`)
- Seed scripts (`scripts/seed/`)

This ensures consistent API usage and reduces code duplication.

## Validation

The template mapper validates variables before rendering:

- **Required variables** - Must have a non-empty value (fails if missing)
- **Warn if empty** - Logs a warning but continues

Configure in `templates.yaml`:

```yaml
validation:
  required: [contact_name, email]
  warn_if_empty: [phone, notes]
```

## Config Synchronization

The `sync-config` tool keeps your YAML configuration in sync with Monday.com board structures.

### Usage

```bash
# Sync all boards - detect new/missing columns
bun scripts/sync-config

# Preview changes without writing
bun scripts/sync-config --dry-run

# Add a new board to config
bun scripts/sync-config --add-board=123456789 --board-key=new_board

# Verbose output showing all matched columns
bun scripts/sync-config --verbose

# Export board reference to markdown
bun scripts/sync-config --export=output/boards-reference.md
```

### What It Does

1. **Detects new columns** - Columns added to Monday.com that aren't in your config
2. **Detects missing columns** - Columns in config that no longer exist on the board
3. **Auto-generates config** - Creates resolution strategies for new columns
4. **Preserves existing config** - Merges new columns without overwriting existing definitions

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

## Data Factory (Seed Scripts)

The `scripts/seed/` folder contains a scalable data generation system for populating Monday.com boards with realistic test data.

### Features

- **Realistic fake data** using [@faker-js/faker](https://fakerjs.dev/) - generates realistic names, emails, phone numbers, addresses, and contextual notes
- **SQLite persistence** - stages generated data locally before syncing to Monday.com
- **Reproducible generation** - use `--seed` to generate identical data sets
- **Batch processing** - rate-limited sync to avoid API throttling
- **Dry-run mode** - test without making API calls

### Usage

```bash
# Full pipeline: generate profiles + contracts and sync to Monday.com
bun scripts/seed/factory.ts --profiles=10 --contracts=1-3

# Generate only (no API calls) - useful for testing
bun scripts/seed/factory.ts --generate-only --profiles=50

# Reproducible data with a seed value
bun scripts/seed/factory.ts --generate-only --profiles=10 --seed=42

# Sync previously generated batch
bun scripts/seed/factory.ts --sync-only --batch-id=1

# List all batches
bun scripts/seed/factory.ts --list-batches

# Dry run (simulates sync without API calls)
bun scripts/seed/factory.ts --dry-run --profiles=5
```

### Architecture

```
scripts/seed/lib/
├── db/                    # SQLite database layer
│   ├── connection.ts      # Database singleton (bun:sqlite)
│   └── schema.ts          # Tables: seed_batches, profiles, contracts
├── factory/               # Data generation
│   ├── column-generators.ts  # Faker-powered generators
│   ├── profile-factory.ts    # Profile generation
│   └── contract-factory.ts   # Contract generation
├── sync/                  # Monday.com synchronization
│   └── batch-sync.ts      # Rate-limited batch syncer
└── seeder/                # Orchestration
    └── seeder.ts          # Main pipeline coordinator
```

### Data Generators

| Generator | Output |
|-----------|--------|
| `generateName()` | Realistic full names (e.g., "Tracy Miller", "Dr. Erica Connelly") |
| `generateEmail(name)` | Email matching the name (e.g., "Tracy.Miller@gmail.com") |
| `generatePhone()` | 10-digit phone number |
| `generateNotes()` | Contextual case notes with lorem ipsum |
| `generateContractId()` | Contract ID format: CTR-2026-XXXX |
| `generateAddress()` | Full street address |

### Reproducibility

The `--seed` flag ensures deterministic generation:

```bash
# These two commands produce identical data
bun scripts/seed/factory.ts --generate-only --profiles=5 --seed=42
bun scripts/seed/factory.ts --generate-only --profiles=5 --seed=42
```

## Testing

Run the test suite:

```bash
bun test
```

Tests cover:
- Column resolution strategies (`by_type`, `by_title`, `by_id`)
- Fallback resolution chains
- API response parsing and error handling
- Data factory generators and seeding
