# Drive Intake

**Status:** built, off by default (`DRIVE_INTAKE=on` to schedule) · **Last updated:** 2026-10-08

## Goal

When a consult is booked through Calendly, Zapier gives the client a Google Drive folder to upload documents to (Drive is easier for clients than SharePoint). Reception then copied every upload by hand into two places:

1. the client's SharePoint folder, `CONSULT` (or `CONSULTS`) subfolder — the consult folder, or the E-File if they have one;
2. the Monday appointment item's Files gallery.

`npm run drive:intake` does both.

## The Drive tree

Owned by `scaalaw515@gmail.com` (a personal account, not Workspace). Root: **Virtual Appointments - NEW** (`1GqKBG8nFX1lSKP7DxkpK8sHOJN5VBwoe`).

```
OCTOBER / October 02, 2026 / M / 10:00 LOPEZ LEAL, Yemil / Consult Documents Yemil LOPEZ LEAL - October 02, 2026 at 10:00 / <uploads>
month     day                 attorney  slot                    upload folder (the link the client gets)
```

- **Attorney folder** = the `appointments_<initials>` board (M, LB, R, WH, CR…).
- **Slot folder** gives the surname/given split, but the given name is usually blank (`01:00 HEMZANI, `); the upload folder fills it in.
- Month folders have no year and are reused; the firm empties the tree by hand. Day folders carry the year.
- **A reschedule makes a new branch.** One client had four in October 2026. The old branches stay.

## Matching (`scripts/drive/match.ts`)

Attorney board + name + **nearest** consult date within 60 days. The Drive date is where the consult was booked when the folder was made, so it only chooses between appointments for the same person — it never rules one out alone.

- Name: every surname word and the first given-name word appear on the appointment (item name or First/Last). Accents, `[A-number]` and `(notes)` ignored.
- Two **different profiles** equally close → `ambiguous`, never guessed.
- No match → `unmatched`, re-tried every run (the Monday item may not have synced yet).

Trial on 20 real October folders against a 3-day-old local snapshot: 13 matched, 4 booked after the snapshot, 3 not in Monday under that name. No wrong matches.

## Copying

Per matched file, two independent steps, each stamped in `drive_intake_files` (schema v30) so a retry only redoes what failed:

| Step | What | Already done when |
|---|---|---|
| SharePoint | Upload into `CONSULT`/`CONSULTS` of the folder recorded on the client: **E-File → Consult File → appointment's Consult SharePoint**. Creates `CONSULT` if neither exists. Large files (20 MB TIFFs) use an upload session. | Same name and size already in the folder (reception copied it). Same name, different size → uploaded beside it, renamed. |
| Monday | One update per appointment per run — "📎 Documents the client uploaded to Google Drive (n)" — with the files attached. Update attachments show in the item's **Files gallery**, so this works on boards with no Files column (R, M, CR). | A file with the same name and size is already on the item. |

The job never creates a **client** folder: the consult sweep does that when the consult is booked. A client with no recorded folder yet is counted as *waiting* and picked up on a later run.

## Folder links

Every run also lists the **upload folders** ("Consult Documents …"), even those with nothing in them yet, matches each one to its appointment the same way (`scripts/drive/folder-links.ts`), and records it in `drive_folders` (schema v31).

- **Monday:** the link goes in the appointment's **Google Drive Folder** text column (R `text_mm7rxe19`, M `text_mm7r7pjv`, LB `text_mm7rexc6`, CR `text_mm7r98xa`; WH has none, so the link stays in the app only). It is written only when the column is empty, or when it holds an earlier booking's folder for the same appointment. A link someone typed is never replaced. The value is re-read from Monday before each write.
- **Reschedules:** one appointment can match several folders. The newest wins, because it's the one the client was sent last. The older ones are marked `superseded`.
- **M18:** Documents shows "📤 Client's Google Drive uploads". It uses the column if it's set, otherwise the newest matched folder, so the link appears before the next sync. It is not added to the prep note, because the uploads are copied into SharePoint anyway.
- **Window:** folders made since `--links-since` / `DRIVE_LINKS_SINCE`, which defaults to `DRIVE_INTAKE_SINCE`. Backfilling is harmless because nothing is copied: `npm run drive:intake -- --apply --links-since=2026-09-01`.
- Unmatched/ambiguous folders are listed for review in the receipt CSV (`folder-unmatched`, `folder-ambiguous`) and retried every run.

**Never touched:** anything in Drive (read-only scope), files uploaded before `DRIVE_INTAKE_SINCE` (reception already copied those), Google Docs/Sheets (not files), anything over 200 MB.

## Setup (once)

1. **Google Cloud** (any Google account): create a project → enable the **Google Drive API** → *IAM & Admin → Service accounts* → create one (no roles) → *Keys → Add key → JSON*.
2. Put the key on the server as `data/google-service-account.json`.
3. **As `scaalaw515@gmail.com`**, share *Virtual Appointments - NEW* with the service account's email (`…@….iam.gserviceaccount.com`) as **Viewer**.
4. `.env`:
   ```
   DRIVE_INTAKE_ROOT_ID=1GqKBG8nFX1lSKP7DxkpK8sHOJN5VBwoe
   GOOGLE_SERVICE_ACCOUNT_KEY=data/google-service-account.json
   DRIVE_INTAKE_SINCE=2026-10-05      # the day reception stops copying by hand
   ```
5. Dry run, read the plan CSV in `output/`: `npm run drive:intake`
6. Trial: `npm run drive:intake -- --apply`, check a few clients in SharePoint and Monday.
7. Schedule: `DRIVE_INTAKE=on` (default cron `*/15 7-20 * * *`, firm time zone).

SharePoint uses the same signed-in Graph token as the consult sweep; Monday uses `MONDAY_API_TOKEN`.

## Later

- Alerts group "Drive uploads to review" from `drive_intake_files` where `match_status` is `unmatched`/`ambiguous`, with a pick-the-appointment action.
