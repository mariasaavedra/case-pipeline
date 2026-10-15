# P6 My Cases + case card (2026-10-14)

**Status:** implemented 2026-10-14.

A paralegal's own work in the two places it waits, in workflow order:

**Prescheduling** (Paid Fee Ks, group `new_group3327__1`) → **Open Forms** (Open Forms / Court Forms)

Before this, P6 only listed the paralegal's Open Forms, and it was read-only.

## Decisions (2026-10-14, Rafael)

| Question | Choice |
|---|---|
| Who sees what | The user's own cases by default (their linked board name). A switcher (D38) shows another paralegal's cases or everyone's |
| Layout | Two stacked sections. Prescheduling is grouped by PS Stage; Open Forms is grouped by Status |
| What the card edits on Monday | PS Stage / Status, key dates, a note, and the E-File link |
| E-File source | The profile's E-File first. If that's empty, the Fee K or Open Form's own E-File mirror. Today every Paid Fee K and Open Form has one |

## Page (P6)

- **Paralegal match:** by board name, case-insensitive, on Fee Ks `paralegal` and Open Forms `project_owner`. A case shared by two paralegals shows for both.
- **No linked name:** the user sees everyone's cases plus a "Link your board name" note. The page is never empty.
- **Prescheduling groups:** in Prescheduling's workflow order. Each row's colour is the days since hire (30 / 60), the same as P13.
- **Open Forms groups:** most urgent case first, then size. North Pole goes last.
- **Parked cases:** cases parked in North Pole with a future return date are hidden, with a show/hide toggle. Same rule as P5 and P13.

## Case card (M27)

| Board | Status | Editable dates | Read-only dates |
|---|---|---|---|
| Fee K | PS Stage (`status6__1`) | Reminder sent (`date_mkzktfv1`), Evidence received (`date_mkx8stcx`) | Hired, North Pole until |
| Open Form | Status (`project_status`) | Forms appointment (`date_mkkwqnd4`), Target date (`date_mkkws221`), Forms sent (`date_mknhv4v7`) | On Open Forms since, Hired |

- **Today button:** shown on the dates that record something done (reminder, evidence, forms sent). Those dates can't be set in the future.
- **Stale check:** each write sends what the card showed (`from`). If Monday changed since, the write is refused (409). Writes queue during an outage and update the local copy right away, like every other write-back.
- **E-File:** **Open E-File** opens SharePoint in a new tab. **Browse files here** opens M26. When there's no link, **Link E-File folder** takes a pasted SharePoint link and writes it to the profile's E-File column. It writes only when that column is empty, so a link set in Monday is never overwritten.
- **Notes tab:** the client's timeline, the same feed as M3's Notes tab (Notes, or All with emails; replies). It loads when the tab is first opened. The box on top posts a note on the client's profile (`POST /api/profiles/:id/updates`) and refreshes the list.

## Not done yet

- **Find or create the folder:** M18's "Find or create e-file folder" needs the client's folder name rules. For now the card only takes a pasted link.
- **Settings for thresholds:** both boards use the query defaults (30 / 60 days since hire, 14 days after a reminder; urgency from Settings for Open Forms).
