# Contract signing and payment links (P14)

## Why it works this way

The firm signs contracts in **Acrobat Pro**. Acrobat Pro has no API — only
Acrobat Sign Solutions / enterprise does — so the app can't send a contract
for signature or hear back when it's signed. Decided 2026-10-05: keep Acrobat
Pro (≈40 contracts a month), and make the app the place staff **record** each
step, so P14 shows where every contract is and Monday gets the dates.

> **Since 2026-10-14** contracts can also go to Adobe Sign through Zapier
> straight from M22 ("Send for signature"), with the stage following the
> signatures by itself: [esign-zapier.md](esign-zapier.md). The manual steps
> below remain for contracts sent by hand.

## The flow

Staff send the contract from Acrobat Pro with two signers in order:
**attorney first, then the client**. Acrobat emails the client by itself once
the attorney has signed.

Every action is in the row's **⋯** menu on P14.3.

| Menu item | When the stage is | Stage becomes | Date stamped (today) |
|---|---|---|---|
| Mark sent in Acrobat | none, Needs to be sent, Ready to be sent, Create to sign in office, Needs to be Amended | Atty Reviewing | — |
| Mark attorney signed | Atty Reviewing | Sent to Client | Contract Sent On |
| Mark client signed | Sent to Client | Needs Payment Link | Signed Contract Received On |
| Payment links → Mark sent (M21) | Needs Payment Link | Payment link sent | Payment Link Sent On |

The step table is `CONTRACT_STEPS` in `libs/query/src/pending-contracts.ts`;
the write is `apps/api/src/routes/contract-step.ts` (stage + date in one
`change_multiple_column_values`, `from` stale check, queue on outage, audited
as `monday.contract_step`).

## Payment links (LawPay)

A LawPay link is a page URL — no LawPay API. Rules (from the firm's own link
script), in `apps/web/src/lib/lawpay.ts`:

- AF and PF → `https://secure.lawpay.com/pages/scal/operating`
- FF → `https://secure.lawpay.com/pages/scal/trust`
- `?amount=<n>&readOnlyFields=reference,amount&reference=<DESCRIPTION> - <FEE> <n>`, reference in capitals

M21 makes one link per fee on the contract. The description starts as
"client name + Contract for…" and amounts from Monday's AF / PF / FF; both are
editable before copying.

How the client pays sets the amounts (since 2026-10-16): by credit card each
link carries its own 3%, debit the fee as is, cash no links — from the Fee K's
Payment Method, changeable in M21. A contract sent from the app and signed in
Adobe also gets **Email links to client**: one English + Spanish e-mail from the
staff member's own Outlook. See [esign-zapier.md](esign-zapier.md#payment-links-after-signing-decided-2026-10-16).

## Generating the contract (M22)

Decided 2026-10-05: **the templates live in SharePoint and staff maintain them
in Word** — no developer needed to change wording, fees text or layout, or to
add a contract.

- Folder: `SCALDocs / Fee Contracts / App Templates`
  (`CONTRACT_TEMPLATES_FOLDER` in `apps/web/src/sharepoint/graph.ts`). Every
  `.docx` in it is a template, named after the file. SharePoint's version
  history is the undo; the folder's permissions decide who can change what
  clients receive.
- A blank is a tag typed into the text: `Dear {{client_name}},`. The list is
  `CONTRACT_FIELDS` in `apps/web/src/lib/contract-fill.ts`, and the
  **READ ME - template fields** document in the folder. Amounts print with
  their `$`; postage prints "N/A" when empty; surcharge = 3% of AF + FF + postage (AF only until
  2026-10-14) unless typed; a one-line Monday address is split into street +
  "City, ST zip" when the template has `{{city_state_zip}}`; total = AF + FF + postage + surcharge.
