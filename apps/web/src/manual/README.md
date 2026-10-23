# Staff manual (P22)

The in-app manual at `/manual`. One Markdown file per chapter in `chapters/`.
Edit a file, merge, and the next deploy shows it. No code change needed.

## Change a chapter

Open the file in `chapters/` (admins: **Edit this chapter ↗** on the chapter
opens it on GitHub). Write for staff, not developers: short steps, the button
names exactly as they appear on screen in **bold**, no file paths or API names.

## Add a chapter

Make `chapters/NN-slug.md`. `NN` only sorts files in the folder; the URL is
`/manual/slug`. Start it with:

```
---
title: Contracts (Fee Ks)
section: Contracts & money
order: 10
summary: One line shown on the manual's home page.
routes: contracts
code: P14
for: billing, attorney
admin: false
updated: 2026-10-23
---
```

| Key | Meaning |
|---|---|
| `title` | Required |
| `section` | One of `SECTIONS` in `manual.ts`: Getting started, Every day, Clients & cases, Contracts & money, Court & USCIS, Admin, Reference |
| `order` | Position inside the section |
| `summary` | One line on the manual's home page and in search |
| `routes` | `Route.page` values (`router.ts`) whose top-bar **? Help** opens this chapter. Comma-separated; may be empty |
| `code` | The screen code(s) from `docs/ui-map.md` |
| `for` | Who it's mostly for: reception, paralegal, attorney, billing, admin. Empty = everyone |
| `admin` | `true` hides the chapter from non-admins (for pages only admins see) |
| `updated` | Date of the last real change, YYYY-MM-DD |

Inside the text:

- `## Heading` and `### Heading` become "On this page" links and search
  results; link to one with `/manual/slug#heading-text`.
- `[Contracts](/contracts)` opens an app page, `[Texting](/manual/texting)`
  another chapter.
- `> Tip text` renders as a highlighted box.
- Tables work (GitHub style).

"What's new" is built from `src/changelog.ts`, so add user-facing changes there.

## Keep it current

Every PR that changes what staff see or do updates the chapter(s) for that page
in the same PR, and bumps `updated`. See "Staff manual" in `CLAUDE.md`. CI's
`manual` check fails a PR that changes the web app's screens without touching
the manual, unless the PR description says `Manual: n/a` and why.

`manual.test.ts` checks every chapter parses, has a known section, and that
every page in the sidebar has a chapter.
