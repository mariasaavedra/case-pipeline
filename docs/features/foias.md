# FOIAs (P19)

`/foias` — the open FOIA requests on the FOIAs board (`foias`, board 8025590516), as a queue. Admins only for now (`UNDER_CONSTRUCTION_PAGES` in `Sidebar.tsx`). Read-only: statuses still change on Monday.

Query: `libs/query/src/foias.ts` · API: `GET /api/foias` · Page: `apps/web/src/components/FoiasPage.tsx`.

## What counts as open

Done (counted in the header, not listed) when any of these holds:

- the item is in the **Done FOIAS** group — the team's own signal; most items there never had their status changed (62 still say "Sent Out" on the 2026-10 snapshot),
- status **COMPLETED - RESULTS RECEIVED** or **NOT PROCEEDING**,
- **Results Received:** has a date.

## Phases

| Phase | Statuses | Aged from | Amber / red |
|---|---|---|---|
| Do we need it? | Do we need it? | On FOIAs since… (else Hire Date) | 14 / 30 days |
| Our turn | TO-DO, OTG To pay FF, Forms…, PRINT & SEND, 1 of N FOIAs filed, EXPIRED - Redo, no status… | On FOIAs since… (else Hire Date) | 14 / 30 days |
| Waiting on the agency | Sent Out, Filed, INQUIRED | Filed On: (else On FOIAs since…) | 30 / 60 days |
| North Pole | Send to North Pole | On FOIAs since… | 60 / 120 days |

30 / 60 for the agency: on this board's history, results come back in a median of 2–4 weeks (Filed On → Results Received).

## Agencies

"FOIAs Quoted" vs "FOIAs Filed", normalised to agency names (`EOIR FOIA` → EOIR, `OBIM/FBI FOIA` → OBIM + FBI, `FBI Filed` → FBI, `DARR` → DAR). A quoted agency with no matching filed label shows as "<agency> to file".

## Flags

- **Inquiry due** — waiting on the agency, Inquiry Eligible date reached, status not INQUIRED yet. Sorted to the top of its phase.
- **No results 6+ months** — waiting 180+ days: almost always an item nobody closed. Hidden by default.
- **No Filed On date**, **No paralegal**, **Profile not connected** — cleanup on Monday.
