# LawPay payments → Fee Ks

Decided 2026-10-16. Until now a payment was known from LawPay's receipt e-mail to
rafael@sharma-crawford.com. Now the app reads those receipts and updates the Fee K.
(LawPay webhooks need someone with LawPay developer access, which we don't have,
so the receipts are the source.)

## What happens

For every payment receipt whose reference is one of ours:

1. **A note on the Fee K**: "💵 LawPay payment received: Attorney fee $4,120.00 (visa). Reference: …".
2. **A Monday notification** to whoever handed out the links in M21 (e-mailed,
   texted, copied or marked sent).
3. **Slack**, event "Payment received" (Settings → Integrations).
4. When **every fee is paid**: Contract Stage → **Paid needs action** and the Fee
   K moves to the **Paid Fee Ks** group. Only when the stage was still
   "Payment link sent" / "Needs Payment Link" — a stage someone set by hand
   (HOLD, Needs Refund…) is left and the note says so. If the move fails, the
   note asks for it by hand.

A receipt the app can't tie to a Fee K → Slack **"Payment to match"**; nothing is
written to Monday. Refunds are recorded only. A second copy of the same payment
(same LawPay transaction id, or the same e-mail) does nothing.

## How it gets the receipts

1. rafael@'s Outlook rule forwards LawPay receipts to
   **importantdocuments@sharma-crawford.com** (and keeps a copy).
2. Every 10 minutes (`LAWPAY_MAIL=on`, `LAWPAY_MAIL_CRON`) the API runs
   `scripts/lawpay-mail.ts`: it reads that inbox (last 3 days, subjects with
   "Payment") as importantdocuments@ with **delegated Mail.Read** — its own
   token from the same saved sign-in the consult sweep uses, so SharePoint never
   depends on it — and prints the receipts (`apps/api/src/lawpay/email.ts`).
3. `apps/api/src/lawpay/mail-job.ts` hands them to `ingestLawPayReceipts`
   (`routes/lawpay.ts`): each e-mail is stored once (users.db `lawpay_events`,
   keyed by the e-mail's id) with only the fields read — never the card number
   or auth code — and applied.

The receipt layout (label / value lines: Account, Reference, Amount paid,
Payment method, Payment date, Transaction ID) was read from a real one on
2026-10-16; a forwarded copy reads the same.

## How a payment finds its Fee K

The reference is written by the app (`apps/web/src/lib/lawpay.ts`, read-only for
the client): `<DESCRIPTION> - <AF|PF|FF> <AMOUNT>`, e.g. `ANA LOPEZ I-212 - AF 4120`.

1. **The Fee K's code.** Since the app makes the links, it controls the
   reference: M21 ends every description with the Fee K's code — "K" + its
   Monday id in base 36, e.g. `ANA LOPEZ I-212 K8F2XQ1 - AF 4120` — so a
   receipt names its Fee K by itself, even for a link copied somewhere else.
   (`feeKCode` in `apps/web/src/lib/lawpay.ts`, read back by
   `feeKIdFromReference` in `apps/api/src/lawpay/events.ts`.)
2. **The links M21 handed out** are recorded (users.db `payment_links`, v14)
   with their exact reference.
3. Otherwise (links made by hand, or before this): a Fee K in **Pending Fee Ks**
   whose client's name appears in the reference as whole words
   ("… FOR ISAAC GONZALEZ MOLINA ADMIN FEE - AF 50"), only when exactly one does.

"Every fee paid" = every fee among the links handed out for that Fee K; with none
recorded, its AF / FF / PF on Monday. Rules: `apps/api/src/lawpay/events.ts`.

## Setup

1. Outlook rule on rafael@ (done 2026-10-16): from LawPay → forward to importantdocuments@.
2. Azure app registration `2b0a7d88-…` → API permissions → Microsoft Graph →
   Delegated **Mail.Read** (grant admin consent if the tenant requires it).
3. On the server, sign importantdocuments@ in again with mail added (device code —
   the account owner completes it):
   `docker exec -it case-pipeline-new-api-1 npm run lawpay:mail -- --login`
4. Check: `docker exec case-pipeline-new-api-1 npm run lawpay:mail` prints the
   receipts it can see (reads only).
5. `.env`: `LAWPAY_MAIL=on`, then `docker compose up -d`.

What it did:

```sql
-- users.db
SELECT id, received_at, outcome, result, reference, amount, error FROM lawpay_events ORDER BY id DESC LIMIT 10;
```
