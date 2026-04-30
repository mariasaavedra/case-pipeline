# Plan: Centralized Client Updates & Emails/Activities

## Context
Monday.com "Updates" are scattered across every board item. We need a unified per-client timeline that pulls updates from all boards into one feed. This also covers "Emails & Activities" (activity_logs). The goal is to store them locally in SQLite following the same pattern as all other seeded/synced data.

---

## Phase 0: Real Data Sample (DO THIS FIRST)

Before building anything, fetch a small sample of **real** Monday.com data to understand the actual shape of updates/activity_logs. This avoids building against assumptions.

### What to fetch
- **10 profiles** (pick a mix: some with many cases, some with few)
- For each profile: all linked board items across all 18 boards
- For each board item: all **Updates** via `updates { id, creator { name email }, text_body, created_at, body }`
- For each board item: **Activity logs** via `activity_logs { ... }` (if accessible per-item)
- Profile-level updates (if any exist outside board items)

### How
- Write a one-off script: `scripts/sample-real-data.ts`
- Uses existing `lib/monday/api.ts` GraphQL client
- Dumps raw JSON to `data/samples/` (gitignored)
- One file per profile: `data/samples/profile-{name}.json` containing profile, items, and all updates

### What to look for
- Actual text_body format (plain text? HTML? markdown?)
- Average number of updates per item
- Whether activity_logs are per-item or per-board
- Reply threading structure (updates can have replies)
- System-generated vs human-written updates
- Duplicate patterns (same update appearing multiple times?)
- Emails & Activities: what fields exist, how they relate to items

### Outcome
After reviewing the samples, revisit the schema and factory design below. The fields and faker templates may need adjustment based on what real data actually looks like.

---

## Phase 1: Schema — new `client_updates` table (migration v3→v4)

**File:** `scripts/seed/lib/db/schema.ts`

- Bump `SCHEMA_VERSION` from 3 to 4
- New table:

```sql
CREATE TABLE IF NOT EXISTS client_updates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER NOT NULL REFERENCES seed_batches(id) ON DELETE CASCADE,
    local_id TEXT NOT NULL UNIQUE,
    monday_update_id TEXT,
    profile_local_id TEXT NOT NULL,
    board_item_local_id TEXT,
    board_key TEXT,
    author TEXT NOT NULL,
    text_body TEXT NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'update',  -- 'update' | 'email_activity'
    created_at_source TEXT NOT NULL,
    raw_json TEXT,
    sync_status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_updates_profile ON client_updates(profile_local_id);
CREATE INDEX IF NOT EXISTS idx_updates_board_item ON client_updates(board_item_local_id);
CREATE INDEX IF NOT EXISTS idx_updates_created ON client_updates(created_at_source);
```

- Dedup strategy: same author + same text_body + same calendar day (enforced at insert/sync time, not schema constraint)

> **NOTE:** Schema fields may change after Phase 0 sample review. E.g., we may need `reply_to_update_id`, `is_system_generated`, or `body_html` fields.

---

## Phase 2: Types — `ClientUpdate` interface

**File:** `lib/query/types.ts`

```typescript
export interface ClientUpdate {
  localId: string;
  profileLocalId: string;
  boardItemLocalId: string | null;
  boardKey: string | null;
  author: string;
  textBody: string;
  sourceType: "update" | "email_activity";
  createdAtSource: string;
}
```

- Extend `ClientCaseSummary` with `updates: ClientUpdate[]`

---

## Phase 3: Query layer — `getClientUpdates()`

**New file:** `lib/query/updates.ts`

- `getClientUpdates(db, profileLocalId, limit?)` → `ClientUpdate[]`
- SELECT from `client_updates` WHERE profile_local_id = ? ORDER BY created_at_source DESC
- Default limit: 50

**Edit:** `lib/query/case-summary.ts` — call getClientUpdates() and include in summary
**Edit:** `lib/query/index.ts` — re-export

---

## Phase 4: Seeder — `UpdateFactory` + Phase 6

**New file:** `scripts/seed/lib/factory/update-factory.ts`

- Follows existing factory pattern (like `BoardItemFactory`)
- 2–8 updates per profile
- ~60% linked to a random board item, ~40% profile-level only
- ~10% intentional duplicates (same author + text + day) for dedup testing
- Mix: ~80% "update", ~20% "email_activity"
- Authors from pool of ~5 staff names
- Realistic text bodies (short case notes)

**Edit:** `scripts/seed/lib/seeder/seeder.ts` — add Phase 6 after jail intakes

> **NOTE:** Faker templates will be refined after seeing real update text in Phase 0 samples.

---

## Phase 5: API handler + route

**Edit:** `lib/api/handlers.ts` — add `handleClientUpdates(req, db)`
**Edit:** `server.ts` — add route `/api/clients/:localId/updates`

---

## Phase 6: Frontend — `UpdatesTimeline` component

**New file:** `web/components/UpdatesTimeline.tsx`

- Self-contained, collapsible React component
- Props: `{ profileLocalId: string }`
- Fetches from `/api/clients/:localId/updates`
- Groups by date, shows author + source board + text + timestamp
- Color pill for source_type
- Designed standalone so it can move to a tab later

**Edit:** `web/components/ClientView.tsx` — render `<UpdatesTimeline>` at bottom
**Edit:** `web/api.ts` — add `fetchClientUpdates()` helper

---

## Phase 7: Tests

- `lib/query/query.test.ts` — getClientUpdates: returns for profile, respects limit, ordered DESC, no cross-profile leak
- `lib/api/handlers.test.ts` — handleClientUpdates: 200 valid, limit param, empty for unknown
- `scripts/seed/lib/seeder/seeder.test.ts` — Phase 6 generates updates, valid references

---

## Phase 8: Verification

- `bun run typecheck` — 0 errors
- `bun test` — all pass
- Manual: `bun --hot server.ts` → search client → see updates timeline

---

## File Summary

| Action | File |
|--------|------|
| Create | `scripts/sample-real-data.ts` (Phase 0 — one-off) |
| Edit | `scripts/seed/lib/db/schema.ts` |
| Edit | `lib/query/types.ts` |
| Create | `lib/query/updates.ts` |
| Edit | `lib/query/case-summary.ts` |
| Edit | `lib/query/index.ts` |
| Create | `scripts/seed/lib/factory/update-factory.ts` |
| Edit | `scripts/seed/lib/seeder/seeder.ts` |
| Edit | `lib/api/handlers.ts` |
| Edit | `server.ts` |
| Create | `web/components/UpdatesTimeline.tsx` |
| Edit | `web/components/ClientView.tsx` |
| Edit | `web/api.ts` |
| Edit | `lib/query/query.test.ts` |
| Edit | `lib/api/handlers.test.ts` |
| Edit | `scripts/seed/lib/seeder/seeder.test.ts` |
