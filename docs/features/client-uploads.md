# Client Uploads (upload link)

**Status:** Step 1 built (links + public upload, files kept locally); steps 2–5 to do · **Last updated:** 2026-10-21

---

## Goal

Clients send us documents easily, from their phone, straight into their E-File. Staff stop forwarding WhatsApp photos and e-mail attachments into SharePoint by hand.

**Upload-only.** The client never sees, lists or downloads anything in their E-File, not even what they themselves uploaded. A forwarded or leaked link lets someone *send* files to us, nothing more.

Out of scope here: showing case status, and downloading client copies (the CC folder). That's a separate feature (B), which will reuse the links and the client page from this one.

---

## How it works

1. **Staff create a link.** Client page / P6 case card → "Upload link" → pick the language → the link is created and shown, with **Copy** and **Text it** (the existing M28 click-to-send, a new "Upload link" template with `{{link}}`).
2. **The client opens it.** `https://<host>/u/<token>`: firm name, "Send us your documents", the client's **first name only** (so they know it's theirs), Spanish/English toggle. Big buttons: **Take a photo** / **Choose files**. Optional "What is this?" pick (ID / passport, USCIS or court notice, evidence, other) and a short note. A progress bar per file, a retry on failure, then "Received ✓ — you can close this page or send more".
3. **The server keeps the file.** It checks the file and saves it under `data/uploads/` right away, so the client never waits on SharePoint.
4. **A filing job moves it to SharePoint.** It goes into `CAF` inside the client's E-File, else their consult folder: the same choice Drive intake makes (`pickLink` / `openClientFolder` in `scripts/drive/destination.ts`). It creates the subfolder if it's missing, and renames on a name clash, never overwrites.
5. **Staff are told, once per batch** (10 minutes after the client's last file):
   - an Update on the Monday profile: "📤 Client uploaded 3 documents" + each file's SharePoint link and kind;
   - a Slack post to `SLACK_EVENTS_CHANNEL` (new notify event `client_upload`, switchable in Settings → Integrations).

---

## Pieces

### Data (main DB, schema v37)

Main DB, next to `esign_agreements` (v33) and `mail_scans` (v24), because both are tied to a profile's `local_id`.

`upload_links`
| Column | Notes |
|---|---|
| `id`, `profile_local_id`, `profile_monday_id` | Monday id kept so a re-seed / re-sync can re-attach |
| `token_hash` | SHA-256 of the token. The token itself is only shown to staff once, at creation, and in the SMS |
| `language` | `es` / `en`: the page's default |
| `created_by`, `created_at`, `expires_at` | default 30 days; staff can extend |

**One active link per client.** Creating a new link revokes the client's current one (`revoked_by` = the new link's creator), in the same transaction.
| `revoked_at`, `revoked_by` | |
| `last_used_at` | |

`client_uploads`
| Column | Notes |
|---|---|
| `id`, `link_id`, `received_at` | |
| `original_name`, `stored_name`, `size`, `content_type`, `sha256` | `sha256` drops the same file sent twice on one link |
| `kind`, `note` | from the client page |
| `sharepoint_item_id`, `sharepoint_url`, `filed_at`, `filed_where` (`E-File` / `Consult File`) | step 1 stamp |
| `notified_at` | step 2 stamp (Monday update + Slack) |
| `attempts`, `last_error` | |

Each step is stamped separately, like `drive_intake_files`, so a retry only redoes what failed.

### API

Staff (behind `requireAuth`, audited `upload_link.*`):
- `POST /api/profiles/:id/upload-links` `{language, days?}` → `{url, expiresAt, replaced}`. Revokes the client's current link, if any. The only response that contains the token.
- `GET /api/profiles/:id/upload-links`: links + what came in on each (name, kind, size, filed where, SharePoint link).
- `DELETE /api/upload-links/:id`: revoke. `PATCH` extends.

Public (registered **before** the `/api/` `requireAuth` catch-all, like `registerEsignPublicRoutes`):
- `GET /api/u/:token`: `{firstName, language, firm}` or 404 for unknown / expired / revoked. One 404 for all three, so nobody can probe for valid tokens.
- `POST /api/u/:token/files?name=&type=&kind=&note=`: raw body, one file per request (same pattern as `POST /api/mail/scan`), so a dropped connection loses one file, not the batch.

