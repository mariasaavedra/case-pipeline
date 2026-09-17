# Monday.com Platform API + Emails & Activities — Reference

Compiled 2026-09-17 from the live monday.com developer docs (pages last updated
2026-09-06) and from a read of this repo's current implementation. Two parts:

1. **What Monday's API does today** — versions, E&A model, board-structure types, limits.
2. **What this repo does today** — where each of those is used, and where it diverges.

Anything marked **[unverified]** has not been tested against the account yet.

---

## 1. API versioning — the single biggest live risk

| Version | Status as of 2026-09 |
|---|---|
| `2026-10` | Release candidate (unstable preview) |
| `2026-07` | **Current** — the default when no header is sent |
| `2026-04` | Maintenance (bug fixes only) |
| `< 2025-04` | **Deprecated and unsupported** |

Cadence: one version per quarter. RC (3mo) → Current (3mo) → Maintenance (3mo) →
deprecated. Each version is stable ≥6 months.

Behavior when you send a version string:

- **Omitted** → routed to Current (`2026-07`).
- **Deprecated** → routed to **Maintenance** (`2026-04`).
- **Non-existent** → routed to Current.

### What this means for us

`libs/monday/src/api.ts:83` pins `apiVersion: "2024-10"` and sends it as the
`API-Version` header on every request (`libs/monday/src/api.ts:271`). `2024-10`
is deprecated, so **Monday silently serves us `2026-04` semantics**. We are not
running the version we think we are, and the effective version moves on its own
as Monday retires versions — a behavior change with no commit behind it.

That alone explains a class of "it worked last month" symptoms.

---

## 2. Emails & Activities (E&A) — the data model

E&A is a monday CRM app. **Every item has its own E&A timeline.** Entries are
emails, meetings, calls, notes, and custom activities. Supported by the platform
API in `2024-10`+; the `timeline` object arrived in `2025-01`+.

### 2.1 Read one item's timeline

```graphql
query {
  timeline(id: 1234567890, skipConnectedItems: true) {
    timeline_items_page(limit: 25, cursor: null) {
      cursor
      timeline_items { id title type content created_at custom_activity_id user { id name } }
    }
  }
}
```

- **Root-only.** Cannot be nested inside `items` / `boards`. This is why we batch
  with GraphQL aliases instead of a single `items(ids: [...])` query.
- `id` is the **item** id, not a timeline id.
- **`skipConnectedItems: Boolean`** — whether to skip connected items. See §2.5;
  this is the argument that matters most for our duplicate problem.
- `timeline_items_page`: cursor pagination, **`limit` default is 25**. Max is not
  documented **[unverified]**.

### 2.2 Read one timeline item by id

```graphql
query { timeline_item(id: 1234567890) { board { id } item { name } id user { id name } title type content created_at custom_activity_id } }
```

- Root-only.
- **`type` always returns `"activity"` here.** The root `timeline_item` query
  does *not* tell you whether the entry was an email, a note, or a call. Only the
  `timeline_items_page` read and the search index expose the real kind.
- Timeline ids are **not visible in the Monday UI** — the only way to get one is
  to query it back.

### 2.3 Create / delete

```graphql
mutation {
  create_timeline_item(
    item_id: 9876543210,
    custom_activity_id: "8ca12626-…",
    title: "Migrated Email",          # required, ≤255 chars
    timestamp: "2024-06-06T18:00:30Z", # required, ISO8601
    summary: "internal company email", # ≤255 chars
    content: "…HTML…",
    location: "…", phone: "…", url: "…",
    time_range: { start_timestamp: "…", end_timestamp: "…" }
  ) { id }
}
mutation { delete_timeline_item(id: "1234567890") { id } }
```

Caveats that bite:

- **`custom_activity_id` is required and non-nullable.** You can only write under
  a *registered custom activity*. Monday's built-in "Essentials" presets
  (Meeting / Note / Call summary) have **no API-visible record** and cannot be
  targeted. Confirmed against this account — see `docs/decisions.md`, 2026-08-25.
- **Timeline items created via the API do not trigger E&A automations.** Any
  Monday automation keyed on "when a new timeline item is created" will never
  fire for our writes.
- `delete_timeline_item` takes `id` as `String!` (not `ID!`).
- There is **no `update_timeline_item`**. Correcting an entry means delete + recreate,
  which changes its id.
- Community reports an **undocumented regression**: `timestamp` was formerly
  respected as `created_at`; it reportedly no longer is. **[unverified — worth
  testing against the account, it would scramble any chronological view]**

### 2.4 Custom activities

