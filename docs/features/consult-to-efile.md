# Consult → E-File (hire protocol)

**Status:** phase 1 built (P21 queue + M31 plan, read-only, admins) · **Last updated:** 2026-10-22

## Goal

When someone hires the firm, staff do the same five chores by hand:

1. Move the consult folder (SCAL Consults) into SCAL E-Files.
2. Give the client the next case number.
3. Add a row to the ledger.
4. Point every link to the consult folder at the E-File instead, then delete the consult folder.
5. Start prescheduling.

One button does all five. First it shows the plan, then it runs only after staff confirm. The same plan + confirm pattern as mail write-back.

## Trigger

A Fee K becomes paid. LawPay already moves it to **Paid Fee Ks** / Contract Stage "Paid needs action" (`docs/features/lawpay-payments.md`). Staff then move it through two more Contract Stage labels: **Open E FILE** (waiting to be opened) and **E-file OPENED** (done).

One person at the firm opens every E-File. They get a queue, **E-Files to open**: every Fee K at Contract Stage "Paid needs action" or "Open E FILE", oldest payment first. Each row has the button. It is also on the client page (P3) for the odd case outside the queue.

It never runs automatically on payment. A case number and a deleted folder are hard to undo, and a person should look at the plan first.

## Four paths

The Fee K Type decides the path. Settings → Firm → Fee K Types (`data/fee-k-types.json`) gets one new column, **Hire path**:

| Path | When | Number + ledger | Folder |
|---|---|---|---|
| **E-File** | default | new number | `E-Files/{L}/{LAST, First NN-NNN}` + standard subfolders |
| **Court E-File** | court types | new number | same + court subfolders |
| **FOIA** | FOIA types | none | consult folder moved to `SCAL Consults/FOIA/{L}/{LAST, First}`. No E-File |
| **Existing client** | profile already has an E-File (link, or Case No. + a folder in E-Files / Closed) | none: keeps their number | no new folder. If they also have a consult folder, its files move into the E-File's `CONSULT` and the consult folder is deleted |

"Existing client" is detected, not picked: it wins over the Fee K Type.

## Folder templates

What staff create today, seen 2026-10-22:

- **Standard** (DE LA O, Karla 26-228, made 2026-10-21): `CCs` · `COMMUNICATIONS` · `CONSULT` · `CRIMINAL HISTORY` · `DRAFTS` · `EVIDENCE` · `FEE K's` · `FILINGS & RESPONSES - USCIS` · `FPs`
- **Court, add:** `NTA` · `FILINGS & RESPONSES - COURT` · `TRIAL FILE`. Other folders seen on court E-Files (`FILINGS - COURT`, `COURT NOTICES & ORDERS`, `ATTORNEY REVIEW`, `BOND`) are made by hand when needed, not up front (staff, 2026-10-22).

