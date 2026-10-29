# Live checks — shipped, never tried for real

Features that are deployed but have not yet been tried against real Monday / SharePoint / Outlook / Slack. Each one is a single test, best done on the test client **Mayra TEST-TEST**. Tick it off (and delete the row once it's been green for a week) so this list stays short.

When a PR ships something that can only be checked signed-in on production, add a row here in the same PR.

Last reviewed: 2026-10-29.

## You can test these now (≈10–15 min each)

| ✓ | Feature (PR) | The test | Passed when |
|---|---|---|---|
| ☐ | Mail filing, M32 (#177) | Mail page → upload one letter for Mayra TEST-TEST → assign it to her Open Form → File | The PDF is in her E-File → `CC`, the client e-mail (EN + ES) is in your Sent folder, the note is on the Monday profile, and the Open Form has the Receipt No. |
| ☐ | Client upload link / Buzón (#161, #180) | Client header → **Upload link** → open the link on your phone → send 2 photos for one checklist document | Within ~15 min it's one PDF in E-File → `EVIDENCE …` (else `CAF`), there's one Monday update, and a Slack "client upload" post |
| ☐ | My Cases card writes, M27 (#124) | P6 → open a test case → press **Today** on Reminder sent, then change PS Stage | Both changes show on the Fee K in Monday within a minute; no item in Settings → Admin → write queue failures |
| ☐ | Link a consult to a profile, M24 (#110) | P17 → a consult with "No profile" → **Link client** | The appointment's Profiles column in Monday shows the client |
| ☐ | Motion status (#89) | P15 → Motions → set a test motion to **Granted** | Monday has Status + Dec. Date. Also note whether a Monday automation moved it to the Granted group (still unknown) |
| ☐ | Timeline history (#152) | Open any client → Timeline → click an event | The M29 panel shows "History" with names from the staff roster |

## Needs someone else first

| ✓ | Feature (PR) | Waiting on | Then |
|---|---|---|---|
| ☐ | Adobe Sign send (#125, #135, #143) | Zaps 2–3 built in Zapier, plus Zap 3's "Find Form Field Data" step | Send a test contract to yourself as client: stage moves on each signature, the signed copy lands in E-File → `FEE Ks` |
| ☐ | Buzón automatic texts (`BUZON_AUTO`) | An attorney reviews the document lists, staff check the Spanish, an admin saves Settings → Firm → Fee K Types + consult lists | Set `BUZON_AUTO=on` and `BUZON_AUTO_SINCE=<today>` |
| ☐ | LawPay on an app-made link | A real client paying a link M21 created (the reference carries the Fee K code) | The Fee K gets the note + bell, and moves to Paid Fee Ks if fully paid |
| ☐ | LawPay e-mail fallback (`LAWPAY_MAIL`) | Microsoft admin consent for Mail.Read | `npm run lawpay:mail -- --login`, then turn it on |
| ☐ | SMS at scale | A2P 10DLC registration for the firm's number | Nothing to switch; texts stop being filtered by carriers |

## Before the first time it's needed

| ✓ | Feature (PR) | The test |
|---|---|---|
| ☐ | Offboarding hand-over (#145) | Settings → Staff → a test person → reassign one test item → check its People column in Monday keeps the co-assignees |
| ☐ | Fee K Types table (#156) | An admin reviews and presses **Save** in Settings → Firm → Fee K Types (until then the contract scope text and "It will go to…" come from the draft) |
