# Monday.com Write-Back

**Status:** Planned — deferred  
**Last updated:** 2026-05-25  
**Note:** `TODO(monday-write)` markers are already placed in the codebase at the relevant integration points.

---

## Goal

Allow staff to update case data directly from the dashboard — status changes, notes, rescheduling — without switching to Monday.com. Turns the dashboard from a read-only viewer into an active case management tool.

---

## Why This Matters

Currently every data update requires going to Monday.com, finding the item, and editing it there. For high-frequency actions (adding a note after a call, updating a status after a form appointment, rescheduling a hearing), this context switch adds friction and slows down operations.

---

## Target Actions (Priority Order)

### Phase 1 — High frequency, low risk
- **Add a note / update** — post a new update to a Monday.com item (same as typing in the Updates section)
- **Change status** — update the status column on Open Forms or Court Cases items
- **Mark target date met** — quick action to indicate a form was filed

### Phase 2 — Medium frequency
- **Reschedule an appointment** — change the date on a calendaring item
- **Reassign paralegal** — change the Paralegals column value
- **Upload a document** — attach a file to an item (requires Monday.com Files API)

### Phase 3 — Lower frequency
- **Create a new update/note thread**
- **Link items** (relationships between boards)

---

## Architecture

### Monday.com API

All writes go through the Monday.com GraphQL API (`libs/monday/src/api.ts`). The existing client handles auth and rate limiting — write operations just need new mutation methods added.

Key mutations:
- `change_column_value` — update any column value on an item
- `create_update` — post a note/update to an item's activity feed

### Backend

New write endpoints on the API (POST/PATCH, not GET):

```
POST  /api/items/:id/updates          — add a note
PATCH /api/items/:id/columns/:colId   — update a column value
```

These endpoints:
1. Validate the request (auth required, role check if needed)
2. Call Monday.com API
3. Invalidate / refresh the local SQLite cache for that item

### Optimistic UI

Write operations should feel instant. Update the local state immediately, sync to Monday.com in the background, roll back on failure with an error toast.

---

## Existing Markers

Search for `TODO(monday-write)` in the codebase to find all the places in the query layer and components where write-back integration points are already flagged.

---

## Open Questions

- Should writes go directly to Monday.com and then re-sync to SQLite, or write to SQLite first and queue a Monday.com sync? Direct write is simpler; queue is more resilient.
- Rate limits: Monday.com API has per-minute limits. High-frequency writes (multiple staff simultaneously) may need a write queue.
- Conflict resolution: if two people update the same item simultaneously, what wins? Monday.com's last-write-wins is probably fine to start.
- Auth: write endpoints must require authentication — this feature depends on the auth system being in place first.

---

## Dependencies

- **Auth system** — write endpoints must be authenticated; anonymous writes are not acceptable
- **Live data sync** — write-back is only meaningful with real data
