# Query layer (`libs/query`)

Moved out of `CLAUDE.md` (2026-10-29) so sessions don't load it every turn. Add a row here when you add one.

Package exports four public subpaths:

```ts
@case-pipeline/query          // index — re-exports all public types
@case-pipeline/query/types    // shared TypeScript interfaces
@case-pipeline/query/appointments  // daily appointments with batch enrichment
@case-pipeline/query/client   // profile search, filtered listing, filter options
@case-pipeline/query/relationships  // item_relationships queries
```

Internal modules (not in `package.json` exports, imported via `@case-pipeline/query/*` wildcard alias from `apps/api` handlers):

| Module | Responsibility |
|---|---|
| `appointment-boards.ts` | Which `appointments_<initials>` boards exist in the synced data. No list in code: a new attorney = `boards.yaml` entry + Settings → Attorney boards |
| `active-cases.ts` | P5 Active Cases: de-duplicated case list + per-paralegal lanes, urgency buckets |
| `alerts.ts` | Overdue deadlines + stale cases, only on boards whose date is a real deadline (`DEADLINE_BOARDS`, with each board's "finished" statuses); plus "Mail to review" |
| `appeal-deadlines.ts` | "Appeal & Federal Deadlines" alert group: BIA appeal clock on court cases "REMOVED - Appealing?" / recently "Ordered Removed" (30 days from the removal date in the item name, else last hearing), Appeals board appeal/brief due with nothing filed, Litigation due within 14 days |
| `u-visa-certifications.ts` | Alert groups "I-918B Expiring" (signed certification expiring within 45 days or expired ≤60 days ago, no U visa / I-918 Open Form sent since signing; Expiration Date else signed + 6 months) and "I-918B Requests Pending" (90+ days since the hire date, unsigned). The I-918B board is not in `DEADLINE_BOARDS` |
| `my-cases.ts` | P6 My Cases: Prescheduling + Open Forms filtered to one paralegal (or everyone), E-File from the profile else the item's mirror, card dates, PS Stage + Open Forms status labels |
| `prescheduling.ts` | P13 Prescheduling: Paid Fee Ks by PS Stage, days since hire (30/60), "not cooperating" (reminder 14+ days, no evidence since), North Pole parked, Buzón checklist count |
| `upload-checklist.ts` | Buzón checklist counts per Fee K (required received / asked for, not needed out) for the P13 / P6 cards |
| `pending-contracts.ts` | P14 Contracts: Pending Fee Ks by Contract Stage, aged from sent (else added) date, 30/60 days; `CONTRACT_STEPS` = the Acrobat signing + payment-link steps; `missing` = empty Fee K Type (else the older Contract for) / AF / Attorney / E-mail / Address |
| `court-cases.ts` | P15 Court Cases: active court cases with hearing/judge/method, Case Prep Status, readiness (Trial 60/90, MCH 14 days), data-cleanup flags |
| `address-changes.ts` | P18 Address Changes: open changes of address by phase (paid/our turn → client/attorney → submitted → waiting on payment), aged from Date Received (7/14 days on our turn, else 30/60), next hearing for court changes, cleanup flags |
| `workload.ts` | P20 Workload: open items per person across P5/P13/P14/P15/P19 (each page's own query, North Pole out), names resolved by the staff roster's matcher (passed in); "no one assigned" + "held only by inactive staff" (also an Alerts group) |
| `target-dates.ts` | P24 Target Dates: P5's open forms bucketed by days to the Target Date from the firm's today (overdue / ≤7 / ≤14 / later / none), times moved (`dateMoves`) and the last change to the column (`item_events`); read by the page and the weekday Slack digest |
| `foias.ts` | P19 FOIAs: open FOIA requests by phase (decide / our turn / waiting on the agency / North Pole); "Done FOIAS" group, COMPLETED, NOT PROCEEDING or a Results Received date = done; agencies quoted vs filed; inquiry due |
| `detention.ts` | Is a client detained (P3.0 pill, P17, P4): Det. Facility on an open court case, else "Det"/"Detained" in an open court case's or (active) profile's name, else an appointment in the last 180 days from a jail intake or with a Det Hire / Det No Hire / detainee status; a release (`detention_releases`, schema v38, or its "Released from detention" E&A) switches the name signals off and earlier appointments. `batchGetDetentions` for lists |
| `efiles-to-open.ts` | P21 E-Files to open: paid Fee Ks at Contract Stage "Paid needs action" / "Open E FILE", each with its hire plan (`buildHirePlan`): path (new E-File / court / FOIA / existing), next free case number (profiles + E-File folder names; the ledger is checked in the browser), folder + subfolders, Monday changes, ledger row. Read-only (phase 1). See `docs/features/consult-to-efile.md` |
| `board-columns.ts` | Per-board column schema for the in-place field editors |
| `board-items.ts` | Per-profile board item queries + `batchGetClientBoardItems` |
| `case-summary.ts` | Full 360° client summary + `batchGetClientCaseSummaries` |
| `contracts.ts` | Contract queries + `batchGetClientContracts` |
| `mail-review.ts` | Saved mail scans, the "Mail to review" Alerts group, assign/dismiss decisions |
| `mail-writeback.ts` | What an assigned notice writes to its Open Form (plan, by column title), write-back state per notice |
| `mail-layout.ts` | Reads labelled fields by word position (I-797 grid: value under its label, or inline "Label: value") |
| `mail.ts` | Mail intake: OCR-misread repair, all notice fields (receipt, case type, dates, petitioner/beneficiary/applicant, A#, DOB, section), name + date matching, auto-split of one scan into notices (old scans) or one notice per upload (`split: false`, the Mail page), match to profile + Open Form |
| `case-timeline.ts` | P3.9 Case timeline: one profile's dated milestones on five tracks (court, USCIS, fees, meetings, notes) from `config/timeline.yaml` (column → milestone per board) + rules in code (court outcome from the item name, hearing outcomes incl. "CONT. FROM", appeals with stored due date over removal + 30, motions, RFEs/denials, appointments, Fee K signing); NVC notices, FOIAs, Litigation and I-918Bs are config-only milestones; key E&A types folded into same-day filings; summary = Where it stands / Needs attention / Coming up; from `item_events`: status / group changes (kind `change`) and moved dates (`moved` per board, old date crossed out) |
| `item-history.ts` | An item's changes from `item_events` (batch per item ids; link / subitem / people / button noise out); the timeline's rules: `statusChanges` (status column + group moves, per day, no first value, not in the item's first hour) and `dateMoves` (date to date, per day, not in the first 24 h) |
| `dashboard.ts` | KPI card queries (6 cards, 7-day windows) |
| `search.ts` | Cross-type search (contracts, court cases, etc.) |
| `status-options.ts` | Each board's real status labels + colors (write-back validates against these) |
| `sync-health.ts` | Sync-run ledger, per-board coverage, write-queue depth + failures, archived rows |
| `monday-usage.ts` | Our Monday API call counts per UTC day per job (`monday_api_calls`, schema v34). The counter is `libs/monday/src/usage.ts` (`withMondayJob`, `setDefaultMondayJob`); the API flushes it every minute, the sync as it goes, the consult sweep / Drive intake at exit (`scripts/lib/monday-usage.ts`) |
| `updates.ts` | Client update queries + `batchGetClientUpdates` |
