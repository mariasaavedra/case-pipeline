---
title: Contracts (Fee Ks)
section: Contracts & money
order: 10
summary: From a new Fee K to a signed, paid contract — generate, sign, send payment links.
routes: contracts
code: P14
for: billing, attorney
updated: 2026-10-29
---

**Contracts** lists every pending Fee K, grouped by **Contract Stage** in its Monday colour. The colour of the age shows how long it has waited (30 and 60 days). Click an attorney to see only theirs. **Missing info** at the top shows contracts that lack a case type, AF, attorney, e-mail or address.

## The steps of a contract

| Stage | What happens | Who |
|---|---|---|
| New | Fee K made (from a consult, or **+ New contract**) | Attorney / billing |
| Atty Reviewing | Contract generated and sent for signature | Billing |
| Sent to Client | Attorney signed | Attorney |
| Needs Payment Link | Client signed | — |
| Payment link sent | LawPay links sent to the client | Billing |
| Paid | Payment arrives → moved to Paid Fee Ks | Automatic |

## New contract

1. **+ New contract** (or from a client's page, or after a consult).
2. Pick the client.
3. Fill in the **case type**, **AF** (and FF / PF), **attorney**, client **e-mail** and **address**. All five are required. E-mail and address come from the profile and are saved back to it.
4. Save.

## Generate the contract

1. On the row, **⋯ → Generate contract…**
2. Pick the template (they live in SharePoint, *Fee Contracts / App Templates*).
3. Check the pre-filled fields.
4. **Generate PDF** or **Word**.

Generating also makes you the Fee K's **Assistant** if it has none.

### Habeas: pro hac vice motion

When the attorney has to file a pro hac vice motion (Rekha sets the fee with the attorney):

1. Tick **Includes a pro hac vice motion**. Without it, the contract prints without the pro hac vice clause.
2. Pick or type the **Federal district** (e.g. Western District of Missouri).
3. Type the **Pro hac vice fee** (preparing the motion) and the **Court filing fee** (set by the court). Both are added to the 3% surcharge and the total.
4. Both are paid into **Operating** with the attorney fee. The popup says what the AF payment link should be. If the Fee K's AF on Monday is different, fix it with **⋯ → Edit contract…** before sending the payment links.

## Send it for signature

Either:

- **Send for signature** in the Generate popup: the contract goes to Adobe Sign, attorney first, then client. The stages move by themselves as each one signs, and the signed copy is saved to the client's E-File.
- Or sign in Acrobat yourself, and record each step from **⋯**: *Mark sent in Acrobat* → *attorney signed* → *client signed*. Each asks to confirm, then moves the stage and stamps the date on Monday.

## Payment links

1. **⋯ → Payment links…**
2. One LawPay link per fee: AF and PF go to **Operating**, FF to **Trust**. Check the description and amounts.
3. **Text links to client** (or e-mail them, bilingual). Credit card adds 3% per link.
4. **Mark sent** sets *Payment Link Sent On*. A live text marks it sent for you.

When the client pays, the app reads LawPay's receipt, adds a note to the Fee K, tells whoever sent the links, and — when every fee is paid — moves it to **Paid Fee Ks** with stage *Paid needs action*.

### Split a payment

If the client's bank won't let them pay a fee all at once (a daily limit):

1. Click **Split** next to the fee. It becomes 2 equal payments; pick up to 4 in **Split into**.
2. Type an amount in one part and the others fill in the rest. The parts must add up to the fee; until they do, no links go out.
3. Send the links as usual. Each part gets its own link, labelled *Attorney fee (1 of 2)*, and the e-mail tells the client they can pay one link per day.

The Fee K stays at *Payment link sent* until every part is paid. Each payment adds a note saying how many are still to come. **Don't split** goes back to one link. If Monday's Payment Method says *SPLIT PAYMENTS*, the attorney fee opens already split in two.

## Fix a contract

Click the fees, the case type, or the *Missing:* line (or **⋯ → Edit contract…**). Change the case type, AF / FF / PF, attorney, or the client's e-mail / address. Only what you changed is written.

**⋯ → E-file / Consult file…** browses the client's folders without leaving the page.

> **Done for you:** on a card payment the 3% surcharges are filled in; for a detainee the POC name comes from the Jail Intake; "It will go to…" is filled from the Fee K Type. Only empty fields are filled.