```graphql
query { custom_activity { id name type color icon_id } }
mutation { create_custom_activity(color: SLATE_BLUE, icon_id: TRIPOD, name: "…") { id } }
```

- **Hard cap: 50 custom activities per account.** Root-only query.
- `color` is a `CustomActivityColor!` enum (18 values: `BRINK_PINK`,
  `CELTIC_BLUE`, `CORNFLOWER_BLUE`, `DINGY_DUNGEON`, `GO_GREEN`, `GRAY`,
  `LIGHT_DEEP_PINK`, `LIGHT_HOT_PINK`, `MAYA_BLUE`, `MEDIUM_TURQUOISE`,
  `PARADISE_PINK`, `PHILIPPINE_GREEN`, `PHILIPPINE_YELLOW`, `SLATE_BLUE`,
  `VIVID_CERULEAN`, `YANKEES_BLUE`, `YELLOW_GREEN`, `YELLOW_ORANGE`).
- `icon_id` is a `CustomActivityIcon!` enum.
- A `delete_custom_activity` mutation exists **[unverified — not confirmed in the
  docs page read]**.

### 2.5 The duplicate problem, and the argument that addresses it

Our schema comment (`libs/seed/src/db/schema.ts:121-125`) records the symptom
precisely: the same logical event surfaces on the profile **and** on every
connected board item, and **Monday assigns each surface a different
`monday_timeline_id`** — so a timeline-id index cannot collapse them. We worked
around it with `content_sig` (created_at + author + first 300 chars of body),
unique per profile.

The `timeline` query now takes **`skipConnectedItems: Boolean`**, which we do not
pass anywhere in the codebase (0 occurrences). If that argument does what its
name says, it is the upstream fix for the whole dedup layer — fetch only the
entries genuinely on the item, instead of fetching the rollup and hashing bodies
to undo it.

**History matters here.** On 2026-07-02 this argument was tested live against
`2024-10` and rejected with `Unknown argument` — which is exactly why
`content_sig` was built. It is documented today (docs page updated 2026-09-06).
Since our deprecated header now routes us to `2026-04`, it may already be
accepted on the version we are actually being served.

**This is the first thing to re-test.** It also interacts directly with the board
structure question: what counts as "connected" is decided by our
`board_relation` / connect-boards columns, of which `config/boards.yaml`
currently declares 261 relation/mirror/lookup column entries across 19 boards.

### 2.6 The real type taxonomy (`TimelineItemKind`)

Available as a search filter in `2026-10`+, but it is the authoritative list of
what an E&A entry can be:

`email`, `note`, `phoneCall`, `meeting`, `videoMeeting`, `activity`, `custom`,
`googleCalendar`, `outlookCalendar`, `zoom`, `aiAssistant`, `aiReply`,
`aiSummary`, `portal`, `demoEmail`, `form`, `portfolio_status`,
`sequencesEmail`, `outreachExpertPhoneCall`, `mergedTickets`,
`customInternalApp`, `campaigns`.

Our `client_updates.source_type` recognizes only
`update | reply | email | note | activity | custom`
(`libs/seed/src/db/schema.ts:140`). Everything else — calendar events, Zoom,
phone calls, forms, AI summaries — lands in whatever Monday returns and is not
modeled. **[Which kinds actually appear in this account is unverified.]**

### 2.7 Search across timeline items (`2026-10`+)

```graphql
query { search { timeline_items(query: "kickoff call", limit: 5, type: email) {
  results { id indexed_data { title summary type product_kind item_id board_id created_at } live_data { id } } } } }
```

- Filters: `query` (matches title + summary + content), `limit` (default 10,
  **max 20**), `date_range`, `board_ids`, `workspace_ids`, `item_ids`, `type`
  (`TimelineItemKind`), `product_kind` (`crm` | `service`).
- `indexed_data` is fast but can be stale; `live_data` hits the core API and is
  `null` for deleted/inaccessible/lagging entries.
- Scope needed: `boards:read`.
- Notably, `SearchIndexedTimelineItem` exposes **`updated_at`** — a field the
  `timeline_items_page` read does not appear to give us. Relevant if we ever want
  incremental E&A sync instead of full re-walks.
- Requires moving to `2026-10` (RC), so this is a "later" tool, not a fix.

### 2.8 Email sequences (`2026-04`+)

`sequences` query lists email sequences available for enrollment and lets you
enroll board items into multi-step outreach. Not used here; noted so we don't
rediscover it. Sequence-sent mail shows in E&A as `sequencesEmail`.

### 2.9 What E&A does *not* give us

