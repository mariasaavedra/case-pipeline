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
  Trial and BIA appeal fees are paid in two equal halves (`{{attorney_fee_half}}`);
  Bond + Master Hearing has its own `{{motion_fee}}` / `{{hearing_fee}}`; Court
  Application adds the DHS `{{bio_fee}}`; Trial's "signed contract by" date is
  `{{sign_by_date}}` (payment = `{{due_date}}`).
- **Generate contract…** lists the folder, downloads the picked template and
  checks it. Broken braces or an unknown tag (a typo) block it, with a link to
  open the file in Word. The form shows only the fields that template uses,
  pre-filled from Monday (client, e-mail, address, attorney, AF/FF, the next
  hearing from the client's court case: MCH → Master Hearing, Trial →
  Individual Hearing) and the user's initials. A field the template uses must
  be filled.
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
