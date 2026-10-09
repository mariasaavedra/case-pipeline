# Prescheduling + Contracts pages (2026-09-30)

**Status:** Prescheduling (P13) and Contracts (P14) implemented 2026-09-30.

Two new sidebar pages that come before P5 Active Cases in the client workflow:

**Contracts** (Pending Fee Ks) → **Prescheduling** (Paid Fee Ks, waiting for documents) → **Active Cases** (Open Forms / Court Forms)

Both are read-only for now. Both reuse the P5 layout: a summary table on top, where clicking a number filters the case list below it, with `--urgency-*` colours and theme tokens only.

## Data

This needs no sync work. Fee Ks board items are already synced into `contracts` (`raw_column_values`), keyed by `group_title`.

| Monday column | Synced key |
|---|---|
| `status6__1` PS Stage | `ps_stage` |
| `dropdown_mkv1db6z` Contract for | `contract_for` (labels) |
| `status__1` It will go to | `it_will_go_to` |
| `deal_stage` Contract Stage | `contract_stage` |
| `date_mkmvcse2` Hire date | `hire_date` |
| `date_mkzktfv1` Reminder sent / checked on | `reminder_sent_checked_on` |
| `date_mkx8stcx` Evidence received | `evidence_received_date` |
| `date__1` / `date1__1` / `date_mkzjh7f2` | `contract_added_on` / `contract_sent_on` / `payment_link_sent_on` |
| `date_mkpcgk6n` North Pole until | `north_pole_until` |

A new query module, `libs/query/src/prescheduling.ts`, will read the Paid Fee Ks and Pending Fee Ks groups. It returns one flat, de-duplicated case list, in the same shape as `getActiveCases().cases`.

## Prescheduling page — Paid Fee Ks (group `new_group3327__1`)

- **Summary table:** paralegal rows × PS Stage columns (Need to contact client · Need Evidence · Evidence Received · Ready for Para Confirmation · Paralegal to be assigned · Para Assigned · Need Attorney Intervention). Only stages that have cases get a column.
- **Cell colour = oldest wait in that cell,** measured in days since the hire date. Green under 30 days, yellow from 30, red from 60.
- **"Client not cooperating" flag:** a reminder was sent 14+ days ago and there is still no Evidence Received date. Shown as a red tag and its own filter chip. (14 days is a default; confirm it.)
- **Row shows:** client (link), Contract for, PS Stage, waiting time ("hired May 16 · 137 days"), last reminder, where it goes next (Open Forms / Court Forms), paralegal(s), attorney.
- **North Pole:** PS Stage "Send to North Pole" follows the P5 rule. Those cases are out of the counts and go in a separate section. Note that `north_pole_until` is empty on every Paid Fee K today, so each one would show "⚠ no return date".

## Contracts page — Pending Fee Ks

- **Grouped by Contract Stage:** Needs to be sent · Ready to be sent · Sent to Client · Payment link sent · Client coming to the office · 7 Days before Expiry · Needs to be Amended · HOLD · Needs Refund…
- **Summary table:** removed 2026-10-09 (was P14.2, attorney rows × Contract Stage). Each row's age is still coloured: days since sent, or since added if not sent yet. Green under 30, yellow 30+, red 60+.
- **Contract rows** show: client (plus the Monday item name when it differs, which exposes "(copy)" duplicates), Contract for, age, payment link date, AF/FF, attorneys, assistant.
- **Thresholds:** 7 / 14 days was tried first. Most pending contracts are 30+ days old, so everything went red. 30 / 60 matches Prescheduling. Monday doesn't record when a stage changed, so the age is time in the pipeline, not time in the current stage.

## Sidebar

Order: Contracts → Prescheduling → Active Cases. Screen codes: P13 Prescheduling (built first), P14 Contracts. The summary table (`CountTable`) and list sections (`ListSection`) are shared in `components/caseBoardParts.tsx`.

## Decisions (2026-09-30)

- Defaults approved: "not cooperating" = a reminder 14+ days ago and no evidence received on or after it. Waiting time turns yellow at 30 days and red at 60. Contracts rows are attorneys.
- AF/FF deadline: all 37 dates are in the past, so it's left off until the team keeps it current.
- Thresholds are the query defaults for now (`getPrescheduling` options). They could move to Settings like P5's urgency thresholds.
