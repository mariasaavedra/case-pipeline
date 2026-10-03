# Address Changes page — P18 (2026-10-02)

**Status:** implemented 2026-10-02. Visible to admins only; it shows as under construction for everyone else (`UNDER_CONSTRUCTION_PAGES` in `Sidebar.tsx`) until the team has checked it.

The open items on the **Address Changes** board (`board_key = 'address_changes'`) as a work queue: what's paid and waiting on us, what's with the client, what's submitted, what's still unpaid. URL `/address-changes`, data `GET /api/address-changes`, query `libs/query/src/address-changes.ts`.

## Why

- The firm files a change of address only once it's paid: the board's status column is "Status - ONLY COMPLETE IF PAID".
- Once paid it's on us. The immigration court expects a change of address (EOIR-33) within 5 working days of a move, and USCIS (AR-11) within 10 days.
- If the court doesn't have the new address, the hearing notice goes to the old one. So court changes show the client's next hearing.

## Phases

| Phase | Statuses |
|---|---|
| Paid: our turn | PAID - Needs Address Change, Needs Address Change, Print and Send, Court, Attorney Approved (and any status added on Monday later) |
| With client or attorney | Form sent to client for signature, @LM Please send to Client for Sig, SENT FOR ATTY REVIEW |
| Submitted | Submitted- waiting for approval |
| Waiting on payment | LOGGED - Needs Payment - Address Change, Waiting for Payment, or no status |
| On hold | ON HOLD |
| *(leaves the queue)* | Sent Out, Not Moving Forward, Refund |

The status decides the phase, not the Monday group.

## Age (days since Date Received)

| Phase | Amber | Red |
|---|---|---|
| Our turn, with client or attorney | 7+ | 14+ |
| Submitted, waiting on payment, on hold | 30+ | 60+ |

`THRESHOLDS` in the query. Items without a Date Received have no colour.

## Next hearing

- Shown for changes going to the court: "COURT", "BOTH - COURT & USCIS", or not set.
- It's the first upcoming hearing on the client's active court case (Court Cases group "Court Case"), found **through the profile**. The board's own Court Cases link is not reliably resolved on `main`; PR #74 fixes the mapping.
- The row is marked when the hearing is within 30 days and the change isn't submitted yet.
- ECAS / Paper comes from the item, else from the court case.

## Cleanup chips

- **Unpaid 6+ months:** hidden from the list by default ("Show N unpaid 6+ months").
- **Court or USCIS not set**
- **No new address:** only on our turn or with client/attorney.
- **No date received**
- **Profile not connected**

## Status write-back

- Each row has a status picker with all of the board's labels, synced from `board_columns`. After a "Change to X?" confirm, it writes with the existing `PATCH /api/board-items/:localId/status`: personal token first, queued on outage, audited.
- Choosing **Sent Out** also writes **Date Sent** = today (`date__1`) through `PATCH /api/board-items/:localId/columns`.
- The list then reloads: a Sent Out item drops out.
- "Queued for Monday" shows when Monday was unreachable.

## On the 2026-10-02 local snapshot

- 35 open: 7 paid and waiting on us (5 of them received 37–75 days ago), 1 with client, 3 submitted, 23 waiting on payment.
- 8 of the 23 have been unpaid for 6+ months, 4 of them since 2023–24.
- No court hearings within 30 days.

## Not done yet

- Opening it to non-admins after the team checks it.
- Editing the new address or "with who" from here; the generic column route already supports it.
- Counting the 5-working-day clock from the move date: the board records Date Received, not the move date.
