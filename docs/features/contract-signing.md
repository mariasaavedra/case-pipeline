# Contract signing and payment links (P14)

## Why it works this way

The firm signs contracts in **Acrobat Pro**. Acrobat Pro has no API — only
Acrobat Sign Solutions / enterprise does — so the app can't send a contract
for signature or hear back when it's signed. Decided 2026-10-05: keep Acrobat
Pro (≈40 contracts a month), and make the app the place staff **record** each
step, so P14 shows where every contract is and Monday gets the dates.

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
  their `$`; postage prints "N/A" when empty; surcharge = 3% of AF (2026
  rule) unless typed; total = AF + FF + postage + surcharge.
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

- FORMS template: the Word file in `9-29-26` is an older draft than its
  approved PDF (empty header, no amounts) — needs the approved Word version.
- Acrobat text tags at the signature and Initials lines, so Acrobat places the
  signing fields itself (to be confirmed with one test send).
- If the firm later moves to an e-signature service with an API (Acrobat Sign
  Solutions, Dropbox Sign, BoldSign…), the buttons become automatic; the step
  table and the Monday writes stay the same.
