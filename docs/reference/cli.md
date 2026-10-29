# CLI commands (`apps/cli`)

Moved out of `CLAUDE.md` (2026-10-29) so sessions don't load it every turn. Add a row here when you add one.

Run with `npm run dev:cli -- <command> [options]`:

| Command | Description |
|---|---|
| `render` | Generate a DOCX document from a Monday.com item. Interactive profile selector if `--item` is omitted. |
| `seed` | Populate local `data/seed.db` with Faker.js test data (`--profiles=N`, `--contracts=N-M`, `--seed=N`). |
| `lookup` | Look up a profile or board item by ID and print its column values. |
| `sync` | Sync `config/boards.yaml` against live Monday.com board structures (`--dry-run`, `--verbose`, `--add-board`). |
| `analyze` | Generate a board relationship map as Markdown or JSON (`-o`, `--format`, `--tracked-only`). |