- **No recipient / sender addresses as structured fields.** `TimelineItem` has
  no to/from/cc. Monday's own example embeds them as HTML inside `content`
  ("From: … <br> To: …"). There is an open community thread on exactly this.
  If the feature needs "which client address did this go to", it must be parsed
  out of `content` — brittle, and worth designing around rather than into.
- **No thread/conversation id**, no message-id, no attachment list on the type.
- **No update mutation**, and no webhook event for timeline items — the
  `WebhookEventType` list covers column/item/update events only
  (`libs/monday/src/api.ts:1064-1076`). E&A changes cannot be pushed to us; they
  can only be polled.

---

## 3. Board structure — connect, mirror, lookup

### 3.1 Connect boards (`board_relation`)

- `text` and `value` **always return `null`** for this column type. Use
  `display_value` (comma-separated names), `linked_item_ids`, or `linked_items`.
- Writing: `change_simple_column_value` is **not supported** — must use
  `change_multiple_column_values` with `{ item_ids: [...] }`.
- **You cannot connect new boards through item-level mutations.** The target
  boards must already be set in the column's own settings (`boardIds`).
- An empty `settings` object `{}` means the column has no target boards
  configured; links will fail until `boardIds` is set.
- `connection_board_ids` root query: **breaking change in `2026-07`** — argument
  renamed `connectionId` → `connection_id`, now required `ID!`, return type
  `[Int!]` → `[ID!]!`. (We do not call it today.)

### 3.2 Mirror columns

- **Read and create only.** Mirror values cannot be updated or cleared via the
  API, and **filtering on mirrored content is not supported**.
- `text` and `value` return `null`. Use `display_value` for a text summary, or
  `mirrored_items` + inline fragments on `mirrored_value` for typed access.
- Multi-level rollups (a mirror of a mirror) carry caveats **[unverified]**.

This matters for us: `config/boards.yaml` resolves many fields by `lookup_*` /
`mirror_*` column ids. Anything read through a mirror is unfilterable at the
Monday layer — it must be filtered locally in SQLite, which is what our ETL
already does, but it also means a mirror column can never be the thing we
write back to.

### 3.3 `settings_str` is deprecated

Deprecated as of **`2025-10`** in favor of a typed `settings` object. We still
parse `settings_str` in three places (`libs/monday/src/api.ts:424, 459, 747, 782`)
to get status labels and colors. It still works today; it is on a clock.

---

## 4. Users entity migration — an active breaking change

Started in `2026-07`, **completes in `2026-10`**.

- `users` with **no `limit` now returns 200 users** (previously: all of them).
  Max `limit` is 1000; higher errors.
- `kind` → replaced by **`user_kind`** (`UserKindFilterInput`).
- `newest_first` → replaced by `sort`; `non_active` → replaced by `status`
  (defaults to `[ACTIVE, PENDING]`).
- `emails` argument type tightened `[String]` → `[String!]`.
- `created_at` is now `ISO8601DateTime!`; `birthday` → `String`;
  `utc_hours_diff` → `Float`.
- **Removed in `2026-10`:** `is_guest`, `is_admin`, `is_view_only`, `is_pending`,
  `enabled`, `is_verified`, `join_date`, `photo_original`, `photo_small`,
  `photo_thumb`, `photo_thumb_small`, `photo_tiny`, `encrypt_api_token`,
  `sign_up_product_kind`. Replacements: `photo_url` (object), `kind`,
  `is_email_confirmed`, `became_active_at`.

### What this means for us

`fetchWorkspaceUsers` (`libs/monday/src/api.ts:1039`) is
`query { users(kind: non_guests) { id name email } }`:

1. It uses **`kind`**, which is deprecated in favor of `user_kind`.
2. It passes **no `limit`**, so on `2026-07`+ it silently truncates to 200 users
   and returns no error. This is the "fails silently" case the community has
   been writing about.

We are currently insulated only because our deprecated version header routes us
to `2026-04`. That insulation ends when `2026-04` retires.

---

## 5. Rate limits (all tiers, 2026-09)

| Limit | Value |
|---|---|
| Daily calls | Free/Basic/Standard 1,000 · **Pro 10,000** · Enterprise 25,000 (resets midnight UTC) |
| Complexity, single query | 5M points |
| Complexity/min, personal token | 10M combined read+write (1M on trial/free/NGO) |
| Complexity/min, app token | 5M read + 5M write |
| Requests/min | Enterprise 5,000 · Pro 2,500 · other 1,000 |
| Concurrency | Enterprise 250 · Pro 100 · other 40 |
| IP | 5,000 requests / 10 seconds |
| `items` query | 100 items per call |

