# Buzón (client upload link, v2)

**Status:** Phases 1–5 built on branch `worktree-buzon-checklist`, not deployed · **Last updated:** 2026-10-24

**Buzón** is the name for the client upload link (`docs/features/client-uploads.md`, built Oct 21): staff popup **M30**, client page `/u/<token>` (the **Buzón page**). This doc covers the checklist and everything built on it.

---

## Goal

Once a case is paid, the client gets a Buzón with the list of documents their case needs, one Upload button per document. Files land in the E-File under `EVIDENCE <case type>`, staff are told, the Fee K shows what's in, and the client is reminded until everything has arrived.

---

## Decisions (2026-10-23)

1. **Name:** Buzón.
2. **Starts on its own:** a Fee K reaching Contract Stage **Paid needs action** (from LawPay, or set by hand in Monday) whose Fee K Type has a document list gets a Buzón with that list, and the link is **texted to the client automatically**.
3. **Reminders:** automatic, with an opt-out. Staff choose whether they run and on which days (firm default in Settings, changeable per client).
4. **Folder:** a Buzón with a document list files to `EVIDENCE <case type>` in the E-File; a plain link with no list keeps using `CAF`.
5. **Profile stamp:** an Update on the Monday profile (Profiles has no Evidence Received column). The Fee K gets its real Evidence Received date.

**This changes a rule:** until now the app never sent a text on its own (M28 = click-to-send). Points 2 and 3 are the first automatic texts; the safeguards are in `docs/decisions.md`, 2026-10-24.

---

## Phase 1: Document checklist

**Built 2026-10-23** (branch `worktree-buzon-checklist`), staff add lists by hand in M30; Phase 2 makes it automatic.

- **Document list per Fee K Type** in Settings → Firm → Fee K Types → **Documents…** (`apps/api/src/fee-k-types.ts`, `data/fee-k-types.json`): a `documents` field, each `{en, es, required}`, up to 40. Admin-only, audited, like the rest of the table. Empty list = this case type needs no evidence = no automatic Buzón (Phase 2).
- **The checklist belongs to the client, not the link** (`upload_checklist_items`, schema v39): profile, Fee K (local + Monday id), the Fee K Type it came from, label en/es, required, status `missing` / `received` / `not_needed`, received at. A new link shows the same list, so "one link per client" (2026-10-21) still holds. A Fee K's list is copied in when added, so a later Settings edit doesn't change a list a client already has; adding it twice adds nothing.
- **Buzón page:** one row per document with its own **Photo** / **File** buttons (several files per row are fine: front + back of an ID), ✓ once in, "We have X of Y" for the required ones, then "Another document?" with the old free upload. Two cases asking for the same document (Passport) = one row; a file for it marks both received.
- **Staff (M30, `UploadChecklistSection`):** **Ask for** (2026-10-26): *Evidence for a case* → any case type with a list (the client's own first; `POST …/upload-checklist/case-type`, tied to the client's Fee K of that type when there is one, else to none — files still go to its EVIDENCE folder), *Consult documents* → the appointment + a consult list, *Other* → no list (the page always takes anything, to CAF); each item's status, files and folder; **+ Ask for one more document** (with a case → its EVIDENCE folder, without → CAF); **Already have it** (`not_needed`, hidden from the client) / **Ask again** (back to `missing`, files kept); **Remove** while nothing was sent for it. Staff can't mark a document received; only a file does. API = `routes/upload-checklist.ts`, audited `upload_checklist.*`.
- **Uploads:** `POST /api/u/:token/files?item=<id>`, refused (400 `item`) for another client's document or one marked not needed. Stored as `YYYY-MM-DD <document> - <original>`, kind `evidence`, `client_uploads.item_id` (v39).
- **Filing:** an item's files go to `EVIDENCE <Fee K Type>` (`evidenceFolder`: "(c)" and SharePoint-unsafe characters out), created when missing, reused in any capitalisation. Everything else → `CAF` as before. The Monday note names each folder and the checklist documents.
- **Case cards (P13, P6):** "📤 4 of 6 documents" (required, not "not needed"), `libs/query/src/upload-checklist.ts`.
- **Privacy:** anyone holding the link sees the document names and which ones came in, never the case type, the folder or a file. Settings asks admins to keep names plain.

## Phase 2: Automatic start, stamps, reminders

**Built 2026-10-24.** Off until `BUZON_AUTO=on` + `BUZON_AUTO_SINCE`; reminders off until Settings. Code = `apps/api/src/buzon/`.

**Trigger** (`buzon/start.ts`): a Fee K whose Contract Stage became **Paid needs action** on or after `BUZON_AUTO_SINCE` — read from `item_events` (Monday webhooks: a hand change, or LawPay's own write echoed back), and LawPay also calls `buzonFeeKPaid` at once. Once per Fee K, ever (`buzon_fee_ks`, v39). The job runs every 5 min (`BUZON_CRON`).

**Steps:** no document list for its Fee K Type(s) → `no_list`, nothing else. Else the list goes on the client's checklist, the client's link is reused (when its token can be read back) or made, and `buzon_link` is texted in the client's language (Preferred Language; none = Spanish). Not texted (and staff told why, by Monday bell to the Fee K's Paralegal + Assistant and Slack `buzon`) when:
- the client is set to **No automatic texts** (M30; `buzon_client_settings`);
- Settings → Firm → Buzón texts has the automatic text off;
- `SMS_MODE=off`, or no US number on the profile (Phone, else Phone 2);
- client upload links are off.

