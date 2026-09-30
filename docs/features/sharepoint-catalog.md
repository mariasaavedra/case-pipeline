# SharePoint File Catalog

**Status:** Level 1 (folder index + link backfill) built — Level 2 (file catalog) not started
**Last updated:** 2026-09-30

---

## Goal

Keep a local, self-updating catalog of every file and folder in the **SCAL Consults** and **SCAL E-Files** SharePoint sites, and relate each client folder to its Monday profile. SharePoint joins Monday as a second source mirrored into SQLite: queried locally, shown in the dashboard.

## Why this matters

- **Documents without a link.** The Documents tab needs a folder link on the profile today. With the catalog it can list a client's files even when the link is missing, and faster.
- **Search across clients.** "Which clients have an I-797?", "Where did last week's EOIR notice end up?"
- **Completeness checks.** An Open Form with no receipt notice, a hearing with no evidence packet — by file name. Feeds [hearing-prep-checklist](hearing-prep-checklist.md) and [case-health-score](case-health-score.md).
- **Activity signal.** When a client's folder was last touched is a strong staleness signal.
- **Link hygiene.** Profiles missing a folder link, folders matching no profile, duplicate folders for one client.

## Out of scope

- **File contents (OCR, full text, document-type detection).** ~157k PDFs, many scanned — days of OCR and a lot of disk. Revisit later, limited to specific document types if at all.
- **Writing to SharePoint.** The catalog never creates, moves, renames or deletes anything.
- **Writing to Monday.** Backfilling missing folder links into profiles is a separate, explicitly approved step after matching is proven (see [Later](#later)).

---

## Level 1 — folder index + link backfill (built 2026-09-30)

Chosen first (2026-09-30): the biggest single win is filling missing folder links, and once they are in Monday the existing Documents tab works for those clients unchanged. The file catalog (Level 2) waits until staff say they would use cross-client search / document chips / the new-files feed.

```bash
npm run sharepoint:links -- --db=live                    # scan + plan CSV, read-only
npm run sharepoint:links -- --db=live --cached           # re-plan from the last scan
npm run sharepoint:links -- --db=live --apply --limit=10 # trial: 10 high-confidence links
npm run sharepoint:links -- --db=live --apply            # every high-confidence link
```

- **Index:** `sp_folders` (schema v28) — one row per client folder in Consults (`{year}/{letter}/*`), E-Files (`{letter}/*`) and Closed (root), with URL, year and case number parsed from the name. A folder a later scan no longer finds gets `missing_since`, not deleted.
- **Rules** (`scripts/sharepoint/profile-links.ts`): E-File by case no. + surname (**high**) or name (**medium**); Consult File by name + consult year ±1 (**high**) or name without a date (**medium**). Contradictions, look-alikes, and one folder matching two profiles → **review**, never written. Consult File is not backfilled for a client who has, or is about to get, an E-File (link-target.ts: Consult File means "consulted, not hired").
- **Writes:** `--apply` writes high only by default, only into empty columns, re-reading each column from Monday just before writing. Receipt CSV under `output/`.

### First dry run (2026-09-30, local snapshot of 2026-09-29 — rerun on the server)

13,784 client folders (Consults 6,619 · E-Files 1,942 · Closed 5,223). Scan time ~8 min, almost all of it Consults (624 year/letter listings, sequential).

| | high | medium | review |
|---|---|---|---|
| E-File | 70 | 92 | 56 |
| Consult File | 165 | 118 | 96 |

Spot-checked high rows were all correct. Medium rows include common names (`RODRIGUEZ, Luis`) and old Closed folders for people with a new consult — hence not written without a human pass over the CSV. Most review rows (116) are "given name shorter/longer" look-alikes.

## Decisions already made (2026-09-30)

| Question | Answer |
|---|---|
| Who sees the catalog? | **Everyone.** All dashboard users may see all file names, even where SharePoint would block them from that folder. Opening a file still goes through SharePoint with the user's own access. |
| Depth | **Metadata only** (Level 2): name, path, type, size, modified, modified by, URL. No contents. |
| Freshness | **Delta poll every 15 minutes.** Graph webhooks deferred. |
| Auth | The existing delegated device-code sign-in (`importantdocuments@sharma-crawford.com`) from [sharepoint-folders.md](../sharepoint-folders.md). No new permission. |

## Measured size (2026-09-30, full read-only scan)

| | SCAL Consults | SCAL E-Files | Total |
|---|---|---|---|
| Files | 66,689 | 158,464 | **225,153** |
| Folders | 14,984 | 35,108 | 50,092 |
| Storage in SharePoint | 146 GB | 604 GB | 750 GB |
| Full scan time | 3.5 min | 7.5 min | ~11 min |

- 69% PDFs; then images (~37k jpg/jpeg/png/heic) and Word (~24k).
- E-Files is growing: ~35k files modified in 2026 vs ~22k in 2022.
- **Catalog estimate: 100–150 MB** in SQLite including indexes and FTS. Server disk is at 86% — free space before Phase 1 ships.

### Site layouts

- **Consults:** `{YYYY} Consults / {A–Z} / {LASTNAME, Firstname}`. 2003–2026, **no 2008**. ~15 loose top-level folders outside the pattern (stray client folders, `Consults`, `UNKNOWN`, `FOIA` with 3.4k files, `Virtual Appointments - NEW`, `Email attachments`).
- **E-Files:** `{A–Z} / {LASTNAME, Firstname NN-NNN}` — flat, no year. Suffix is the case number (older style: 4 digits, e.g. `1243`). Non-client folders mixed in: litigation (`AILA LITIGATION`, `KCICTD2`…), `OneNote Uploads`, `M PROJECTS`.

### Monday side (local snapshot, 2026-09-29)

- 3,231 profiles. **Case No.** (`dms_number_mkkvj2ft`, config key `case_no`) filled on 1,301: 1,233 as `YYNNN` without dash (`26194`), 18 as `NN-NNN`, 9 four-digit, ~40 messy (`2024-037`, `15191?`, `DMS`, an A-number).
- 24 case numbers shared by two profiles (probably family cases).
- E-file link filled on 1,466 profiles; Consult File link on 1,028.

---

## Design

### Keeping it current

1. **First run:** full enumeration via `GET /drives/{id}/root/delta` (`$top=1000`), store every item and the final `@odata.deltaLink` per drive.
2. **Every 15 min:** call the stored delta link. Typically a few hundred changes, seconds. Save the new delta link **in the same transaction** as the item changes, so a crash re-applies instead of skipping.
3. **Change handling:**
   - New / edited item → upsert.
   - Rename or move of a folder → update it and recompute `path` for its subtree (delta does not return paths; we build them from the parent chain we store).
   - `deleted` facet → set `deleted_at`, keep the row (same archive pattern as Monday deletions).
   - `410 resyncRequired` / expired token → automatic full rescan, then continue.
4. **Throttling:** reuse `graphFetch`'s `Retry-After` handling. Never run two scans at once.
5. **Uploads from the Documents tab** upsert the returned driveItem immediately, so the uploader sees their file without waiting for the next poll.
6. **Sign-in stays alive:** each run rotates and persists the refresh token, so the ~90-day inactivity expiry never hits while the job runs.

**Why not webhooks now:** Graph change notifications on a drive expire (~29 days) and must be renewed, and still only say "something changed" — delta is needed either way. The Monday webhook receiver/processor pattern ([webhooks.md](../webhooks.md)) makes this a small follow-up if 15 min proves too slow.

### Schema (v27 → v28)

```sql
CREATE TABLE sp_drives (
  drive_id       TEXT PRIMARY KEY,
  site           TEXT NOT NULL,          -- 'scalconsults' | 'scalefiles'
  site_name      TEXT NOT NULL,
  web_url        TEXT NOT NULL,
  root_item_id   TEXT,
  delta_link     TEXT,                   -- NULL → full scan needed
  last_full_scan_at TEXT,
  last_run_at    TEXT,
  last_ok_at     TEXT,
  last_error     TEXT
);

CREATE TABLE sp_items (
  item_id        TEXT PRIMARY KEY,       -- Graph driveItem id
  drive_id       TEXT NOT NULL REFERENCES sp_drives(drive_id),
  parent_id      TEXT,
  name           TEXT NOT NULL,
  path           TEXT NOT NULL,          -- '2024 Consults/G/GARCIA, Ana/CONSULT/notes.pdf'
  depth          INTEGER NOT NULL,
  is_folder      INTEGER NOT NULL,
  size           INTEGER,
  mime_type      TEXT,
  ext            TEXT,
  web_url        TEXT NOT NULL,
  created_at_source  TEXT,
  modified_at_source TEXT,
  modified_by    TEXT,
  client_folder_id TEXT,                 -- nearest ancestor that is a matched client folder
  deleted_at     TEXT,
  synced_at      TEXT NOT NULL
);
CREATE INDEX idx_sp_items_parent  ON sp_items(parent_id);
CREATE INDEX idx_sp_items_client  ON sp_items(client_folder_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_sp_items_modified ON sp_items(modified_at_source);

CREATE TABLE sp_folder_matches (
  folder_item_id TEXT PRIMARY KEY REFERENCES sp_items(item_id),
  profile_monday_id TEXT,                -- NULL = confirmed "not a client"
  method         TEXT NOT NULL,          -- 'link' | 'case_no' | 'name_year' | 'name' | 'manual'
  confidence     TEXT NOT NULL,          -- 'exact' | 'high' | 'review'
  decided_by     TEXT,                   -- user id for 'manual'
  decided_at     TEXT NOT NULL
);

CREATE VIRTUAL TABLE sp_items_fts USING fts5(name, path, content='sp_items', content_rowid='rowid');
```

Profiles are keyed by **Monday item id**, not local id — local ids change on reseed; Monday ids are stable (same rule as watchlist / saved views).

### Matching client folders to profiles

A **client folder** is: Consults depth 3 (`{year}/{letter}/{name}`), E-Files depth 2 (`{letter}/{name}`), plus loose top-level folders shaped like `LASTNAME, Firstname`. Everything else (litigation, FOIA, General…) is tagged non-client.

In order of reliability:

1. **Existing Monday link → exact.** Resolve the profile's `e_file` / `consult_file` URL to a driveItem (`/shares/{encoded}/driveItem`, reuse `apps/web/src/sharepoint/parseLink.ts` logic). Covers ~1,466 E-files + ~1,028 consults up front.
2. **Case No. → high** (E-Files). Normalise both sides to `YY-NNN`: `26194` → `26-194`, trailing `NN-NNN` or 4-digit token from the folder name. A number shared by two profiles → `review`.
3. **Name + year → high** (Consults). Reuse `scripts/sharepoint/match.ts` (`normalizeForMatch`, `findMatch`); year must agree with `last_consult_date` ±1.
4. **Name only → review.** Never auto-accepted.
5. **Manual.** Anyone can confirm, change or mark "not a client" in the review list. A manual decision is **never overwritten** by a later run.

Matching re-runs after each delta pass for folders that are new, renamed, or still unmatched, and after each Monday sync for profiles whose name / Case No. / links changed.

### Where the code lives

| Piece | Location | Notes |
|---|---|---|
| Engine | new `libs/sharepoint` | delta scan, path building, change apply. Move `graph-client.ts`, `auth.ts`, `folders.ts`, `match.ts` here from `scripts/sharepoint/`; scripts re-import from the lib |
| Matching | `libs/sharepoint/src/match-profiles.ts` | pure functions, unit-tested with fixtures |
| Schema | `libs/seed/src/db/schema.ts` | v28 migration |
| Queries | `libs/query/src/files.ts` | client files, file search, recently changed, unmatched folders, catalog health |
| Scheduler | `apps/api/src/server.ts` | `SP_CATALOG=on`, `SP_CATALOG_CRON` (default `*/15 * * * *`, firm timezone), in-flight guard, skip while a full Monday sync runs |
| CLI | `npm run sp:catalog -- --full \| --delta \| --match \| --stats` | manual runs + first scan |
| API | `GET /api/clients/:id/files`, `GET /api/files/search`, `GET /api/files/unmatched`, `POST /api/files/folders/:id/match` (audited) | |
| Web | Documents tab, global search, "Folders to match" list, Sync Health card | Documents reads catalog first, falls back to live Graph |

### Health and failure

- `sp_drives.last_ok_at / last_error` surface in **Sync Health** and `npm run health`.
- Warning when no successful run in 1 h; hard failure after 24 h.
- Auth failure (refresh token revoked or expired) → clear message to re-run `npm run sharepoint:folders -- --login` on the server, never a silent stop.
- Catalog is derived data: if it is ever corrupt, drop the `sp_*` tables and full-scan (~11 min). It is still included in `npm run backup:live`.

---

## Phases

Each phase is its own PR. Nothing writes to SharePoint or Monday in any phase.

### Phase 1 — Engine + first scan (1–1.5 days)
- [ ] `libs/sharepoint` with delta scan + change apply + path recompute
- [ ] v28 schema (`sp_drives`, `sp_items`, FTS)
- [ ] CLI `sp:catalog --full / --delta / --stats`
- [ ] Scheduler behind `SP_CATALOG=on`
- [ ] Tests: delta apply (create, rename subtree, move, delete, resync) against stubbed Graph
- [ ] Free server disk before deploy; run first full scan on the server

**Done when:** the server catalog matches a fresh full scan's counts, and a file added in SharePoint appears within 15 min.

### Phase 2 — Matching + review (1 day)
- [ ] `sp_folder_matches` + matching passes 1–4
- [ ] Report: matched / review / non-client / orphans / profiles with no folder
- [ ] "Folders to match" list + confirm / change / not-a-client (audited)

**Done when:** every client folder is matched, in review, or marked non-client, and the report numbers are reviewed with staff.

### Phase 3 — Dashboard (1 day)
- [ ] `GET /api/clients/:id/files`; Documents tab reads the catalog, falls back to live Graph
- [ ] Files in global search (`GET /api/files/search`)
- [ ] Upload path upserts into the catalog

**Done when:** a profile with no folder link shows its files, and search finds a file by name across clients.

### Phase 4 — Health (½ day)
- [ ] Sync Health card + `npm run health` checks
- [ ] Stale-catalog warning

---

## Later

- **Backfill folder links into Monday** (`e_file` / `consult_file`) for `exact` / `high` matches — through the write queue, dry-run report first, explicit approval.
- **Completeness rules** by file name (receipt notice present per Open Form, evidence packet before hearing).
- **Consult sweep** checks the catalog before calling Graph.
- **Graph webhooks** if 15-min freshness is too slow.
- **Content extraction** for a narrow set of document types.

## Open questions

- Should `FOIA` and litigation folders be catalogued as searchable-but-unmatched, or skipped entirely?
- What happens with the missing `2008 Consults` folder — expected, or lost?
- Include other sites later (any beyond Consults / E-Files)?