Notes:

- **Failed calls count**, including rate-limited ones (at 0.1 call each).
- Every response now carries IETF **`RateLimit-Policy`** and **`RateLimit`**
  headers reporting remaining quota (`r`) and seconds to reset (`t`) for
  `minuteRate`, `concurrency`, and `complexityMinute`. Throttle on `r` rather
  than waiting for a 429.
- Rate-limit errors return a `retry_in_seconds` field.
- The **daily call limit is the one to watch for us.** Our E&A read is one
  aliased request per batch of ≤15 items, **plus one extra request per item that
  has more than one page**. A profile with a long timeline costs multiple calls
  on its own. Against a Pro tier's 10,000/day, a full re-walk of 19 boards plus
  per-item E&A pagination is a plausible way to exhaust the day — and once
  exhausted, everything fails, not just the sync.

---

## 6. What this repo does today

| Concern | Where | Notes |
|---|---|---|
| Version header | `libs/monday/src/api.ts:83,271` | Pinned `2024-10` → **actually served `2026-04`** |
| Read a timeline | `fetchTimelineBatch`, `api.ts:1190+` | Aliased `timeline(id:)` per item, batches ≤15, `pageLimit` 50, follows cursors per item. **Does not pass `skipConnectedItems`.** |
| Timeline fields read | `TIMELINE_ITEM_FIELDS`, `api.ts:1097` | `id type title content created_at custom_activity_id user{id name}` |
| Custom activities | `fetchCustomActivities`, `api.ts:1134` | id→name map for labeling `custom` rows |
| Write a timeline item | `createTimelineItem`, `api.ts:1000` | Sends `summary/content/phone/user_id`; **`user_id` is not a documented argument** — see §7 |
| Write queue op | `apps/api/src/write-queue/processor.ts:176` | `create_timeline_item` op type |
| Call Log → E&A | `apps/api/src/routes/call-log.ts:197,306` | Uses hardcoded custom activity `eac83484-…` ("Call Summary") |
| Storage | `client_updates`, `libs/seed/src/db/schema.ts:126` | One unified table for Monday updates/replies **and** E&A items, discriminated by `source_type` |
| Dedup | `content_sig`, `scripts/sync/index.ts:698` | created_at + author + body[0:300], unique per profile |
| Board/column config | `config/boards.yaml` | 19 boards, 261 relation/mirror/lookup column entries |
| Users | `fetchWorkspaceUsers`, `api.ts:1039` | `kind: non_guests`, **no limit** — 200-row truncation once we move version |
| Status labels | `api.ts:747,782` | Parses deprecated `settings_str` |

---

## 7. Open questions to resolve before changing anything

Ranked by how much they'd explain the current tangle.

1. **Does `skipConnectedItems: true` return only the item's own entries?**
   If yes, the entire `content_sig` dedup layer is a workaround for an argument
   we never passed, and the duplicate/attribution confusion has an upstream fix.
2. **What does the account actually return for `type`?**
   We model six values; Monday defines 22. A `SELECT source_type, COUNT(*)`
   against `live.db`, next to a raw sample, says which kinds we are silently
   mishandling.
3. **Is `user_id` a real argument on `create_timeline_item`?**
   It is not in the current docs, and the 2026-07-02 feasibility pass concluded
   `create_timeline_item` always attributes to the caller's token. If Monday
   ignores the argument, attribution depends entirely on the write queue handing
   the call the right personal token (`docs/decisions.md`, 2026-08-07) — and the
   argument in `api.ts:1000` is dead weight that looks like it works.
4. **Is `timestamp` still honored as `created_at`?**
   If the reported regression is real, back-dated entries (call notes logged
   after the fact) land at "now" and the timeline reads wrong.
5. **Which board relation actually defines "this E&A entry belongs to this
   client"?** With 261 relation/mirror/lookup entries across 19 boards, the
   rollup surface is large, and that surface is exactly what determines how many
   duplicate copies of one email we ingest.

Each of 1–4 is a single API call against the live account to settle.

---

## 8. Why items are "born empty" (2026-09-17)

> **Scope note.** §8.1–8.3 below are about **email** logging. The firm's actual
> concern is **activities** (the custom-activity notes: Consult note, Casenote,
> HEARING NOTES, …) — those follow different rules, covered in §8.0. Emails are
> secondary here.

### 8.0 Activities: the rollup is materialized, not a live view

An activity is logged by a person onto **one specific item**. There is no Email
column involved, so the only thing that can put it on a second item is the
connect-boards relationship.

