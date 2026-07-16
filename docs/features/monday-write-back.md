# Monday.com Write-Back

**Status:** Partially built — notes ship; column writes pending
**Last updated:** 2026-07-15
**Note:** `TODO(monday-write)` markers are already placed in the codebase at the relevant integration points.

---

## Goal

Allow staff to update case data directly from the dashboard — status changes, notes, rescheduling — without switching to Monday.com. Turns the dashboard from a read-only viewer into an active case management tool.

---

## Why This Matters

Currently every data update requires going to Monday.com, finding the item, and editing it there. For high-frequency actions (adding a note after a call, updating a status after a form appointment, rescheduling a hearing), this context switch adds friction and slows down operations.

---

## What already exists (as of 2026-07-15)

Two of the original blockers are gone — a future implementer starts from here, not from zero:

- ✅ **Auth** — Azure AD SSO is live; every `/api/*` route is authenticated and roles exist. The old "depends on auth" blocker is resolved.
- ✅ **Write queue** — `apps/api/src/write-queue/processor.ts` exists, with retry, restart recovery, and per-user attribution. The "direct vs queued" open question was answered: **queued**.
- ✅ **Notes (`create_update`)** — `POST /api/profiles/:localId/updates` posts to Monday and falls back to the queue on failure. `libs/monday/src/api.ts` → `createUpdate()`.
- ✅ **Audit log** — `apps/api/src/audit/log.ts`; `monday.update_posted` is already recorded. New write actions should record here too.
- ⬜ **Column writes** — `WriteOpType` already declares `change_column` and `reschedule`, but the processor does **not** implement them. `libs/monday/src/api.ts` has **no `change_column_value` mutation yet**. This is the actual remaining work.

---

## Target Actions (Priority Order)

### Phase 1 — High frequency, low risk
- ✅ **Add a note / update** — done.
- ⬜ **Change status** — update the status column on Open Forms or Court Cases items. *(See "North Pole snooze" below — the first concrete consumer.)*
- ⬜ **Mark target date met** — quick action to indicate a form was filed.

### Phase 2 — Medium frequency
- ⬜ **Reschedule an appointment** — change the date on a calendaring item.
- ⬜ **Reassign paralegal** — change the Paralegals column value.
- ⬜ **Upload a document to a Monday item** — needs the Monday Files API. *(Note: uploading to the client's **SharePoint** folder is already shipped and unrelated — see the Documents tab.)*

### Phase 3 — Lower frequency
- ⬜ **Create a new update/note thread**
- ⬜ **Link items** (relationships between boards)

---

## Requested features waiting on write-back

### 1. North Pole snooze — status + return date in one step

**Requested:** 2026-07-15.

**What the user wants:** when a case is put in North Pole *from the dashboard*, immediately prompt for the return date; if none is given, default to **today + 2 weeks**. Then write both values to Monday.

**Behaviour:**
1. User picks status → `Send to North Pole` on an Open Forms case.
2. A dialog asks for the return date, **pre-filled with today + 14 days**.
3. On confirm, write **both** columns in one mutation:
   - `status` = `Send to North Pole`
   - `north_pole_until` = the chosen date (Monday column `date_mkxmma1k` on `_cd_open_forms`, already mapped in `config/boards.yaml`)

**Implementation note — write both atomically.** Use Monday's `change_multiple_column_values` rather than two `change_column_value` calls. Setting the status first and the date second can fail halfway and leave a case in North Pole *with no return date* — which is precisely the bug this feature exists to prevent. One mutation, or none.

**⚠️ Known limitation — read this before selling it as the fix.** This only covers status changes made **from the dashboard**. Today the team changes statuses **in Monday**, where we cannot prompt for anything (we only learn about it at the next nightly sync). So the dialog is a convenience, **not** the safety net. The real guarantee is a **Monday automation**:

> *When status changes to "Send to North Pole", set `north_pole_until` = today + 14 days.*

That covers every path (Monday web, mobile, our app, automations) with no code. The dashboard dialog then just lets the user override the default with a real date.

**Evidence this matters (measured 2026-07-15, on 8 live North Pole cases):**
- 4 had an **expired** `north_pole_until` — by 8, 12, 142 and **320 days**. They should have resurfaced long ago; nobody noticed.
- 1 had **no return date at all** → it would be invisible forever under a status-only hide rule.
- 4 also had an overdue `target_date` (one by 288 days).

The "temporarily hidden → permanently forgotten" failure mode is not hypothetical here; it is already happening. Any design that hides by status alone makes it worse.

**Read-side rule (independent of write-back — implement first):**
- Hide from working lists **only while `north_pole_until` is in the future**. Past the date, the case resurfaces on its own — self-healing, nobody has to remember to un-snooze.
- **No return date → do not hide.** Fail-safe; makes "hidden forever" structurally impossible. *(Once the Monday automation exists, this case stops occurring.)*
- **An overdue deadline still alerts**, North Pole or not. Snoozing a working list must never silence a real legal deadline.
- A toggle/filter reveals the hidden North Pole cases on demand.

### 2. (add future write-back-dependent requests here)

Keep this section as the landing spot for "we'd like X, but X needs write-back", so the value is visible when the project is picked up.

---

## Architecture

### Monday.com API

All writes go through the Monday.com GraphQL API (`libs/monday/src/api.ts`). The existing client handles auth, retries and rate limiting — write operations just need new mutation methods added.

Key mutations:
- `change_column_value` — update one column on an item
- `change_multiple_column_values` — update several columns atomically (**required** for North Pole, see above)
- `create_update` — post a note/update to an item's activity feed *(already implemented)*

### Backend

New write endpoints on the API (POST/PATCH, not GET):

```
POST  /api/items/:id/updates          — add a note   (exists as /api/profiles/:id/updates)
PATCH /api/items/:id/columns          — update one or more column values
```

These endpoints:
1. Validate the request (auth required, role check if needed)
2. Enqueue/perform the Monday write via the existing write queue
3. Invalidate / refresh the local SQLite cache for that item
4. Record the action in `audit_log`

### Optimistic UI

Write operations should feel instant. Update the local state immediately, sync to Monday.com in the background, roll back on failure with an error toast.

---

## Existing Markers

Search for `TODO(monday-write)` in the codebase to find all the places in the query layer and components where write-back integration points are already flagged.

---

## Open Questions

- ~~Direct write vs queue~~ → **Answered: queued.** `write-queue/processor.ts` is built and handles retry + restart recovery.
- ~~Auth~~ → **Answered: built.** Azure AD SSO; all `/api/*` routes authenticated.
- **Rate limits:** Monday's API has per-minute limits. The queue paces `create_update`; column writes must go through it too rather than firing straight from request handlers.
- **Conflict resolution:** if two people update the same item at once, Monday's last-write-wins is probably fine to start.
- **Sync staleness:** a dashboard write updates Monday, but our SQLite copy is only refreshed by the nightly sync. Either refresh the single item after a write, or accept that the dashboard shows its own optimistic value until the next sync.
- **Which statuses are writable?** Letting the dashboard set *any* status invites mistakes. Consider a whitelist of safe transitions (North Pole is the first requested one).

---

## Dependencies

- ✅ **Auth system** — built (Azure AD SSO).
- ✅ **Live data sync** — built; write-back is only meaningful with real data.
- ✅ **Write queue** — built; column ops (`change_column`, `reschedule`) are declared but not implemented.
