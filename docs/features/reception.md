# Receptionists (P17) — consult prep + booking

**Status:** Phase 1–3 built 2026-10-02 (page, Prep popup, SharePoint picker, Book Appt from the page). Payment on booking deferred.

## Why

The receptionist team's main job is preparing appointments for the attorneys. They asked for:

1. Their own sidebar entry, **Receptionists**.
2. A **prep popup** that asks for input — pre-filled from the profile and the appointment's description — and returns a note on the client's profile.
3. A **Book Appt** button for consults that are not on a board yet.

## Decisions (from reception, 2026-10-02)

| Question | Answer |
|---|---|
| Prep fields | **Type of Appt** (dropdown): 1st time / Trial Prep / Standard Follow up / Initial Court follow up / Detained appt (asks where they are detained — pre-filled from the Det. Facility on the client's open court case, the same rule as P3.0's "Detained at …" pill; P17 tags those rows "Detained · facility") / Other (specify). **How to proceed** is a dropdown too. **How to proceed**: Phone (number) / Zoom (link) / Other (specify). **Documents**: e-file + relevant documents. **Description**. |
| One form or per type? | One form for every consult. |
| Where does the note go? | Monday **Update** on the profile **and** on the appointment (pinned there), **and** an **Emails & Activities** entry on the profile. |
| E&A type | A new **"Consult Prep Note"** type. Looked up by name in Monday; until someone creates it, entries post as the existing "Consult note". |
| Type of Appt / How to proceed storage | In the note only — no new Monday columns. |
| Edited pre-filled fields | Written back where they came from: phone → profile **Phone**; description → appointment **Description**. An emptied field is never written back (no erasing). |
| Documents | Styled links in the note. A SharePoint picker (M19) browses the client's e-file / consult folder; files can be attached or uploaded. Uploaded files are **also** attached to the profile's **Files** column in Monday. |
| No folder on the profile | Reception adds one **on demand** — never automatically. **Find or create folder** looks where the consult sweep looks (E-Files `{initial}/{LASTNAME, First}`, Closed `{LASTNAME, First}`, then `{year} Consults/{initial}/{LASTNAME, First}`) and only creates a consult folder when none exists; or a link is pasted. The link fills the empty E-File / Consult File column on save (never replaces one). Naming = `libs/core/src/consult-naming.ts`, shared with the sweep. |
| Prep is for… | Appointments that **already exist** (Calendly creates them automatically; staff add manual ones). |
| Book Appt | For appointments that don't exist yet. Reuses M10 (attorney → board, date, **30-minute slots**, description), starting with a client search. Receptionists check Outlook themselves — no availability automation. |
| Payment | Later conversation. Shown in M10 as a disabled "Needs to pay? (under construction)" checkbox. |
| Confirmation to client | Later. |
| Who sees the page | Everyone. User classes/roles are a separate project. |
| Language | English UI. |

## How it works

- **P17** (`ReceptionPage.tsx`) — `GET /api/reception/consults?from&to`: every consult on the active attorney boards (`data/attorney-boards.json`), sorted by day and time, with its latest prep from `consult_preps`.
- **M18** (`ConsultPrepModal.tsx`) — `POST /api/reception/consults/:localId/prep`. One submit, each step on the usual write rails (personal Monday token first, queued on outage, audited as `monday.consult_prepped`):
  1. Update on the profile (+ local `client_updates` copy so the timeline shows it at once)
  2. Update on the appointment, then `pin_to_top` (best-effort — a failed pin is logged, not queued)
  3. E&A entry on the profile
  4. Write-back of edited fields
  5. `consult_preps` row (schema v29) — drives "Prepped" on P17
- **M19** — the Documents tab's SharePoint browser (`DocumentsTab.tsx`) in pick mode. Uploads go to SharePoint from the browser (Graph, the user's own token); the same file is then sent to `POST /api/reception/consults/:localId/files` for the profile's Files column. Not queued: the file is already safe in SharePoint, and keeping copies of client documents on the server isn't worth it.
- **M10** — `NewAppointmentModal.tsx`, unchanged booking rules (`routes/appointment-write.ts`); new: client search when opened without a client, 30-minute slots (8:00 AM–6:00 PM), disabled payment checkbox.

## Open

- [ ] Someone with Monday admin creates the **"Consult Prep Note"** E&A type (no release needed afterward — matched by name, cached 30 min).
- [ ] Confirm `pin_to_top` on the live account (first real prep); if Monday refuses it, the note is still posted.
- [ ] Payment on booking ("Needs to pay?").
- [ ] Client confirmations (SMS / email).
- [ ] User classes (receptionist / paralegal / attorney) — separate project.