**Monday materializes that rollup rather than resolving it at view time.**
Evidence from this account (verified 2026-07-02, recorded in
`libs/seed/src/db/schema.ts:121-125`): the same logical activity surfaced on the
profile **and** on its connected board items with a **different
`monday_timeline_id` on each surface**. Separate ids mean separate stored
records, written when the activity was logged — for the connections that existed
at that moment.

That predicts exactly the reported symptom: **connect an item after the fact and
no record was ever written for it, so it opens empty and stays empty.** Nothing
backfills.

**CONFIRMED 2026-09-17 — Model A.** The experiment in §8.6 was run: an empty item
was connected to a Profile that already had activities, and it stayed empty. The
rollup is materialized at log time. `skipConnectedItems` therefore filters
records that were already written; it does not compute the rollup on read.

### Consequences

1. **Monday will never do what the firm wants.** An activity logged today reaches
   only the items connected today. No later connection — and no amount of board
   restructuring — changes an entry that was already written.
2. **An activity logged on an item with no other connection exists only there.**
   That turns the two sync gaps in §8.5 into a genuine data-loss path rather than
   an efficiency problem. See §8.7.
3. **Our `content_sig` dedup is safe for this.** It collapses one event that
   Monday wrote to several surfaces; it does not drop an activity that exists on
   only one surface.
4. **Backfilling into Monday is possible but not advisable.** Replaying history
   onto a new item means one `create_timeline_item` per entry: it duplicates
   records in Monday, re-attributes authorship to the calling token, fires no E&A
   automations, and may not honour the original timestamp (§2.3).

### 8.7 What Model A makes urgent

Under Model A, `case-pipeline` is the only place a complete per-client history can
exist — Monday structurally cannot hold one. That is already what `client_updates`
is for. The gap is coverage, and it is ours to close:

Both figures below are measured against **production** (2026-09-17), not the
local mirror:

- **Fee Ks are never fetched** — **1,666** contracts carry a `monday_item_id`
  and **0** appear in `board_items`, so the sync's item list never includes
  them and `fee_ks` has no row at all in the per-board E&A counts. The
  2026-07-02 pass found contracts held the richest timelines in the account
  (18–25 entries each). Under Manual Association an activity logged on a
  contract exists *only* there, so those notes are absent from the dashboard
  and from every other board.
- **1,766 of 8,671 board items are skipped** by the `profile_local_id != ''`
  filter. (An earlier draft said 6,728 of 13,643 — that was the stale local
  copy.) `client_updates` is keyed by profile and some boards have no profile
  link by design, so closing this one needs a schema decision, not just a
  wider query.

Closing both is what turns the dashboard into the unified view staff are
currently hopping between boards to assemble by hand.

### 8.1 Email logging — what Monday matches on