Rules on every upload:
- **Allowed:** PDF, JPEG, PNG, HEIC/HEIF, TIFF, DOC/DOCX. Checked by the file's **first bytes**, not its name or the browser's `type`.
- **Size:** 50 MB per file, 200 files / 1 GB per link.
- **Rate limit** per token and per IP (e.g. 60 uploads / 10 min). No dependency needed; an in-memory window is enough at this volume.
- **File name:** cleaned the same way as `safeFileName` in `routes/esign.ts`, and saved as `YYYY-MM-DD <Kind> - <original>` (e.g. `2026-10-21 Notice - IMG_4412.jpg`).
- The audit log records `client_upload.received` with link id, size and kind. No file names, which can contain client details.

### Filing job

`scripts/client-uploads.ts` (`npm run uploads:file`) uses the SharePoint sign-in that Drive intake and `esign:efile` already use (`graphAuthFromEnv`). The API **spawns** it, as `esign/efile.ts` does: after each batch goes quiet, plus every 15 min as a sweep for retries. `--dry-run` by default, `--apply` to write.

- Destination: `pickLink(E-File, Consult File)` → `openClientFolder` → find (any capitalisation) or create `CAF` → `uploadFile(..., "rename")` (handles the 20 MB scans with an upload session).
- A client with **no folder recorded yet** = `waiting`. After 24 h waiting, a Slack ops post: "3 uploads for <client> have nowhere to go: set their E-File".
- A local copy is deleted 30 days after it's filed. Unfiled copies are never deleted.

### Client page

Its own Vite entry (`apps/web/upload.html` + `src/upload/`), **not** a route inside the dashboard. That keeps MSAL, the staff code and the API client out of what clients download, and keeps the page small for slow phones.
- Phone-first, works at 360 px, no account, no cookies.
- `<input type="file" accept="image/*,application/pdf,..." multiple>` plus a `capture` button for the camera.
- Uploads 2 files at a time, shows each one's progress, retries a failed one.
- All text in one `es` / `en` table. Spanish wording to be checked by staff.
- The server needs a rule so `/u/*` serves `upload.html`. To check: the production proxy / static setup when building.

### Staff UI

- "Upload link" button on the client page header and the P6 case card → modal: language, Create, Copy, **Text it** (opens the existing SMS send with the template pre-filled).
- Client page → Documents: "Received from client" list (date, kind, file → SharePoint), and the active links with Revoke / Extend.

### Config

- `CLIENT_UPLOADS=on` turns on the public routes and the job. Off by default, like `DRIVE_INTAKE`.
- Uses `API_URL` for the link. `check-env.ts` errors if `CLIENT_UPLOADS=on` and `API_URL` is localhost in a production build.
- Seed data: links work, files are stored, the filing job never writes to SharePoint.

---

## Build order

| # | Step | Estimate |
|---|---|---|
| 1 | Schema v37 + link create/revoke + public GET/POST with checks, rate limit, local storage + tests | 1.5 days |
| 2 | Filing script + spawn/sweep + Monday update + Slack event + tests | 1 day |
| 3 | Client page (separate entry, es/en, camera, progress) | 1.5 days |
| 4 | Staff modal + SMS template + "Received from client" list | 1 day |
| 5 | Deploy behind `CLIENT_UPLOADS=on`, trial with 2–3 real clients picked by staff | 0.5 day + 1–2 weeks of use |

About **5–6 days** of build, then the trial.

---

## Decisions (2026-10-21)

1. **Subfolder:** `CAF`, inside the E-File (else the consult folder). An existing folder named `CAF` in any capitalisation is reused.
2. **Links:** one active link per client at a time; a new one replaces the old. 30 days unless extended.
3. **Who creates links:** all staff.
4. **Google Drive consult folders stay** as they are. Revisit once the trial shows how useful upload links are.

## Risks

- **Malware.** Files are type-checked by content, and SharePoint Online scans uploads for known viruses. To confirm: whether the firm's Microsoft 365 plan blocks infected files from being downloaded. Staff open uploads from SharePoint, never from the app.
- **Wrong client.** A link is tied to one profile. Staff have to send it to the right number; the SMS send already shows the client's name and number before sending.
- **The SharePoint sign-in lapses** (~90 days unused). Files wait locally, nothing is lost, and the ops channel reports the job failing. Same as Drive intake today.
