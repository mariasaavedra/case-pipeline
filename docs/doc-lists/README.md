# Client document lists

The firm's bilingual "what to bring" lists, one Markdown file per list. Copied on 2026-10-21 from SharePoint **SCALDocs → Shared Documents → Document Lists → `1) DOC LIST WITHOUT BIOSHEETS`** (35 PDFs).

## File format

Every file has the same shape, so a script can load them:

```yaml
---
title: English heading of the list
title_es: Spanish heading
source_file: the PDF's name in SharePoint
suggested_case_types: [Fee K Type labels]   # a PROPOSAL, still to be reviewed
note: anything odd about the source (optional)
reviewed: date — what was changed and from which source (optional)
staff_note: something an attorney must decide before the list is sent (optional)
status: retired   # only on a list that must not be sent
---
```

After that: `## English` and `## Español`, each a `- [ ]` checklist. Sub-items are indented. **Bold lines** are section headings from the PDF.

- The text is kept as written. Only obvious typos were fixed ("potos" → "photos", "Form 1-693" → "I-693"). The firm's footer (address and phone) is left out.
- **No government filing fees.** Fee amounts and fee-waiver items were taken out on 2026-10-21, because the fees change every year (Pub. L. 119-21). Show fees from the firm's fee sheet instead. The lists still mention firm charges: $10 photo printing, the Trial Preparation Fee and translation costs.
- **Audit of 2026-10-21.** Every list was checked against the USCIS fee schedule and form instructions, EOIR and the State Department, and the fixes were applied. Each changed file has a `reviewed:` line saying what changed and why. Full report: https://claude.ai/artifact/EYJHEpmMX382XdrEjzednC
- `suggested_case_types` uses the Fee K Type labels (Monday `dropdown_mm89vqtc`), read from the **local** `live.db` snapshot. Check them against Settings → Firm → Fee K Types before you rely on them.

## Lists and the case types they could go with