Every text goes the M28 way (`buzon/text.ts`): RingCentral (seed = dry run), `sms_messages` (context `buzon`), E&A "Text message" on the profile (queued on an outage), audit `sms.sent` with `auto: true` — plus a `buzon_texts` row.

**When checklist files are filed** (`uploads/job.ts` `evidenceArrived`): the Fee K's **Evidence Received** (`date_mkx8stcx`) is set once, only when empty; the profile gets the usual Update, now naming the folders and documents; the Fee K's Paralegal + Assistant get a bell "X of Y received"; when every required document is in, one "sent every document" bell + Slack (`buzon_fee_ks.complete_at`).

**Reminders** (`buzon/job.ts`): Settings → Firm → Buzón texts (P11.3.7, `data/buzon-settings.json`): on / off (default off), days after the first text (default 3, 7, 14, up to 6), hours (default 9–6) and weekdays only. Per client (M30): firm default / off / their own days. A reminder goes on its day while a required document is missing and the link is active and readable, never two Buzón texts the same day, never to a client set to no automatic texts. Text = `buzon_reminder` with the link and what is missing. The first text is the Buzón's own, else a staff "Text it" from M30 (`sms_messages` context `upload_link`). After the last reminder: one bell + Slack "hasn't sent: …".

**The token** is kept encrypted (`upload_links.token_enc`, `APP_ENCRYPTION_KEY`) for every link made from now on, so reminders and Remind now can resend it. Links made before, or without the key, need a new link.

## Phase 3: Better files

**Built 2026-10-24.**

- **Several photos → one PDF** (`uploads/convert.ts`, in the filing script): photos sent for one checklist document in one batch go to SharePoint as `YYYY-MM-DD <document> - N pages.pdf` (pdf-lib, one Letter page each). Each row keeps the link; the others are marked `combined_into`. Not done: cropping / straightening.
- **HEIC → JPG** (`heic-convert`, pure JS) before filing.
- **Client notices → Alerts → Mail to review** (`buzon/notices.ts`): a file sent as "Letter from USCIS or the court" is read like scanned mail (text, else OCR), saved as a mail scan for review tied to the client, its PDF kept under `data/mail/` for M15. See `docs/decisions.md` 2026-10-24 for why this differs from M32.
- **Review queue P23** (`/client-uploads`, `ClientUploadsPage.tsx`): every client's uploads, not reviewed first; **Reviewed** / **Undo** (`client_uploads.reviewed_at`, audited). Moving or renaming stays in SharePoint.

## Phase 4: Follow-up texts

**Built 2026-10-24.**

- **"We received your documents"** (`buzon_received`, with what is still missing) once a batch has been quiet 10 min — off until turned on in Settings; never to a client set to no automatic texts.
- **Remind now** (M30, `POST /api/profiles/:localId/buzon/remind`): the reminder at once, by the staff member, allowed even for "no automatic texts" (a person decided).

## Phase 5: Buzón for consultations

**Built 2026-10-24.**

- **Consult document lists** (P11.3.8, `apps/api/src/consult-lists.ts`, `data/consult-lists.json`, admin, audited): named lists with the same editor; five starting lists (general, family petition, immigration court, detained, documents we talked about) until an admin saves.
- **Items know their consult:** `upload_checklist_items.appointment_monday_id` + `consult_list` (v39). Their files go to the client's **Consult File** (else the appointment's own consult folder, else the E-File) → `CONSULT`.
- **From reception:** **Buzón** on each consult in P17 (linked consults only) opens M30 with that consult picked; **+ Consult – … list** adds it (`POST /api/profiles/:localId/upload-checklist/consult`). Make / Text the link as usual.
- **The attorney sees what came in:** M18 (consult prep) and P4 My Day list the consult's documents with ✓.
- Google Drive consult folders stay (decision 2026-10-21); switching them off is a separate step.

## Suggested document lists

`apps/api/src/fee-k-type-documents-draft.ts`: a suggested English + Spanish list for most Fee K Types (drafted 2026-10-24 from the usual USCIS / EOIR evidence). Settings → Fee K Types offers **Use the suggested list** per type and **Fill N empty document lists**; nothing is used until an admin reviews and saves. VAWA / U / T / asylum lists use neutral words only (tested).

---

## Open questions

- **The suggested lists** (Fee K Types and consult lists) need an attorney's review, and the Spanish a staff check, before `BUZON_AUTO` goes on.
- A Fee K that reaches Paid needs action **before** its E-File exists: files wait (as today, `waiting`) and the 24 h Slack ops post covers it. Is that enough, or should the Buzón wait to be texted until the E-File is set?

## Before any of this

Run the first real test of the Oct 21 version with the "Mayra TEST-TEST" profile: make a link, upload one photo from a phone, check it lands in `CAF` and the Monday Update + Slack arrive.
