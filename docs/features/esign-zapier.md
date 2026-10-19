# Contracts to Adobe Sign through Zapier

## Why it works this way

Decided 2026-10-14. The firm got Adobe Sign, but only reachable **through
Zapier**: Zapier's Adobe Acrobat Sign app has no raw "API Request" action. So the
app talks to three Zaps instead of to Adobe. The manual Acrobat Pro flow
([contract-signing.md](contract-signing.md)) still works. The ⋯ menu steps stay,
for contracts sent by hand.

## The flow

1. P14 → ⋯ → **Generate contract** (M22). Pick the template; it is picked
   automatically when the folder holds only one. The attorney's e-mail comes from
   Settings → Documents (matched by name), the client's from Monday. Both can be
   edited.
2. **Preview PDF** makes the PDF and shows it in the window. Staff check every
   page, then **Send for signature** from the preview. Send exists only there,
   and it sends that exact PDF, so what was checked is what the client gets.
   **← Back to edit** drops the preview; any change makes a new one. From the
   preview, **Download PDF** is still there for contracts sent by hand.
3. The browser posts that PDF to
   `POST /api/contracts/:id/esign`. The API keeps it in `data/esign/` behind a
   random link that is valid for 3 days, and calls **Zap 1**. Then it moves the
   stage to **Atty Reviewing** and posts a note on the Fee K.
4. Adobe emails the attorney. When they sign, the stage becomes **Sent to Client**
   and Contract Sent On is stamped, with a note.
5. The client signs. The stage becomes **Needs Payment Link** and Signed Contract
   Received On is stamped, with a note. The sender gets a **Monday notification**
   and a **Slack** message. The signed PDF goes onto the Fee K's file column, or
   the client profile's Files column if the Fee K has none, **and into the
   client's E-File** (else their consult folder), in their Fee K folder
   (below). A note on the Fee K says where it went, or why it couldn't (no
   E-File or Consult File link, link broken) so staff file it by hand.
   Every note in this flow also goes into the **client profile's Emails &
   Activities** as a "Contract note" (titles: Contract sent for signature /
   signed by the attorney / signed / rejected / expired / recalled).
6. Rejected, expired or recalled: a note, a Monday notification and Slack. **The
   stage is not changed**, so a person decides what comes next. A new send is
   then allowed.

One open agreement per Fee K: to resend, recall it in Adobe first.

**File names** (decided 2026-10-15): `Client name - Form(s)/Matter - MM-DD-YYYY`,
e.g. `Ana LOPEZ - I-212 - 10-15-2026`, from M22's Client name, Form(s)/matter
and Letter date (`contractDocumentName` in `apps/web/src/lib/contract-fill.ts`).
A bilingual title keeps its English half, capped near 80 characters. The same
name is used for the download, Adobe's document, the agreement (`… [CP-12]`,
which is also the client's e-mail subject) and the signed copy.

**The E-File copy** (`scripts/esign-efile.ts`, started by the API after Zap 3):
the profile's E-File link — else its Consult File link, since a client often
signs before staff open the E-File (2026-10-19) — → the client's existing
fee-contract folder, whatever
its spelling (`FEE Ks`, `FEE K's`, `Fee K's`, `FEEKs`…, else `Contracts`), and a
new `FEE Ks` only when there is none (`scripts/sharepoint/fee-k-folder.ts`). It
never creates the client folder. Same file name already there = already filed.
Uses the Graph sign-in the consult sweep uses. Check where one would go, writing
nothing: `npm run esign:efile -- --profile=<mondayId> --dry-run`.

| Adobe event | `esign_agreements.status` | Contract step |
|---|---|---|
| Zap 1 reports back | out_for_signature | none (Atty Reviewing was set at send) |
| Attorney signed (participant 1) | attorney_signed | `attorney_signed` |
| All signed | signed | `client_signed` (plus `attorney_signed` first if that event was missed) |
| Rejected / Expired / Recalled | rejected / expired / recalled | none |

Rules: `apps/api/src/esign/events.ts`. Routes: `apps/api/src/routes/esign.ts`.
Repeated events (Zapier retries, overlapping triggers) are no-ops.

## Where each person signs: Adobe text tags in the Word templates

Adobe only knows where to put a signature, initials, a date or an address box
from **text tags** typed into the contract. Without tags, it adds a signature
page at the end. M22 shows a yellow warning when that will happen.

Staff type the tags into the Word templates in `Fee Contracts/App Templates`,
in the spot where each field belongs. `signer1` is the **attorney** (signs
first) and `signer2` is the **client**.

| Where in the contract | Type this |
|---|---|
| Attorney signature | `{{Sig_es_:signer1:signature}}` |
| Client signature | `{{Sig_es_:signer2:signature}}` |
| Client initials (each page / clause) | `{{Int_es_:signer2:initials}}` |
| Date the client signs (filled by Adobe) | `{{Dte_es_:signer2:date}}` |
| Date the attorney signs | `{{Dte_es_:signer1:date}}` |
| Client's printed name (filled by Adobe) | `{{N_es_:signer2:fullname}}` |
| Box the client must type in, e.g. address | `{{*Address_es_:signer2        }}` |
| Same, optional | `{{Phone_es_:signer2        }}` |

Tips:
- The **width of the tag is the width of the field**. Add spaces before the
  `}}` to make a box wider, as in the address row above.
- `*` at the start makes a field **required**.
- Each text box needs its own name (`Address_es_`, `Address2_es_`…). Two boxes
  with the same name show the same value.
- Our own fields (`{{client_name}}`…) keep working next to these. The app passes
  any tag containing `_es_` through untouched (`isAdobeSignTag` in
  `apps/web/src/lib/contract-fill.ts`).
