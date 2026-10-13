# Fee K auto-fill

The Fee K's **INFO NEEDED TO FILL FEE K** section has 13 fields. This is where
each one comes from, and what the app does about it.

| Field | Source | Who fills it |
|---|---|---|
| Full Name, E-mail, E-mail 2, Address | Mirrors of the linked **Profile** | Monday, as long as the Fee K is linked to a Profile |
| AF/FF deadline date, Attorney | Monday automations on Fee K creation | Monday |
| **POC Full Name for Fee Ks** (`text_mm7xyv8e`) | The client's Jail Intake → "POC Name and relationship with detained:" | **This job** |
| **AF / FF Surcharge Fee** (`numeric_mm0gfccq`, `numeric_mm0gc5x9`) | 3% of AF / FF, only when **Payment Method** (`dropdown_mm7v5eeb`) is `CREDIT Card - Surcharge Applies` | **This job** |
| Contract for, AF, FF, PF | Decided by the attorney | A person. M11 (New contract) and M25 (Edit fees) write them; P14 flags a Fee K missing Contract for / AF / Attorney / E-mail / Address |

## How the job works

`apps/api/src/fee-k-autofill.ts`, every 15 minutes (07:00–20:00) when
`FEE_K_AUTOFILL=on`, skipped while a sync runs.

1. **Candidates (live.db):** Fee Ks added on/after `FEE_K_AUTOFILL_SINCE` whose
   POC name or surcharge is empty and can be worked out.
   - POC path: Fee K → Profile → any appointment on an attorney board → its
     `…jail_intakes…` relation → the Jail Intake. The newest intake with a
     parseable POC wins.
2. **Re-check on Monday:** each candidate is re-read from Monday and re-planned
   on the fresh values, so a column someone filled since the last sync is never
   overwritten. Empty columns only, always. A surcharge someone set to 0 stays 0.
3. **Write:** one `change_multiple_column_values` per Fee K with the shared
   token, at most 25 Fee Ks a run. The local copy is updated at once. Each
   write is audited as `monday.fee_k_autofilled` (actor
   `system:fee-k-autofill`). A failed write is logged and retried next run.

### POC name parsing

Staff type the POC as free text. `parsePocName` drops bracketed notes
(`(Mom)`, `[WIFE]`), phone numbers, `for <client>` / `and <second person>`
tails and relationship words on either side (`- Wife`, `Wife Veronica`,
`Paula Sister`, `SIL Kimberly LOPEZ`). A hyphen inside a word is a surname
(`ABONZA-HERNANDEZ`). When nothing name-like remains (`Wife`, `N/A`, a bare
phone number) the field is left blank for a person.

Measured on 2026-10-13 against all 866 Jail Intakes with a POC: 47 give no name
(all of them only a relationship, a phone number or `-`); the rest read as a
person's name.

## Running it

```bash
npm run feek:autofill -- --since=2026-10-01          # dry run: prints the plan, writes nothing
npm run feek:autofill -- --since=2026-10-01 --apply  # write now
```

The dry run opens live.db read-only and never calls Monday. The plan uses
live.db, so Payment Method shows up only after a sync that includes the new
`payment_method` / `poc_full_name_for_fee_ks` columns in `config/boards.yaml`.

## Env

| Variable | |
|---|---|
| `FEE_K_AUTOFILL=on` | Turns the schedule on |
| `FEE_K_AUTOFILL_SINCE=YYYY-MM-DD` | Required. Older Fee Ks are left alone. `npm run check:env` refuses `on` without it |
| `FEE_K_AUTOFILL_CRON` | Default `*/15 7-20 * * *`, firm zone |