The templates are kept as data (an admin edits them in Settings), not in code. `FEE K's` is already matched by `pickFeeKFolder` (`scripts/sharepoint/fee-k-folder.ts`), so the signed-contract filing (#135) finds it.

**Folder name:** `{LAST}, {First} {YY-NNN}`, built from the profile's Last / First Name. SharePoint has dropped hyphens in some names ("MORGAN SANDERS"), but we keep the profile's spelling. Names are checked with `validateFolderName`.

## Case number

- Format `YY-NNN`, numbered in order within each year. The ledger's 2026 tab ended at **26-230** on 2026-10-22.
- **Next number** = the highest of: the ledger's current-year tab, every profile's Case No. (`dms_number_mkkvj2ft`), and every E-File folder suffix (`sp_folders`), **+ 1**. Taking the highest of all three covers a number someone typed in only one place.
- **Collisions.** Staff still type numbers by hand (26-194 was used twice). The ledger row is the claim: write the row, read the tab again, and if anyone else used that number, take the next one and repeat. Once this is live, staff stop adding hires to the ledger by hand. Otherwise two people can still claim the same number at the same moment.
- Written to the profile's **Case No.** as `YYNNN` (the existing convention). The Fee K's Case No. is a mirror of it and updates on its own.

## Ledger

`SCALDocs / Shared Documents / Client Database / SCAL Client Database2.xlsx`, one tab per year.

The 2026 tab has columns **Case No. · Name · Date Opened · Date Closed · Case Type · Information**, and the first row holds the headings. There is no Excel table, so the new row is written into the first empty row through the Graph workbook API (a range PATCH inside a workbook session). This works while people have the file open in Excel Online, because Excel merges both sets of edits.

| Column | Value |
|---|---|
| Case No. | `26-231` |
| Name | `First LASTNAME` (the format used since 2023) |
| Date Opened | the payment date (fallback: today), as an Excel date |
| Date Closed | empty |
| Case Type | the ledger's own words ("Full Packet", "Immigration Court", "Habeas"…), from a new **Ledger case type** column in the Fee K Types table. Free text in the ledger today |
| Information | address · phone · e-mail from the profile, in the same layout staff use |

## Moving the consult folder

Consults and E-Files are **different sites**, so Graph cannot simply move a folder between them:

1. Create the E-File and its subfolders (`ensureFolderPath`).
2. **Copy** the consult folder's contents into `CONSULT` (Graph `/copy` into the other drive; it runs in the background and we wait for it).
3. **Check** that file count and total size match.
4. Only then **delete** the consult folder. It goes to the SharePoint recycle bin and can be restored for 93 days.

**FOIA** stays in the same site, so there it is a real move (PATCH `parentReference`).

**Existing client:** files go into the E-File's `CONSULT`. A name clash is renamed, never overwritten (the same rule as Drive intake).

## Replacing links

| Where | What happens |
|---|---|
| Profile **E-File** (`e_file__1`) | set to the new folder |
| Profile **Consult File** (`text_mkxphk77`) | set to the E-File link (so nothing points at a deleted folder) |
| **Consult SharePoint** text column on every appointment linked to the profile (`text_mkn3br7k` WH/LB, `text_mkn3gp82` M/CR, `text_mkn3jmhc` R) | set to the E-File link |
| Every board's E-File / Consult File **mirror and lookup** columns (Fee Ks, Open Forms, Court Cases, FOIAs, Motions, appointments…) | nothing to do: Monday updates them from the profile |
| Local `sp_folders` | the next catalog scan picks it up. The button marks the old row `missing_since` straight away |

**Cannot be replaced:** links pasted inside Monday updates, e-mails and Word documents. Those will point at the recycle bin until it empties.

**Must not recreate the folder.** The consult sweep (`CONSULT_FOLDERS=on`) and Drive intake already prefer the E-File over the Consult File. This needs a test: a client whose consult folder was deleted after hiring gets nothing recreated in Consults.

## Prescheduling

On the Fee K, in one Monday write:

- **Contract Stage** → `E-file OPENED`. This takes it off the queue.
- **PS Stage** → `Need to contact client`, only if empty.

The Fee K then shows up in P13 like any other paid case. FOIA hires get the same Contract Stage change.

## Where it runs

- **SharePoint and the ledger:** in the browser, with the staff member's own Microsoft sign-in. The same pattern as P3.6 "Find or create e-file" (#131) and the file mover (#163). Changes show under that person's name in SharePoint. It also avoids a question we can't answer yet: whether the server's account (importantdocuments@) can open SCALDocs at all.
- **Monday:** through the API and the write queue, so an outage queues the write instead of losing it.
- **Progress ledger** (new table): one row per hire, one stamp per step. Re-running finishes what's left and skips what's done. A closed tab or a failed copy leaves the hire half-done, but it can be resumed. Audited as `hire.efile_opened`.

## Plan screen

Before anything is written, the plan screen shows:

- the path,
- the case number it will take,
- the folder that will be created and its subfolders,
- how many files will be copied,
- each Monday column, with its old and new value,
- the ledger row,
- the folder that will be deleted.

Anything missing (no consult folder, no First/Last Name, a Fee K Type with no Hire path) blocks the run and says why.

## Build order

| Phase | What | Estimate |
|---|---|---|
| 1 | "E-Files to open" queue + plan screen: the path, the next number, folders, Monday changes. Writes nothing. Lets the person who opens E-Files check it against the hires they do by hand | 1–1.5 days |
| 2 | Create the E-File, copy, write the Monday links, set PS Stage | 2 days |
| 3 | Case number + ledger row with the collision check | 1–2 days |
| 4 | Delete the consult folder + replace the remaining links; FOIA + existing-client paths | 1 day |

## Answered (staff, 2026-10-22)

1. Court E-Files get `NTA`, `FILINGS & RESPONSES - COURT` and `TRIAL FILE` up front; everything else is made when needed.
2. FOIA hires get no case number.
3. A client with both a consult folder and an E-File: the consult files move into the E-File.
4. Contract Stage goes `Open E FILE` → `E-file OPENED`.
5. One person opens every E-File once the Fee K reaches "Paid needs action".

## Still to confirm

- A returning client (already has an E-File) gets **no** new ledger row. Assumed from "they don't need the e-file process"; the ledger has listed some returning clients again under their old number in the past.
- FOIA hires get no ledger row either (follows from no case number).