Per [Emails & Activities: how it works](https://support.monday.com/hc/en-us/articles/12428852177810-Emails-Activities-how-it-works),
an email is logged onto an item in exactly three cases:

1. It was sent from **that item's** E&A composer.
2. The thread contains both an address in **that item's Email column** and a
   connected E&A mailbox (sender, recipient, cc or bcc — any Email column on the
   item counts).
3. The thread contains both an address in the Email column of a **connected
   item** and a connected E&A mailbox.

Logging happens **when the mail is sent or received**. It is an event-time
match against the items that exist at that moment. Nothing in the documentation
describes retroactive attachment, and the article's language throughout is about
what "we will stop logging" going forward. **[The absence of backfill is an
inference from the docs, not a tested fact — see §8.4.]**

Exceptions worth knowing:

- An address used in **more than 250 Email columns account-wide stops being
  logged at all.** With 3,187 profiles this is not close today, but a shared
  intake address (e.g. an office inbox) pasted into a column across boards could
  cross it.
- An address that is itself a connected E&A mailbox is never logged as a contact.
- Deleting an email thread from one item's timeline **removes it from every item
  in the account** where it was logged.

### 8.2 Only one board in this workspace has an Email column

From `board_columns` in `live.db`:

| Board | Email-ish column | Type |
|---|---|---|
| `profiles` | `E-mail`, `E-mail 2` | **`email`** ✅ |
| `appointments_wh/lb/m/r` | `Email` | `text` |
| `_fa_jail_intakes` | `POC Email` | `text` |
| `fee_ks`, `court_cases`, `motions`, `foias`, `litigation`, `rfes_all`, `nvc_notices`, `address_changes`, `_cd_open_forms`, `_na_originals_cards_notices`, `calendaring` | `E-mail` / `E-Mail` / `Email - Profiles` | `mirror` |

A **`mirror` is not an Email column**, and neither is `text`. Rule 2 can
therefore only ever fire on `profiles`. Every other board depends entirely on
rule 3 — being connected to a Profile at the moment the mail arrives.

In our mirror, 63,186 of 82,876 E&A rows sit on the profile itself — but **do not
read that as 76% of activity living on profiles.** The sync builds its item list
profiles-first (`scripts/sync/index.ts:619-639`), and `content_sig` dedup keeps
whichever surface is inserted first, so the profile surface always wins. The
per-board counts below measure insertion order as much as reality.

### 8.3 Consequence

A board item created **after** a conversation happened was not connected to
anything when that mail was logged, so rule 3 never fired for it. It opens
empty, and no amount of connecting it afterwards backfills the history. Staff
then go to the Profile to read the notes — which is the reported behaviour.

### 8.4 What is not yet explained

E&A row counts per board in `live.db`:

```
(profile itself) 63186   appointments_lb 4232   motions 3100   court_cases 2686
_na_originals    2573    appointments_m  2523   appointments_wh 1579
rfes_all 795   nvc_notices 704   appointments_r 478   foias 463
litigation 279   address_changes 242   appeals 22   _lt_i918b_s 12   calendaring 2
fee_ks 0   _cd_open_forms 0   _fa_jail_intakes 0   call_log 0
```

**Superseded 2026-09-17.** This section originally reported `_cd_open_forms` as
holding *zero* E&A entries. That was read from the stale local `live.db`.
Production holds **4,514** rows for that board. There is no anomaly to explain —
see `[[feedback_local_livedb_is_not_prod]]` and §10.2. Per-board counts are still
skewed by insertion order and `content_sig` dedup, so treat them as a floor on
uniqueness, never as a measure of rollup.

### 8.6 The experiment that settles it

Two models predict the same symptom and need opposite fixes:

| | Model A — materialized at log time | Model B — resolved at view time |
|---|---|---|
| Why the item is empty | No record was ever written for a connection that did not exist yet | The connection exists but E&A does not traverse *this* one |
| Fix | Change *when* items get created/connected, or write the activity onto the item too | Fix the connect column — direction, or which column carries the link |
| Backfill possible? | Only by re-creating entries via `create_timeline_item` | Nothing to backfill; it would appear once traversal is right |

**Test, ~5 minutes, no code:** take a board item that is currently empty, and
connect it to a Profile that already has activities. Refresh.

- Activities appear → **Model B.** The problem is the connect column on the
  boards where it fails, and it is fixable in the workspace.
- Still empty → **Model A.** New items can never inherit history, and the fix is
  either process (create the item before the work happens) or code (write the
  activity onto every connected item ourselves via `create_timeline_item`).

Run it on a board that fails (`_cd_open_forms` has 798 items and zero entries)
and, as a control, on one that works (`appointments_lb`, 4,232 entries).

### 8.5 Two gaps that are ours, not Monday's

1. **Fee Ks are never fetched for E&A at all.** The sync builds its item list
   from `profiles` + `board_items` (`scripts/sync/index.ts:619-639`), but
   contracts live in their own `contracts` table — 1,654 rows, all with a
   `monday_item_id`, none in `board_items`. The 2026-07-02 feasibility pass found
   contracts had the **richest** timelines in the account (18–25 entries each).
   That is roughly 30,000 entries we have never once requested.
2. **6,728 of 13,643 board items are excluded** by the `profile_local_id != ''`
   filter on the same query — 49% of board items, concentrated in `call_log`
   (5,479) and `_fa_jail_intakes` (885, none linked).

Neither is visible as an error: both produce a clean run that simply asks for
less than it should.

---

## 9. Manual timeline associations — the real mechanism (2026-09-17)

Monday's own feature name for this is **Manual timeline association**
([support article](https://support.monday.com/hc/en-us/articles/35433150651154-Manual-timeline-associations),
last modified 2026-05-19). It settles §8 officially.

> **"If I add a new connection between two records, will old timeline items
> appear on the newly connected record?"** — *"No. Timeline items are saved at
> creation time. Changing connections later does not move existing items."*

### 9.1 Associations are not "off" — the item was never a candidate

A useful distinction. The composer **pre-selects** every record the note can
reach and you *deselect* to unlink, so association is on by default. A board item
created later was simply not in existence when the note was written, so it was
never offered. There is no toggle to switch on; there is a link to **add**, one
note at a time, via *Manage Associations* on each timeline item.

### 9.2 Which records are candidates

A record can be linked when any one of these is true:

1. It shares an **email or phone number** that appears on the timeline item.
2. It is **directly connected through a Connect Boards column**.
3. It is connected through a **Mirror that reflects a Connect Boards column**.
4. It is connected through a **Mirror reflecting another Mirror** that reflects a
   Connect Boards column — **up to two levels deep**.

This is the one place where board structure genuinely decides the outcome, and
it applies to **future** notes only. Rule 4's two-level cap is a hard structural
limit worth checking against any deeply mirrored board.

### 9.3 Rules that can destroy data

- **Removing every association from a timeline item deletes it.**
- Removing the link to the record you are viewing only hides it there.
- In the composer you cannot unlink the record you are currently on.
- Replies follow the parent: a reply saves only to where the parent is linked
  *at the moment of reply*, and re-linking one email never updates the rest of
  the thread retroactively.

### 9.4 There is no API for associations

Confirmed against the full documentation index (`llms.txt`): no association page,
no association argument on `create_timeline_item`, and no `update_timeline_item`
at all. **Manage Associations is UI-only.**

So "loop over every note and associate the new item" cannot be scripted. It is
manual, per note, per item — and on an entry with 100+ notes it is exactly as
impractical as it looks.

Availability: **Pro and Ultimate plans, still rolling out gradually.** Worth
confirming which tier this account is on before relying on the feature at all.

### 9.5 Structure is not what is failing here

`_cd_open_forms` (798 items, **zero** E&A entries) has **three** separate
`Profiles` Connect Boards columns. `appointments_lb` (4,232 entries) has one
(`link to Profiles`). Both satisfy candidacy rule 2, so the connect structure is
not the discriminator.

The discriminator is **when the item is born**. Appointment entries exist at the
moment of the consult, so notes are written while they are live candidates. Open
Forms are created weeks later, after the conversations they need have already
been saved elsewhere. No column change fixes that.

Hygiene note, separate issue: three columns all named `Profiles` on one board is
worth cleaning up — each is an independent candidacy path and a source of
confusion for staff.

---

## 10. "It used to work" — what changed (2026-09-17)

Rafael reports that later-created items **used to** pick up a profile's existing
notes, and that this stopped. That is consistent with everything above: the
behaviour described in §8 and §9 is **new**, not original.

### 10.1 The documented timeline

| When | Change |
|---|---|
| Before | Association was **computed from connections**. A timeline item was surfaced on whatever was connected *at view time*, so connecting an item later made history appear on it. |
| **December 2025** | The **"Item related activities" filter was removed.** It had let you "filter and view activities across your monday CRM account that were related to the email address for your item." Replaced by a **Current item** filter, which only appears when items are connected to the current one. |
| **2026 (gradual)** | **Manual timeline association** rolls out to **Pro and Ultimate** accounts. Links are now **fixed at creation**. Support article last modified 2026-05-19 and still describes the rollout as in progress. |

So the model flipped from *computed* to *stored*. Under the old model a later
connection retroactively surfaced history; under the new one nothing moves.

**Because the rollout is gradual and per-account, the date this account flipped
is not published.** Monday support can state it; we cannot derive it.

### 10.2 Why our own data cannot date it

Tempting but wrong: `_cd_open_forms` has 789 profile-linked items and zero E&A
rows, which looks like proof the rollup was already dead when we synced. It is
not. Our E&A was fetched up to 2026-07-23 with profiles inserted **first**, and
`content_sig` dedup keeps the first surface — so every Open Forms copy of a note
that also exists on its profile was collapsed away by us, not absent from Monday.

By the same logic, `appointments_lb`'s 4,232 rows are the activities that exist
**only** on the appointment item and never reached the profile at all. The
per-board counts measure uniqueness, not rollup. `live.db` cannot answer this
question in either direction.

### 10.3 Tested live against the account, 2026-09-17 — Model A confirmed

Read-only `timeline` probes with the account token. **The rule is: an item sees
only entries created after the item itself.**

Six most recently created `_cd_open_forms` items, each against its connected
Profile's timeline:

| Item created | Item's own timeline | Connected profile |
|---|---|---|
| **2026-09-17 15:27** "Test Entry" | **0 — empty** | has history, newest 2026-09-03 |
| 2026-09-16 22:44 | 3 entries, newest 2026-09-17 15:52 | same newest |
| 2026-09-16 21:58 | 1 entry, newest 2026-09-16 22:43 | same newest |
| 2026-09-16 13:16 | 3 entries, newest 2026-09-16 19:00 | profile newest is *older* (2026-08-25) |
| 2026-09-15 22:49 | 2 entries | profile newest 2026-09-07 |
| 2026-09-15 15:28 | 5 entries, newest 2026-09-17 16:00 | same newest |

Every item that looks "fine" is fine because the notes arrived **after** it was
created — its newest entry matches the profile's. The one item created today,
whose profile's history predates it, is **empty**. That is the reported symptom,
reproduced exactly.

**A misleading first result, worth recording.** The first probe used Open Forms
item `9665251094`, which returned the profile's complete timeline — 50 entries
back to 2025-08-12, byte-identical to the profile's own. That item was created in
**2025**, before those notes. An old item inheriting nothing and an old item
seeing everything look the same from the API; only the item's own creation date
distinguishes them. Always compare against `created_at`.

Two side results from the same probes:

- **E&A logging is healthy.** Across 20 active profiles, entries land as recently
  as today. The 8-week gap in `live.db` is entirely our stalled sync (§1, §8.7),
  not Monday.
- **`skipConnectedItems` is accepted but had no effect** — `true` and `false`
  both returned 50 entries on the same item. Consistent with §9: there is no
  computed rollup left to skip.
- `API-Version: 2024-10` returned `INTERNAL_ERROR` on one profile's timeline
  where the current version succeeded. Another reason to stop pinning it (§1).

### 10.4 The flip date: between 2026-05-20 and 2026-05-26

150 `_cd_open_forms` items walked newest-first, each asked whether its timeline
contains anything created **before the item itself**, broken down by type.

| Item created | Pre-creation entries |
|---|---|
| **on or before 2026-05-20** | Genuine deep history — e.g. an item created 2026-05-04 carrying activities from 2025-11-21; one created 2026-05-14 with 16 activities back to April |
| **after 2026-05-20** | Only ever a *single* entry, logged **4–9 minutes before** the item, always at a rounded half-hour |

That second pattern is not inheritance. Those are **scheduled** activities
(consults/meetings) whose timestamp is the booked slot — `2026-09-03T00:00:00Z`
logged just before the item was created at `00:06:11Z`. A timestamp artifact,
nothing more.

Strip those out and the cliff is clean:

- **Latest genuine inheritance:** item created `2026-05-20T19:54:24Z`, carrying
  custom entries from 2026-05-19 and an activity from 2026-05-07.
- **Earliest confirmed non-inheritance:** `2026-05-26T18:42:42Z`.

Items created in between are inconclusive (their first 50 entries are all newer,
so the question needs deeper paging).

**Conclusion: the account flipped to Manual Association in the week of
2026-05-20 to 2026-05-26.** Monday's Manual timeline association support article
was last modified 2026-05-19. Since that week, a newly created item inherits
**nothing** — no notes, no activities, no emails — from before its own creation.

Totals across the 150: 195 email, 142 activity, 15 custom, 15 note pre-creation
entries, essentially all of them on items created before the cliff.

### 10.5 The cheap test that can

One API call against the live account. Pick an Open Forms item that is connected
to a Profile with a long note history, and read its timeline:

```graphql
query { timeline(id: <open_form_item_id>) {
  timeline_items_page(limit: 25) { cursor timeline_items { id type title created_at } } } }
```

- Returns the **profile's** notes → computed rollup is still on for this account,
  and something else is responsible for the empty items.
- Returns **nothing** → the account has flipped to Manual Association, and §9 is
  the whole story.

Run the same query against an `appointments_lb` item as a control.

### 10.6 Worth raising with Monday

This is their feature change, on a Pro/Ultimate feature, mid-rollout. Support can
confirm the flip date for the account and say whether any migration or bulk
re-association tooling exists — which is the only thing that would make
recovering the existing history practical, given there is no API (§9.4).

---

## Sources

- [Timeline (E&A)](https://developer.monday.com/api-reference/reference/timeline-ea)
- [Timeline item](https://developer.monday.com/api-reference/reference/timeline-item-ea)
- [Timeline other types](https://developer.monday.com/api-reference/reference/timeline-other-types)
- [Custom activity](https://developer.monday.com/api-reference/reference/custom-activity)
- [Search](https://developer.monday.com/api-reference/reference/search) · [Search other types](https://developer.monday.com/api-reference/reference/search-other-types)
- [Versioning](https://developer.monday.com/api-reference/docs/api-versioning) · [Major user entity update](https://developer.monday.com/api-reference/changelog/major-user-entity-update)
- [Rate limits](https://developer.monday.com/api-reference/docs/rate-limits)
- [Connect boards](https://developer.monday.com/api-reference/reference/connect) · [Mirror](https://developer.monday.com/api-reference/reference/mirror)
- [Sequences](https://developer.monday.com/api-reference/reference/sequences)
