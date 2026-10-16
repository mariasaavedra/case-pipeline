# Staff roster, Workload, Offboarding (P11.6, P20)

One list of everyone who works at the firm, with their roles, built on by two
views: who carries what (Workload) and how someone leaves without their work
getting lost (Offboarding).

| Piece | Where | Code |
|---|---|---|
| Roster | Settings → **Staff** (`/settings/staff`, admin) | `apps/api/src/staff/roster.ts`, `routes/staff.ts`, `apps/web/src/components/StaffSection.tsx` |
| Workload | `/workload` (admins only for now) | `libs/query/src/workload.ts`, `GET /api/workload`, `components/WorkloadPage.tsx` |
| Offboarding | Settings → Staff → person → **Offboard…** | `apps/api/src/staff/offboarding.ts`, `routes/staff-offboarding.ts`, `components/OffboardingPanel.tsx` |

## Why

Before this, a person was four unconnected things: a login (`users`), a
free-text `paralegal_link`, an `attorney_board`, and a name string in a Monday
people column. Nothing said who is an attorney or a paralegal, staff who never
sign in didn't exist, and two spellings of one name were two people. When
someone left, their open work stayed on a name nobody watched.

## Roster (users.db v15)

- `staff` — one row per person: name, email, `monday_user_id`, ext., attorney
  board, active, start/end date, `source` (`monday` / `board_name` / `manual`),
  `monday_seen_at`, `roles_reviewed`.
- `staff_roles` — fixed list: attorney, paralegal, court paralegal, reception,
  billing, manager. Several per person.
- `staff_aliases` — every spelling that means the person (normalised: case,
  accents, spaces). **`resolveStaffByName` / `makeStaffResolver` is the one name
  matcher**; nothing should compare staff names by hand.
- `users.staff_id` — which person a login is.

**Refresh from Monday** (`refreshStaff`, also on first boot when the roster is
empty):

1. Monday workspace users → upsert by Monday id (their Monday name becomes an alias).
2. Names in a people column (board items' paralegal/attorney, Fee Ks'
   paralegal/attorney/assistant) that match no one → **inactive `board_name`
   rows**. In practice these are former staff still holding work.
3. Roles suggested from the boards (paralegal column → paralegal; attorney column
   or an attorney board's name → attorney), **only for people an admin hasn't
   reviewed**. Setting roles marks them reviewed.
4. Logins linked by `paralegal_link`, email, then name; `paralegal_link` becomes
   an alias, `attorney_board` moves onto the person.

Active Monday people the workspace no longer lists are reported, not
deactivated: leaving is the Offboarding flow's decision.

**Readers switched:** My Cases picks the caller's lanes by their staff record
(all aliases), My Day opens on the staff record's attorney board first,
`/api/paralegals` lists active staff with a paralegal role, and the three
private Monday-user caches (call log, consult booking, appointments) share
`staff/workspace-users.ts`. The legacy `users` columns stay as a fallback.

Contracts and e-sign (`contract-info.ts` `makeMondayUserResolver` /
`makeMondayUserByLogin`, the e-sign sender) resolve a person through the roster
first (e-mail, then name or alias → the staff row's Monday id) and only fetch
the shared workspace list when the roster has no Monday id. Nothing outside
`staff/workspace-users.ts` calls `fetchWorkspaceUsers`.

Pickers and filters built from board names (Call Log "taken by", the
Appointments attorney list, P13 paralegals, P14 attorneys + assistant, P15
attorneys + paralegals, P18 assistants, P19 paralegals) get the roster as a
`StaffResolver` (`libs/query/src/staff-names.ts`, so `libs/query` never opens
users.db): one entry per person under the roster name, and an `inactiveStaff`
list the web marks "(inactive)" rather than hiding — those people still hold
open work. A filter picked by roster name matches every board spelling
(`spellingsOf`). Display only: P14 also returns `mondayAttorneys`, Monday's own
spelling, which M25's stale check compares.

Not moved: the attorneys list in document settings (G-28, contracts). It keeps
its bar admissions and USCIS account.

## Workload

`getWorkload(db, resolve)` runs each page's own query, so "open" means what that
page shows, and leaves North Pole out:

| Source | Query | People |
|---|---|---|
| Open Forms (P5) | `getActiveCases` | paralegal, attorney |
| Prescheduling (P13) | `getPrescheduling` | paralegal, attorney, assistant |
| Pending Fee Ks (P14) | `getPendingContracts` | attorney, assistant |
| Court cases (P15) | `getCourtCases` | paralegal, attorney |
| FOIAs (P19) | `getFoias` | paralegal, attorney |

Address changes carry no person, so they aren't counted. Level: critical =
overdue / late / behind, warning = coming up / waiting / at risk. An item counts
once per person, however many columns name them. Two gap lists: **no one
assigned** (primary column empty: paralegal, or attorney for Fee Ks) and **held
only by inactive staff** — also shown in Alerts as "Assigned to inactive staff".

## Offboarding (users.db v16 `staff_offboarding`)

1. **Hand over open work** — the person's Workload items, per column. A default
   replacement per column (pickers list people whose roles fit first), overridable
   per item, or "leave unassigned". The server re-derives what the person holds;
   it never trusts the client's list.
2. **Turn off access** — staff inactive with today's end date, linked login
   disabled. Refuses yourself and the last active admin.
3. **Outside this app** — ticked by hand: Monday seat, Microsoft 365,
   RingCentral, Slack.
4. **Finish** — only with 0 open items, access off and every step ticked.

How a reassignment writes (live data only):

- The people column is **read live** first (`fetchPeopleCells`): the mirror only
  has display names and a write needs ids. If the person is no longer in it, the
  item is skipped as "Already changed on Monday".
- Ids nobody in the roster has (deactivated Monday users) are looked up by name
  (`fetchUsersByIds`), so a `board_name` person is still recognised.
- **Co-assignees and teams stay**; the replacement is added once.
- Written under the admin's own token (shared-token fallback); on an outage the
  `change_column_json` op is queued. The local mirror changes right away, so
  Workload shows the result immediately.
- Seed data (`DB_SOURCE=seed`) or no token: only the mirror changes; the panel
  says so.

Audit: `staff.created/updated/roles_changed/alias_added/alias_removed/synced`,
`staff.offboard_started`, `staff.reassigned` (counts only, no client names),
`staff.offboarding_step`, `staff.deactivated`, `staff.offboarded`.

## Before the first real offboarding

Reassign one test item on prod first and check it on Monday. Monday's
`users(ids:)` returning deactivated users is what lets a former employee's
cells be matched; if it ever stops doing that, those items are skipped as
"Already changed on Monday" rather than written wrong.
