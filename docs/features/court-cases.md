# Court Cases page — P15 (2026-10-01)

**Status:** implemented 2026-10-01. Visible to admins only; it still shows as under construction for everyone else (`UNDER_CONSTRUCTION_PAGES` in `Sidebar.tsx`) until the court team has checked the counts.

One fetch, two views of the active immigration court cases (Court Cases board, group **Court Case**):

| View | URL | Question it answers |
|---|---|---|
| **Docket** | `/court-cases` | What's in court soon? Hearings for the next 30 / 60 / 90 days, by week, with judge, method and hearing type |
| **Prep Pipeline** | `/court-cases/prep` | Is prep keeping up? Attorney × Case Prep Status table, then cases grouped by stage. **The stage can be changed here, and the change is written to Monday** |

Both views share the judge / attorney / paralegal / hearing-type filters and the "Needs cleanup on Monday" strip.

## Data

No sync work. Everything comes from `board_items` (`board_key = 'court_cases'`, `column_values`):

| Field | Source |
|---|---|
| Hearing date + time | `hearing_date_calendaring` (Calendaring mirror, `"YYYY-MM-DD HH:MM"`); falls back to `x_next_hearing_date`, then `next_date`. With several dates, the first one on or after today is used |
| Hearing type | `hearing_type` → kind: `/trial/` = Trial, `/\bmch\b/` = MCH, anything else = Other |
| Judge | `judge_connected` (the `ij` column is empty on every case) |
| Method / Needs Webex | `method`; "NEEDS WEBEX" or "Check if needs webex" → **Needs Webex** tag |
| Detained | hearing type or method says "Detained", or Det. Facility is set |
| Prep stage | `case_prep_status` (Monday column `color_mkp7t3ds`, "Case Prep Status") |
| ECAS / eService | `ecas_or_eservice` |
| Attorney / paralegals | `board_items.attorney` / `paralegals`. Mayra Ruiz is the main court paralegal, so she appears on most cases. That is correct, not a mapping bug |

## Readiness (behind schedule)

Defaults agreed 2026-10-01, to be tuned with the attorneys (`readinessOf` in `libs/query/src/court-cases.ts`):

| Situation | Colour |
|---|---|
| Trial within **60** days, prep not yet at a `3 - …` stage | red: behind |
| Trial within **90** days, prep not yet at a `3 - …` stage | yellow: at risk |
| MCH within **14** days, still in `1 - Initial Set Up` (or no stage / "Look into this") | red: behind |

Not judged (no colour): no upcoming hearing, awaiting a new date, and the side-track stages (withdrawals, BIA appeal, bonding out…).

## Data problems ("Needs cleanup on Monday")

| Flag | Rule |
|---|---|
| Hearing date passed | Hearing date before today, and the case is not marked as awaiting a new date |
| Awaiting new date | "AWAITING NEW DATE" in the hearing type, the hearing status or the item name, or stage `3 - PAID - AWAITING NEW DATE` |
| No hearing date | No date anywhere, and not awaiting a new date |
| Profile not connected | No linked profile, or hearing status `CONNECT PROFILE` |

## Stage order

The workflow comes first, then the side tracks; labels added on Monday later go between the two, and "No stage" goes last. `WORKFLOW_STAGES` / `EXCEPTION_STAGES` in the query.

## Stage write-back

`PATCH /api/court-cases/:localId/prep-stage` with `{ stage, from }`. The plan is `planPrepStageWrite` in `apps/api/src/routes/court-case-write.ts` (unit-tested).

- The column id and the allowed labels come from the synced `board_columns`, never from the request.
- **Stale check:** `from` is the stage the user saw. If the case has moved since, the response is 409 with the current stage, and nothing is overwritten.
- Uses the personal Monday token first. If Monday is down, the write is queued (`change_column`) and the row shows "Queued for Monday".
- The local `column_values.case_prep_status` is updated right away, so the card stays in its new column until the next sync.
- Audited as `monday.column_changed` with from → to.
- The UI asks "Move to X?" before writing.

## Not done yet

- Readiness thresholds as admin settings (like the urgency thresholds).
- Opening P15 to everyone after the court team checks the counts.
- ECAS: there is no public API. Two routes are feasible: feed ECAS PDFs to Mail intake (this needs an EOIR hearing-notice parser), or parse the ECAS notification emails. See the 2026-10-01 discussion.
