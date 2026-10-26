---
title: Clients and the client page
section: Clients & cases
order: 10
summary: Find a client, read their notes, files and timeline, and act on their case.
routes: clients, client-detail
code: P2 · P3
updated: 2026-10-26
---

## Find a client

1. Go to **Clients** in the sidebar.
2. Type a name, e-mail, phone number or address in the search bar. The dropdown next to it searches contracts, court cases, Open Forms, motions and other boards instead.
3. Use the filters (status, attorney, board, dates) to narrow a list. **Save view** keeps a filter set for next time.
4. Click a client to open their page.

## The client page

At the top, always visible:

- **Name, contact details, A-number**, and a red **Detained at …** pill when the client is detained.
- **Watch** adds the client to your watchlist on Home.
- **Text** next to the phone number sends them a text (see [Texting clients](/manual/texting)).
- **Upload link** makes a private link the client can use to send us documents (see [Client upload links](#client-upload-links)).
- **⋯** menu: open the client in Monday.com or DMS, open their e-file or consult folder in SharePoint, copy a client summary, or **Generate document…** (G-28).

Below that, three tabs:

| Tab | What's in it |
|---|---|
| **Overview** | Every note, e-mail and activity on the client, newest first, and a box to write a new note. **Notes** hides e-mails. |
| **Timeline** | The whole case on one page. See [Case timeline](/manual/case-timeline). |
| **Documents** | The client's SharePoint folders. Open, upload, move and delete files. |

## Write a note

1. Open the client's **Overview** tab.
2. Type in the note box. Type **@** to mention a colleague.
3. Press **Post Note**. The note goes on the client's Monday profile under your name.

To answer a note, press **Reply** under it.

## Documents tab

- Click a file to preview it.
- Inside a folder: **New folder**, **Upload files**.
- Drag a file onto a folder to move it.
- The trash icon deletes a file (or an empty folder) after you confirm. It goes to the SharePoint recycle bin.
- No e-file yet? **Find or create e-file folder** finds the client's folder (or makes `E-Files / initial / LAST, First`) and saves the link on their Monday profile.

## Client upload links

The **Buzón** is a private link the client opens on their phone to send us photos and documents. Files land in their **E-File → CAF** folder (else their consult folder), and a note on their Monday profile lists what came in.

1. On the client page, press **Upload link**.
2. Pick the language for the client's page.
3. **Copy** the link, or **Text it** to the client.
4. Files they send show under **Documents → Received from client**.

The client can only *send* files. They never see what's in their folder. Making a new link turns the old one off. You can extend or turn off a link from the same popup.

### Ask for specific documents

In the same popup, **Documents to ask for** is the client's checklist. Their page then lists each document with its own **Photo** and **File** buttons, and a ✓ once we have it.

Use **Ask for** to choose what you need:

1. **Evidence for a case:** pick the **Type of case** (any type with a document list; the client's own cases come first, marked *their case*), then **Add list**. Files go to **E-File → EVIDENCE *case type***.
2. **Consult documents:** pick the consult and a consult list, then **Add list**. Files go to the **Consult File → CONSULT**.
3. **Other / whatever they want to send:** no list. The client's page always lets them send anything; those files go to **E-File → CAF**.

The document lists are set by an admin in Settings → Firm → Fee K Types → **Documents…** and Settings → Firm → Consult document lists.

- **+ Ask for one more document** adds one by hand. Pick its case so it files with that case's evidence.
- **Already have it** takes a document off the client's page. **Ask again** puts it back (a blurry photo, say).
- Files sent for a checklist document go to **E-File → EVIDENCE *case type*** (for example `EVIDENCE I-130 - Petition for Alien Relative`). Everything else still goes to **CAF**.
- The list belongs to the client, not the link: a new link shows the same list.
- Prescheduling and My Cases cards show **📤 4 of 6 documents**.

Anyone with the link can see the names of the documents on the list (never the case type or the files). Keep the names plain.

### Texts the Buzón sends on its own

When a case is paid (Fee K → **Paid needs action**), the app can put that case type's list on the client's Buzón and text them the link. Depending on Settings, it also sends reminders while documents are missing, and a "we received your documents" text.

In the same popup, under **Texts**:

- **No automatic texts for this client** stops all of these. Use it for VAWA, U visa or T visa clients, or anyone whose phone someone else may read.
- **Reminders:** the firm's days, **Off for this client**, or **Their own days** (for example `2, 5`).
- **Remind now** texts the reminder right away, with what is still missing.
- The list underneath shows every Buzón text sent to this client.

If the app couldn't text a client (no phone, switched off), the case's paralegal and assistant get a Monday notification saying why. Send the link yourself from here.

When documents arrive, the Fee K's **Evidence Received** date is filled (if empty), and its paralegal and assistant are notified. Several photos of one document go to SharePoint as one PDF, and iPhone photos as JPG.

## Released from detention

When a detained client is released:

1. Click **Released?** on the red **Detained at …** pill.
2. Add a note (required) and the release date.
3. Save. The facility is cleared on their court case in Monday, and a Casenote is added to their profile.

## Generate a G-28

1. **⋯ → Generate document…**
2. Check the pre-filled fields (attorney, client, mailing address; a detained client gets the facility address).
3. Press **Generate G-28**. It downloads and a copy is saved in the client's SharePoint folder.