- Most 2026 contracts print a "Surcharge Fee" line under **each** fee, so
  each fee has its own 3% tag (`{{attorney_fee_surcharge}}`,
  `{{filing_fee_surcharge}}`, `{{postage_fee_surcharge}}`, `{{bio_fee_surcharge}}`…;
  N/A when that fee is empty). A typed surcharge only changes `{{surcharge}}`.
  BIA appeal fees are paid in two equal halves (`{{attorney_fee_half}}`). Trial
  (2026-10-22) is not: the prep and the trial are separate fees, each with its
  own deadline — `{{trial_prep_fee}}` / `{{trial_prep_due_date}}`, `{{trial_fee}}` /
  `{{trial_due_date}}` (each with `_surcharge` / `_es`), `{{trial_total_fee}}` = both;
  several people on one contract (2026-10-22, e.g. a family at one Master
  Hearing): one fee, only the client signs and pays — and the client is NOT
  assumed to be one of the people (a relative often signs for someone
  detained). M22 shows "Contract is for more than one person" when the
  template has a `{{#people}}…{{/people}}` loop (`{{person_name}}`,
  `{{person_number}}`, `{{person_a_number}}`, `{{person_dob}}`) or
  `{{people_names}}`; ticked, staff list everyone covered (at least 2; "+ Add
  <client> (signer)" when the contract is for them too). Wrap the block in
  `{{#has_people}}…{{/has_people}}` so a one-person contract prints as before;
  `{{people_names}}` falls back to the client. The file is named
  "Client - Matter (N people) - date";
  Bond + Master Hearing has its own `{{motion_fee}}` / `{{hearing_fee}}`;
  Master Hearing + Motion (2026-10-21) adds which motion, `{{motion_name}}` /
  `{{motion_name_es}}` (a pick list in M22 fills both: `MOTIONS`), and the
  motion's FF is `{{filing_fee}}`; that contract's file is named after the motion; Court
  Application adds the DHS `{{bio_fee}}`; Trial's "signed contract by" date is
  `{{sign_by_date}}` (payment = `{{due_date}}`). Habeas (2026-10-29) has an
  optional pro hac vice clause, `{{#pro_hac_vice}}…{{/pro_hac_vice}}` with
  `{{pro_hac_vice_district}}`, `{{pro_hac_vice_fee}}` (preparing the motion) and
  `{{pro_hac_vice_filing_fee}}` (the court's), each with `_surcharge`:
  M22's "Includes a pro hac vice motion" box turns it on. The fee (set by
  Rekha with the attorney) and the court's fee are paid into Operating with the AF, so both count in
  `{{surcharge}}` / `{{total_fee}}`; M22 shows what the Fee K's AF on Monday
  (= the AF payment link) should be and flags a mismatch. Nothing is written
  to Monday.
- Scope of services (2026-10-23, approved by Michael + Rekha): every contract
  gets "Scope of Services / Alcance de los Servicios" — section 1 with its own
  initials (Rafael, same day: the old sections are 2–13, initials and Adobe
  `IntN` fields 1–13, "Sections 1 through 13", Fees = Section 3). It sits right
  before "2. Office Procedures" (after the Trial / Habeas deadline notices).
  Court templates carry it as fixed text in the Word file. FORMS prints a
  common opening ("Preparing and filing your {{form_name}} with USCIS…") plus
  `{{services}}` / `{{services_excluded}}` (+ `_es`) from the Fee K Type's
  scope in Settings → Firm → Fee K Types ("Scope…" on each row; the draft
  carries the 11 approved examples and is used until the table is saved);
  M22 shows them in a "Scope of services" box, editable for that contract,
  empty = nothing extra printed.
- **Generate contract…** lists the folder, downloads the picked template and
  checks it. Broken braces or an unknown tag (a typo) block it, with a link to
  open the file in Word. The form shows only the fields that template uses,
  pre-filled from Monday (client, e-mail, address, attorney, AF/FF, the next
  hearing from the client's court case: MCH → Master Hearing, Trial →
  Individual Hearing) and the user's initials. A field the template uses must
  be filled. Case type and hearing type are picked, not typed (2026-10-23):
  the Fee K Type(s) from the Fee K Types list (the Fee K's own pre-picked, more
  can be added) give `{{form_name}}` (Monday's label without "(c)", several
  joined with " + "), `{{form_name_es}}` (the type's Spanish name, else the
  English) and the scope; "Edit the title" types a matter not on the list.
  Hearing type = Master Hearing / Individual Hearing. The attorney is picked
  too: every active attorney on the staff roster (Settings → Staff), named as
  Settings → Documents names them (Monday's "Rekha@Sharma- com" → Rekha
  Sharma-Crawford), with the roster e-mail; the Fee K's attorney is
  pre-selected through the roster's name matcher, and picking the letter's
  signer sets Adobe's "Attorney signs first" e-mail (and back). The address (2026-10-22) is the profile's Address, else its
  Mailing address, else the Fee K's own copy (P14's "missing" flag uses the
  same order; a third of the Fee Ks since September had only a Mailing
  address). It is tidied and split by `documents/us-address.ts`
  (`letterAddress`): cities typed with no comma, a suffix glued to the city,
  a unit before the city, "KCMO", the state from the zip when missing,
  all-lowercase lines capitalised; one it can't split stays whole.
- Everything happens in the browser: the template is filled there, and the
  PDF is made by the user's Microsoft 365 (`/me/drive/…/content?format=pdf`,
  a temporary file in their OneDrive folder "Case Pipeline (temporary)",
  deleted right after). **Word** downloads the filled .docx instead. The API
  only gives the pre-fill and records `doc.contract_generated` (template name
  + fees, no client details).
- Existing drafts whose blanks are Word form fields can be converted once with
  `npx tsx scripts/tag-contract-template.ts in.docx out.docx`.

## Not done yet

- 2026-10-15: FORMS, Court Application, BIA, Bond + MCH, Interview, Trial
  and Habeas tagged from the `9-29-26` drafts (word-for-word the approved
  PDFs) into `Fee Contracts/App Templates - REVIEW`, with filled SAMPLE PDFs.
  They go live by moving them into App Templates once staff approve. Credited
  Hearing and Electronic File Copy have no Word version yet.
- Acrobat text tags at the signature and Initials lines, so Acrobat places the
  signing fields itself (to be confirmed with one test send).
- If the firm later moves to an e-signature service with an API (Acrobat Sign
  Solutions, Dropbox Sign, BoldSign…), the buttons become automatic; the step
  table and the Monday writes stay the same.