| File | List | Suggested Fee K Type(s) |
|---|---|---|
| [aos-i-485.md](aos-i-485.md) | I-485 (family-based AOS) | I-485 - Adjustment of Status, I-485 |
| [full-packet-i-485-i-130.md](full-packet-i-485-i-130.md) | Full Packet I-485/I-130 | Full Packet |
| [aos-asylum.md](aos-asylum.md) | I-485 Asylee Adjustment | I-485 - Adjustment of Status |
| [aos-k-1.md](aos-k-1.md) | I-485 based on K-1 | K-1 |
| [aos-sijs.md](aos-sijs.md) | I-485 SIJS Adjustment | SIJS AOS, SIJS |
| [aos-t-visa.md](aos-t-visa.md) | T-Visa AOS | U/T Visa AOS |
| [aos-u-visa.md](aos-u-visa.md) | U-Visa AOS | U-Visa AOS, U Visa AOS, U/T Visa AOS |
| [cuban-adjustment.md](cuban-adjustment.md) | Cuban Adjustment | I-485 Cuban Adjustment (CAA), I-485 - CAA- Cuban Adj. Act |
| [i-130-spouses.md](i-130-spouses.md) | I-130 only – spouses | I-130 - Petition for Alien Relative |
| [i-130-parent-child.md](i-130-parent-child.md) | I-130 only – parent/child | I-130 - Petition for Alien Relative |
| [i-130-siblings.md](i-130-siblings.md) | I-130 – siblings | I-130 - Petition for Alien Relative |
| [i-751-removal-of-conditions.md](i-751-removal-of-conditions.md) | I-751 Removal of Conditions | I-751 |
| [n-400-citizenship.md](n-400-citizenship.md) | N-400 Citizenship | N-400, N400 |
| [i-90-green-card-renewal.md](i-90-green-card-renewal.md) | I-90 | I-90, I-90 - GC Renewal, I-90 - GC Replacement |
| [cvp-consular-visa-packet.md](cvp-consular-visa-packet.md) | Consular Visa Packet | CVP - Consular Visa Process, NVC Packet |
| [waiver-i-601a.md](waiver-i-601a.md) | I-601A Waiver | I-601A - Waiver |
| [waiver-212c.md](waiver-212c.md) | 212(c) Waiver | Waiver *(no 212(c) type)* |
| [u-visa.md](u-visa.md) | U-Visa application | U-Visa, U-Visa Derivative |
| [i-929-u-visa-relative.md](i-929-u-visa-relative.md) | I-929 | I-929 |
| [vawa-self-petition.md](vawa-self-petition.md) | VAWA Self Petition | VAWA |
| [i-589-asylum.md](i-589-asylum.md) | I-589 Asylum | I-589 - Defensive Asylum (c) |
| [eoir-42b-cancellation-of-removal.md](eoir-42b-cancellation-of-removal.md) | EOIR-42B Cancellation of Removal | E42B - Cancellation of Removal |
| [eoir-42b-trial-prep.md](eoir-42b-trial-prep.md) | E42B Trial Prep (update list) | Trial Prep (c), Trial/Trial Preparation (c) |
| [daca-initial.md](daca-initial.md) | DACA initial | I-821D - DACA - Childhood Deferred Action |
| [daca-renewal.md](daca-renewal.md) | DACA renewal | DACA Renewal |
| [daca-advance-parole.md](daca-advance-parole.md) | DACA Advance Parole | I-131 - Advance Parole |
| [deferred-action.md](deferred-action.md) | Deferred Action (medical) | Deferred Action |
| [labor-based-deferred-action.md](labor-based-deferred-action.md) | Labor-Based Deferred Action | Deferred Action |
| [humanitarian-parole.md](humanitarian-parole.md) | Humanitarian Parole (I-131 + I-134) | I-131 - Advance Parole *(no Humanitarian Parole type)* |
| [i-131-military-pip.md](i-131-military-pip.md) | Military Parole in Place | PIP I131 - Advance Parole |
| [i-131f-pip-keeping-families-together.md](i-131f-pip-keeping-families-together.md) | I-131F PIP (Keeping Families Together) — **retired, do not send** | — |
| [i-765-renewal.md](i-765-renewal.md) | I-765 renewal | I-765 Renewal, I765 - EAD Renewal |
| [i-765-initial.md](i-765-initial.md) | I-765 initial | — *(no type; filed alongside another case)* |
| [i-864-affidavit-of-support.md](i-864-affidavit-of-support.md) | I-864 Affidavit of Support | supplement → Full Packet, I-485, CVP, NVC Packet |
| [bona-fide-marriage-evidence.md](bona-fide-marriage-evidence.md) | Bona fide marriage evidence | supplement → I-130, Full Packet, I-751, Interview Prep |

## Decisions still open

1. **Several lists, one type.** "Deferred Action" covers both the medical and the labor-based list. "I-130" covers spouses, parent/child and siblings. "PIP I131" covers military and I-131F. "I-131 - Advance Parole" covers DACA AP and Humanitarian Parole. Pick the list per case some other way, or add Fee K Types.
2. **Supplements.** I-864 and Bona fide marriage evidence go *with* other lists; they are not case types of their own. They need a many-to-many link.
3. **No matching type.** I-765 initial, 212(c), Humanitarian Parole.
4. **Duplicate Fee K Type labels** (N-400/N400, three spellings of U-Visa AOS, two I-601A entries). Clean these up in Monday first, or every list carries several labels.

## Waiting on an attorney

Lists with a `staff_note` need a decision before they are sent:

- `daca-initial.md`: USCIS accepts initial DACA requests but does not process them.
- `deferred-action.md`: USCIS Policy Alert PA-2026-01 (May 2026).
- `labor-based-deferred-action.md`: the USCIS page for this process is archived and marked out of date.
- `i-131-military-pip.md`: whether to keep "proof of residence at the time of the service member's death".

## Problems in the source PDFs

The .md files are corrected, but the PDFs in SharePoint still have these problems (and everything the audit fixed):

- `I-765 Renewal…pdf` is headed "Initial I-765 Document List". The content is the renewal list.
- `DACA Bilingual…pdf` is headed "Deferred Action Document List" in English. The content is the initial DACA list.
