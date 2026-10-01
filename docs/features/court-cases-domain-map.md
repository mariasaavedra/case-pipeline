# Court cases — domain map and backlog (2026-10-01)

Court work spread across Monday, what of it we sync, what the dashboard does with it, and what's left to do.
Counts are from the local `live.db` snapshot (2026-09-30), so they may be stale. Board links were read from live Monday on 2026-10-01.

## 1. The boards

The **Court Cases** board (`court_cases`, 8025546360) is the hub. It has 250 columns. 216 cases are active (group "Court Case"), and 271 are closed (Inactive 130, Ordered Removed/VD 81, Withdrew 57, Granted 3).

| Board | Items | What it holds for court work | Synced? |
|---|---|---|---|
| **Calendaring** | 980 | One entry per hearing (current and past), plus court deadlines and fee due dates. Each active case links to its CURRENT HEARING entry; older hearings stay as RESCHEDULED / ATTENDED | ✅ |
| **Deadlines and Due Dates** | 412 | Scheduling orders: what was ordered, written/due/warning dates, completed | ❌ **not synced** |
| **Court Tasks** | 797 | Paralegal to-dos per case (assigned to, due, status). TRIAL PREP tasks too | ❌ **not synced** (only mirrors on the case) |
| **Subitems of Court Cases** | 366 | Subitems | ❌ |
| Motions | 323 | Motions (bond, MTC, MTR, MTT…). 135 Filed/waiting for IJ; 87 active cases link to one | ✅ |
| Appeals | 32 | 29 BIA appeals | ✅ |
| Litigation | 45 | Federal litigation (habeas, SEVIS, EAJA…) | ✅ |
| [FA] Jail Intakes | 906 | Detained leads; 8 active cases link back | ✅ |
| Appointments M / LB / R / WH / CR | — | Court prep appointments (Initial TP, TP #1–#4) | ✅ except CR |
| Fee Ks | 1,229 | Court fees (master / TP / trial) | ✅ |
| [CD] Open Forms | 819 | "Court Forms" group (4 now): forms filed with the court | ✅ |
| [NA] Originals + Cards + Notices | 547 | Fingerprint and receipt notices (FPs / RN links) | ✅ |
| Address Changes | 125 | EOIR-33 address changes | ✅ |

## 2. What the Court Cases board tracks

Columns grouped by job, with how many of the 216 active cases have each one filled in:

| Area | Key columns (filled) | Notes |
|---|---|---|
| **Hearing** | date/time via Calendaring (202), type (211), judge (182), method (172), status (216), ECAS/eService (205) | Hearing type mixes status in ("AWAITING NEW DATE" 57). The `ij` dropdown is empty everywhere; the judge comes from Calendaring |
| **Prep workflow** | Case Prep Status (216), Prep Time Stage (163: URGENT!!! 31, CURRENT 36…), Deadline Status (69) | Three overlapping "where is it" columns |
| **Filings** | WPs (152: Filed 80, Need to File 13, Assigned 13), App for Relief (105: Filed 55, Needs to Hire 9), E28s (128: All Filed 111), Receipt Notice (65), Fingerprints (26), Evidence (19), Witness List (18), Exh. TOC (39), Brief/MTN (66) | Each filing has a status, a file, a due date and a filed-on date. **This is the hearing-prep checklist, already on the board** |
| **Court deadlines** | Written / Due / Warning from Calendaring (109–130), Deadline Type (199), Sched. Order file (94) | Scheduling-order detail lives on the unsynced Deadlines board |
| **Fees** | Hearing Fees (173: MASTER Owed 51, TP+T Owed 36, TRIAL Owed 12, Paid 43), Fee K status (95), fees due dates (≈45), owed amounts (≈28) | Money owed before hearings |
| **Tasks** | Court Tasks mirrors: assigned to / due / status (146–149) | Source board not synced |
| **Charging / case facts** | NTA (129), NTA date (100), NTA validity (72), I-213 (107), Entry (96), Relief (143), Seeking (155), Criminal (24) | Mostly stable once set up |
| **Client contact** | Para Action (216), Client Action (216), Client Communication (79) | Para/Client Action are "Look into this" on 183/169 cases: the default value, so these columns are effectively unused |
| **Trial file** | TF Status (67: both physical + electronic 63), Trial File link (157), Court Work File (22) | — |

## 3. What the dashboard does with court work today

| Where | What it shows |
|---|---|
| **P15 Court Cases** (branch `feat/court-cases-p15`, admins only) | Docket and Prep Pipeline views, stage write-back, cleanup strip |
| Client 360 → Court Cases tab | The client's court case items as generic board cards; no hearing, filing or fee view |
| P5 Active Cases → "Court" filter | Court **Forms** (Open Forms), not the Court Cases board |
| Calendar | Hearings and court deadlines, read from Calendaring board items |
| Dashboard KPI | Hearings card |
| M17 Release from detention | Clears Det. Facility on the court case and logs a Casenote |
| Search | `type=court_cases` |
| Mail intake | USCIS notices only; EOIR notices are not parsed |

## 4. Problems found

1. **Six relation columns point to the wrong Monday column.** In `config/boards.yaml`, `hearings`, `court_prep_appts`, `link_to_litigation`, `link_to_court_tasks`, `link_to_address_changes` and `link_to_address_changes_1` use `resolve: by_type`. They all pick up the first relation column (Profile), so every one of them holds the client's profile link. Fix: pin each one `by_id` (`board_relation_mm39s7e1`, `board_relation_mm3trf3w`, `board_relation_mm3cxpjk`, `board_relation_mm4njwkc`, `board_relation_mm40b1b9`, `board_relation_mm40qj01`), then re-sync.
2. **Calendaring status is ignored.** 13 upcoming "current hearings" are marked "RECHED/ CONT/ AC/ WD – NOT HAPPENING", and P15's Docket still lists them.
3. **Two boards court work depends on aren't synced:** Court Tasks and Deadlines and Due Dates.

## 5. Backlog, in suggested order

| # | Item | Why | Size |
|---|---|---|---|
| 1 | Fix the 6 relation mappings + re-sync | Wrong data today; blocks hearing history, prep appts, litigation links | ~1 h + sync |
| 2 | P15: drop NOT HAPPENING hearings from the Docket, add confirmation tag + next court deadline + fees due | Docket correctness; agreed 2026-10-01 | ~2–3 h |
| 3 | Verify P15 in the browser + against the server DB, open PR | Ship what's built | ~1 h |
| 4 | Sync **Court Tasks** and **Deadlines and Due Dates** | Unlocks per-paralegal court to-dos and scheduling-order deadlines | ~½ day each (config + sync + schema) |
| 5 | **Hearing-prep checklist**: per case, filings due vs filed (WPs, App, RN, FPs, E28s, evidence, witness list, TOC) and fees owed, against the hearing date | The data is already on the board (§2); replaces the "Needs config" spec in `hearing-prep-checklist.md` | ~1–2 days |
| 6 | Client 360 Court Cases tab: hearing, judge, prep stage, filings, fees, motions, hearing history | Today it's generic cards | ~1 day |
| 7 | Fees-before-hearing view (MASTER/TP/TRIAL owed vs due) | 99 cases owe something | ~½ day |
| 8 | Motions / BIA appeals / litigation views | Separate boards, smaller volume | later |
| 9 | ECAS: ECAS PDFs into Mail intake (EOIR notice parser), then notification-email parsing | No public API; see 2026-10-01 notes | 1–3 days |

Questions to settle with the court team:
- Which of the three "where is it" columns is the real one: Case Prep Status, Prep Time Stage or Deadline Status?
- Are Para Action / Client Action still in use?