- Make the tag text white or tiny if you don't want it visible before Adobe
  places the field. Adobe draws the field over the tag.

Test a template once by sending it to your own two e-mails before staff use it.

## Server settings (.env)

```
ZAPIER_ESIGN_HOOK_URL=https://hooks.zapier.com/hooks/catch/…   # Zap 1, step 1
ZAPIER_ESIGN_SECRET=<openssl rand -hex 24>
API_URL=https://app.ra-codel.com                               # already set
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/…           # optional
```

The button only shows when the hook URL, the secret and API_URL are all set. `npm run check:env` checks them.

The receiver URL used in Zaps 1–3 is `https://app.ra-codel.com/api/webhooks/zapier/<ZAPIER_ESIGN_SECRET>`.

## The Zaps

### Zap 1: Send

1. **Webhooks by Zapier → Catch Hook.** Copy its URL into `ZAPIER_ESIGN_HOOK_URL`.
   The app sends: `ref`, `agreementName`, `pdfUrl`, `fileName`, `attorneyEmail`,
   `clientEmail`, `clientName`.
2. **Adobe Acrobat Sign → Upload a Document to Get Document ID.**
   File = `pdfUrl`. File name = `fileName`.
3. **Adobe Acrobat Sign → Create an Agreement From Uploaded Document.**
   - Document ID = from step 2
   - Agreement Name = `agreementName`. **Keep it as-is:** the `[CP-12]` in it is
     how events find their contract.
   - Order 1 = `1`, Participant Role 1 = SIGNER, Participant Email 1 = `attorneyEmail`
   - Order 2 = `2`, Participant Role 2 = SIGNER, Participant Email 2 = `clientEmail`
4. **Webhooks by Zapier → POST** to the receiver URL. Payload Type = json. Data:
   - `event` = `sent`
   - `ref` = `ref` (from step 1)
   - `agreementId` = the agreement id from step 3

### Zap 2: Status

1. **Adobe Acrobat Sign → Agreement State Changed.**
2. **Webhooks by Zapier → POST** to the receiver URL. Payload Type = json. Data:
   - `event` = the trigger's event name (for example AGREEMENT_ACTION_COMPLETED)
   - `agreementId` = Agreement ID
   - `agreementName` = Agreement Name
   - `participantEmail` = the email of the participant who acted

### Zap 3: Signed copy

1. **Adobe Acrobat Sign → Agreement Signed by All Participants.**
2. **Adobe Acrobat Sign → Create a PDF of Signed Agreement.** Agreement ID = from step 1.
3. **Adobe Acrobat Sign → Find Form Field Data of Agreement in JSON Format** (a
   search step). Agreement ID = from step 1. Added 2026-10-16: it carries the
   client's Credit / Debit / Cash pick (the `PayMethod` radio buttons).
4. **Webhooks by Zapier → POST** to the receiver URL. Payload Type = json. Data:
   - `event` = `signed_pdf`
   - `agreementId` = from step 1
   - `agreementName` = from step 1
   - `pdfUrl` = the file from step 2
   - `formData` = the form data from step 3 (the whole JSON; the app finds the
     PayMethod field in it, whatever its shape — `payMethodFrom` in
     `apps/api/src/esign/events.ts`)

## Payment links after signing (decided 2026-10-16)

Only for contracts sent from the app (M22) and signed by everyone in Adobe.

1. Zap 3's `formData` → the client's pick fills the Fee K's **Payment Method**
   (`CREDIT Card - Surcharge Applies` / `DEBIT Card` / `Cash`) when it's empty;
   a label staff set (e.g. `SPLIT PAYMENTS`) stays and the note flags the
   difference. Credit also sets off the Fee K auto-fill's 3% surcharge columns.
   A note on the Fee K says the links are ready (or, for cash, that none are
   needed). Repeats are no-ops.
2. P14 → ⋯ → **Payment links** (M21) shows how the client pays and the links:
   by credit card **each link carries its own 3%** (AF + 3% and PF + 3% into
   Operating, FF + 3% into Trust; the user's choice over a separate surcharge
   link), debit the fee as is, cash no links.
3. **Email links to client** — the one-click check while this is new: staff see
   the amounts and a preview, then the app sends one English + Spanish e-mail
   (`apps/web/src/lib/payment-email.ts`) **from the staff member's own Outlook**
   (Microsoft Graph `/me/sendMail`, kept in their Sent Items) to the address the
   client signed with, and records **Payment link sent** (stage + Payment Link
   Sent On). No Zapier in this step.

Setup: the app registration (client id `2b0a7d88-…`) needs the **delegated
Microsoft Graph `Mail.Send`** permission with admin consent. Each person
allows it once, the first time they press the button.

Event names the app understands (case and punctuation don't matter): the Adobe
ones (`AGREEMENT_ACTION_COMPLETED`, `AGREEMENT_WORKFLOW_COMPLETED`,
`AGREEMENT_REJECTED`, `AGREEMENT_EXPIRED`, `AGREEMENT_RECALLED`) and Zapier's
wording ("Signed by a Participant", "Signed by All Participants"). Others, such
as created or email viewed, are acknowledged and ignored.

## Slack

Slack uses an Incoming Webhook (Slack → Apps → Incoming Webhooks → pick the
channel), not a Slack bot. Its URL goes in `SLACK_WEBHOOK_URL`. The message
carries an "Open in Monday" link.

## Test before go-live

Send a contract on a test Fee K with **your own two e-mails**: one as the
"attorney", one as the "client". Then check:

- The stage changes at each step.
- Notes appear on the Fee K.
- The Monday bell arrives.
- The Slack message arrives.
- The signed PDF is attached.
