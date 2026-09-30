# P5 Active Cases — redesign (2026-09-30)

**Status:** Implemented 2026-09-30.

Replaces the 5-column swim-lane grid in `apps/web/src/components/ActiveCasesPage.tsx`.

## Why

- Cards are hardcoded `bg-white` / hex colours → glaring white in dark mode.
- Cards cluster: in the local snapshot, 23 of 30 cases are Overdue or No Date, so 3 of 5 columns are mostly empty.
- The left stripe means urgency, except on court cases, where blue replaces it.
- The card never shows the actual date.

## Who uses it

All four: manager (who's overloaded), attorney (what's on fire), paralegal (my to-do), morning stand-up.

## Layout (option D: summary + list)

1. **Summary table:** paralegal rows × buckets `Overdue · Missing date · 1–3 days · This week · Later`.
   - Each cell is a count button. Clicking it filters the list below; clicking a name filters to that person.
   - A shared case counts in each assignee's row. The **Total** row counts it once.
   - Empty cells show `–`, muted. Cell colour intensity reflects its urgency, not the size of the count.
2. **Filter bar:** active filter chip(s) with ×, an "Only court" chip, and the North Pole toggle (moved here from the header).
3. **Case list:** by default everything, sorted by urgency, then date. Each case appears once, with all its assignees shown as chips.

## "No date" becomes "Missing date"

This is a problem to fix, not a neutral bucket. Rename it, give it the warning colour, and put it second, right after Overdue.

## North Pole = out of the counts

Every case whose status is "Send to North Pole" is left out of the table, the header counts and the main list, whatever its return date. (The old board kept a parked case visible when its return date had passed or was missing.) The "❄ Show N in North Pole" chip opens a separate North Pole section below the list. That section follows the person and court filters but not the urgency buckets.

So a parked case is never forgotten, a separate "⚠ N in North Pole need a date" chip opens the section showing only those cases, and in the section each case is tagged "⚠ return date passed …" or "⚠ no return date". A parked case with a future return date shows "❄ back <date>". `ActiveCase.parked` carries the status flag. The query's `snoozed` and `includeSnoozed` flags are unchanged for other callers. P5 always fetches with `includeSnoozed=1`.

## Each row shows

Client (link) · form type · status badge · **due date + countdown** (`Sep 12 · 18d late`) · paralegal chip(s) · attorney · tags: `COURT`, `URGENT` (tag only, no re-sort), `SHARED`, `❄ North Pole until …`.

## Data changes (`libs/query/src/active-cases.ts`)

- Add `attorney` from `json_extract(column_values,'$.attorney.label')`.
- Add `urgent: boolean` from `$.urgent.label = 'Yes'`.
- Add `forms: string[]` from `$.forms.labels` (I485, I130…). The item name often is just the client's name, so it's shown only when it differs.
- Return a flat, de-duplicated `cases[]` alongside the existing `assignees` lanes (My Cases still uses those). The web app counts per person from `cases`.

## Styling

Bucket colours: Overdue red, Missing date amber ⚠, 1–3 days orange, This week blue, Later green (`--urgency-*` in `styles.css`, with dark-theme values). Dark mode also lifts the app-wide `--color-status-*` text colours, which were unreadable on dark pills, and tones down `.card:hover`.

Only theme tokens (`--color-card`, `--color-ink*`, `--color-border`, `--color-status-*`). No `bg-white`, `text-gray-*` or raw hex. Check in light and dark mode.

## Out of scope

Auto-refresh, days since last activity, a TV/stand-up mode.
