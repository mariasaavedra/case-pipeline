# UI map — names for every screen and popup

One name and one short code per screen, tab, popup and small menu in the web
dashboard. Use the code in improvement requests so everyone points at the same
thing: *"M5 Appointment detail: show the attorney's name in the header"*.

Code scheme:

| Prefix | What it is | Example |
|---|---|---|
| `P` | A page — has its own address and a sidebar link | `P4 Appointments` |
| `P#.#` | A tab or section inside a page | `P3.6 Documents tab` |
| `M` | A popup — a window over the page, closed with × or Esc | `M2 Log a call` |
| `D` | A dropdown — a small menu that opens from a button or card | `D1 Status card menu` |
| `G` | Global — on every screen, not part of one page | `G2 Top bar` |

Every code is shown in the app, in small grey text:

- **Pages and tabs** — bottom-right corner of the window (`PageCode` in
  `components/ScreenCode.tsx`; page codes in `app.tsx`, Client 360 tab codes in
  `ClientView.tsx`).
- **Sections inside a page** — after the section's heading (Settings), or on a
  small line above the section's right edge (every other page); P3.0 sits in
  the bottom-right of the Client 360 header (`SectionCode` in `ScreenCode.tsx`).
- **Popups** — just under the × button (`code` prop on `DialogContent`).
- **Dropdowns** — last line of the menu, bottom-right (`code` prop on
  `PopoverContent` / `SelectContent`, or `MenuCode` in the two custom menus).
  The plain browser selects (e.g. Settings → Preferences) draw their own menu
  and cannot carry one; their section's code covers them.
- **Global** — G1 above Settings in the sidebar, G2 next to **+ Log call**.

Everyone can hide them all: Settings → Preferences → **Show screen codes**
(saved per user; `showScreenCodes` preference, `hooks/useScreenCodes.ts`).

A browsable version with search is `docs/ui-map.html` (open it in a browser);
update both when codes change.

When a new screen or popup ships, add it here with the next free number. Never
reuse or renumber a code: old requests keep pointing at the right thing.

## Pages

| Code | Name | Address | Opened from | Component |
|---|---|---|---|---|
| P0 | Sign in | `/login` | Opening the app signed out | `pages/LoginPage.tsx` |
| P1 | Home | `/` | Sidebar → Home | `components/LandingPage.tsx` |
| P2 | Clients | `/clients` | Sidebar → Clients | `components/ClientsPage.tsx` |
| P3 | Client 360 | `/clients/:id` | A client in P2 or the top-bar search; "View 360" buttons; M3 → "Open full 360 view" | `components/ClientView.tsx` |
| P4 | Appointments | `/appointments` | Sidebar → Appointments | `components/AppointmentsPage.tsx` |
| P5 | Active Cases | `/active-cases` | Sidebar → Active Cases | `components/ActiveCasesPage.tsx` |
| P6 | My Cases | `/my-cases` | Sidebar → My Cases | `components/MyCasesPage.tsx` |
| P7 | Calendar | `/calendar` | Sidebar → Calendar | `components/CalendarPage.tsx` |
| P8 | Alerts | `/alerts` | Sidebar → Alerts | `components/AlertsPage.tsx` |
| P9 | Jail Intakes | `/jail-intakes` | Sidebar → Jail Intakes | `components/JailIntakesPage.tsx` |
| P10 | Call Log | `/call-log` | Sidebar → Call Log | `components/CallLogPage.tsx` |
| P11 | Settings | `/settings/<tab>` | Sidebar → Settings (bottom) | `pages/SettingsPage.tsx` |
| P12 | Mail | `/mail` | Sidebar → Mail | `components/MailPage.tsx` |
| P13 | Prescheduling | `/prescheduling` | Sidebar → Prescheduling (above Active Cases) | `components/PreschedulingPage.tsx` |
| P14 | Contracts | `/contracts` | Sidebar → Contracts (above Prescheduling) | `components/ContractsPage.tsx` |
| P15 | Court Cases | `/court-cases` (Docket), `/court-cases/prep` (Prep Pipeline), `/court-cases/motions` (Motions) | Sidebar → Court Cases (admins only for now) | `components/CourtCasesPage.tsx` |
| P16 | Map | `/map` | Sidebar → Map | placeholder in `app.tsx` (not built yet) |
| P17 | Receptionists | `/reception` | Sidebar → Receptionists (below Appointments) | `components/ReceptionPage.tsx` |
| P18 | Address Changes | `/address-changes` | Sidebar → Address Changes (admins only for now) | `components/AddressChangesPage.tsx` |
| P19 | FOIAs | `/foias` | Sidebar → FOIAs (admins only for now) | `components/FoiasPage.tsx` |

### Global

| Code | Name | Notes |
|---|---|---|
| G1 | Sidebar | Page links, Settings, your name and sign-out (`Sidebar.tsx`). **Customize** (above Settings) lets each user drag pages into their own order and hide ones they don't use; saved per user in `preferences.sidebarNav` |
| G2 | Top bar | Back and **+ Log call** (`app.tsx`); not on Settings |

The **Version badge** (opens M14) sits in the Home header and on Sign in
(`VersionBadge.tsx`).

### Inside P1 Home

| Code | Name | Notes |
|---|---|---|
| P1.1 | KPI cards | Six number cards. Click one → M1 |
| P1.2 | Quick access | Watchlist and recently viewed clients (`QuickAccess.tsx`) |

### Inside P2 Clients

| Code | Name | Notes |
|---|---|---|
| P2.1 | Search bar | `SearchBar.tsx` |
| P2.2 | Saved views bar | `SavedViewsBar.tsx` |
| P2.3 | Filters | `FilterBar.tsx` |
| P2.4 | Results list | `SearchResults.tsx` |

### Inside P3 Client 360

The header and snapshot sit above the tabs and stay the same on every tab.

| Code | Name | Address | Notes |
|---|---|---|---|
| P3.0 | Client header + snapshot | — | Name bar (`ClientHeaderSticky.tsx`: First + Last name, "Detained at …" pill from the open court case → M17; **Generate Doc** → M23) and four snapshot cards (`ClientSnapshot.tsx`) → D1–D4 |
| P3.1 | Overview tab | `/clients/:id` | Timeline of notes + note composer; date range → D5 |
| P3.2 | Appointments tab | `/clients/:id/appointments` | **+ Book a consult** → M10 |
| P3.3 | Contracts tab | `/clients/:id/contracts` | **+ New contract** → M11 |
| P3.4 | Active Cases tab | `/clients/:id/active_cases` | |
| P3.5 | Court Cases tab | `/clients/:id/court_cases` | |
| P3.6 | Documents tab | `/clients/:id/documents` | SharePoint files; click a file → M12 |
| P3.7 | Relations tab | `/clients/:id/relations` | |
| P3.8 | Debug tab | — | Admins only. Click an entry → M13 |

### Inside P4 Appointments

| Code | Name | Notes |
|---|---|---|
"My Day" (2026-10-07): one attorney's appointments for one day. Opens on the
signed-in attorney's board (Settings → Users → **Attorney board**, else matched
by name); the board tabs switch to another attorney.

| Code | Name | Notes |
|---|---|---|
| P4.1 | Header | Greeting, the day's summary, ‹ Today › and a date picker, one tab per attorney board ("(you)" on your own), progress bar |
| P4.2 | *Attorney boards* | Retired 2026-10-07 (the all-attorneys board view) |
| P4.3 | *Appointment list* | Retired 2026-10-07 (the list view) |
| P4.4 | The day | One row per appointment: time, client, type, Prepped / Not prepped, and Next / Needs outcome / the outcome; a "now" line. Layout follows the page's width: three columns on a laptop; on a tablet the day is a narrow column of times beside P4.5 and P4.6; on a phone the day is one screen and a client opens as the next (**← All appointments** goes back) |
| P4.5 | The client | Time · type of appt, then Zoom / phone / interpreter / detained pills (each fact once), **Open full file**; tabs **Consult prep** (who prepped and when, reception's description, Client wrote, and **Documents**: only the files reception picked in M18), **Notes**, **E-file / Consult file** (the client's SharePoint folders; a file → M12) |
| P4.6 | After the consult | **Status** → D6 (every label on the board, in Monday's colors) and **Quick outcome** buttons: Hire, No Hire, No Hire for Now, Hold for Docs, No Action Needed, Send G-review link (as the board spells them; one the board lacks is left out); both change the status at once. A **detainee consult** (prepped as "Detained appt", status "…(detainee)", or a Det. Facility on the open court case) is flagged — red **Detained** tag on its P4.4 row and a banner here — and its Hire / No Hire become **Det Hire / Det No Hire**. **Consult note** (E&A "Consult note" on the profile), **Save consult note**, which also starts the post-consult process (Consultation Summary into the client's CONSULT folder); **+ New contract** → M11 with the client picked |

### Inside P5 Active Cases

| Code | Name | Notes |
|---|---|---|
| P5.1 | Header | Open / overdue / missing-date counts |
| P5.2 | Summary table | Paralegal rows × urgency counts; click a number or a name to filter P5.3 |
| P5.3 | Case list | Filter chips (person, bucket, Only court, North Pole) + cases grouped by urgency |

### Inside P13 Prescheduling

| Code | Name | Notes |
|---|---|---|
| P13.1 | Header | Paid count, waiting 60+ days, not cooperating; colour legend |
| P13.2 | Summary table | Paralegal rows × PS Stage; cell colour = longest wait since hire; click to filter P13.3 |
| P13.3 | Case list | Filter chips (person, stage, not cooperating, North Pole) + cases grouped by days since hire |

### Inside P14 Contracts

| Code | Name | Notes |
|---|---|---|
| P14.1 | Header | Pending count, older than 60 days, not sent yet; colour legend; **+ New contract** → M11 (pick the client first) |
| P14.2 | Summary table | Attorney rows × Contract Stage; cell colour = oldest contract (days since sent, else added); click to filter P14.3 |
| P14.3 | Contract list | Grouped by Contract Stage: age, payment link, AF/FF, attorneys, assistant. Each row's **⋯** menu: **Generate contract…** → M22, **Payment links…** → M21, and the next signing step (Mark sent in Acrobat → attorney signed → client signed), which asks to confirm, then moves the stage and stamps its date on Monday |

### Inside P15 Court Cases

| Code | Name | Notes |
|---|---|---|
| P15.1 | Header + view tabs | Active count, hearings in the next 30 days, behind schedule, open motions; **Docket** / **Prep Pipeline** / **Motions** tabs; readiness legend |
| P15.2 | Filters + cleanup strip | Judge (D25), attorney (D26), paralegal (D27), hearing type chips (motion type D29 on the Motions tab); on the Motions tab the cleanup chips are motion problems (open but case closed, no court case, no filed date, no judge order, profile not connected); "Needs cleanup on Monday" chips (hearing date passed, awaiting new date, no date, profile not connected) |
| P15.3 | Summary table (Prep Pipeline) | Attorney rows × Case Prep Status; cell colour = worst readiness; click to filter P15.4 |
| P15.4 | Case list | Docket: 30/60/90/all-upcoming window, grouped by week. Prep Pipeline: grouped by stage, with a stage picker (D28) that writes to Monday after a "Move to X?" confirm. Rows tag each open motion ("MTC pending 45d", "BONDMTN to send") |
| P15.5 | Motion list (Motions tab) | Hearing within 14 days with a motion still open · To send · Waiting for the judge (60/90-day aging) · Decided in the last 30 days. Each row has a status picker (D32) that writes to Monday after a confirm; Filed / Granted / Denied ask for the date that goes with it |
### Inside P17 Receptionists

| Code | Name | Notes |
|---|---|---|
| P17.1 | Header | Consult count, not prepped count; **+ Book Appt** → M10 (pick the client first); range (Today / Tomorrow / Next 7 days), attorney and "not prepped" filters |
| P17.2 | Consult list | Grouped by day: time, client (→ M3), Calendly / language tags, attorney board, description, Prepped / Not prepped; **Edit** → M20; **Focus** → M5; **Prep** → M18 |

### Inside P18 Address Changes

| Code | Name | Notes |
|---|---|---|
| P18.1 | Header | Open count, paid and waiting on us, waiting on payment; colour legend (days since Date Received) |
| P18.2 | Filters + cleanup strip | Assistant (D30); show/hide items unpaid 6+ months; "Needs cleanup on Monday" chips (unpaid 6+ months, court or USCIS not set, no new address, no date received, profile not connected) |
| P18.3 | List by phase | Paid: our turn · With client or attorney · Submitted · Waiting on payment · On hold. Row: client (→ M3), court/USCIS + ECAS/paper, old → new address, received + age, next hearing (court changes), assistant, status picker (D31) that writes to Monday after a confirm; **Sent Out** also sets Date Sent = today |

### Inside P19 FOIAs

| Code | Section | What it holds |
|---|---|---|
| P19.1 | Header | Open count, our turn, inquiry due, done (results in the last 30 days); colour legend |
| P19.2 | Filters + cleanup strip | Paralegal (D34); show/hide items with no results 6+ months; "Needs cleanup on Monday" chips (no results 6+ months, no Filed On date, no paralegal, profile not connected) |
| P19.3 | List by phase | Do we need it? · Our turn · Waiting on the agency · North Pole. Row: client (→ M3), request numbers, agencies filed ✓ / still to file, since or filed date + age, inquiry date, paralegal(s) + attorney, status, Where to file link. Read-only |

### Inside P6 My Cases

| Code | Name | Notes |
|---|---|---|
| P6.1 | Case list | Also the "link your board identity" and "no cases" states |

### Inside P7 Calendar

| Code | Name | Notes |
|---|---|---|
| P7.1 | Controls | Month/agenda, month navigation, categories, attorney |
| P7.2 | Month grid | Click a day → M7 |
| P7.3 | Agenda | |

### Inside P8 Alerts

| Code | Name | Notes |
|---|---|---|
| P8.1 | Controls | Attorney and severity filters |
| P8.2 | Alert groups | Critical / warning / info |

### Inside P9 Jail Intakes

| Code | Name | Notes |
|---|---|---|
| P9.1 | Filters + search | Recent / older / all, name or facility search |
| P9.2 | Intake list | Click an intake → M9 |

### Inside P10 Call Log

| Code | Name | Notes |
|---|---|---|
| P10.1 | Filters | Status, taken by, unlinked only, day |
| P10.2 | Call table | Pencil → M2, notes → M4, client → M3 |

### Inside P11 Settings

Four tabs, each with its own URL (`/settings/<tab>`); `/settings` opens My account. The tabs are a column on the left (a row across the top on phones). Tabs marked *admin* only show for admins. A non-admin who opens an admin tab's link lands on My account.

| Code | Name | Where |
|---|---|---|
| P11.1 | **My account** tab | `/settings/account` |
| P11.1.1 | Profile | |
| P11.1.2 | Board identity (I am…) | |
| P11.1.3 | Monday.com connection | |
| P11.2 | **Preferences** tab | `/settings/preferences` |
| P11.2.1 | Appearance: theme, date format, sidebar, screen codes | |
| P11.2.2 | Language & start page | |
| P11.3 | **Firm setup** tab *(admin)* | `/settings/firm` |
| P11.3.1 | Attorney appointment boards | |
| P11.3.2 | Status tags | |
| P11.3.3 | Urgency | |
| P11.3.4 | Documents | Firm address/phone/fax, attorneys (email, USCIS account, bars — first is used), detention facility addresses by Det. Facility label — what M23 fills that Monday doesn't hold |
| P11.4 | **Admin** tab *(admin)* | `/settings/admin` |
| P11.4.1 | Users | Per user: paralegal name (My Cases), **attorney board** (P4 opens on it), role, disable |
| P11.4.2 | Sync health | |
| P11.4.3 | Audit log: filter by what / who / dates, grouped by day, client names link to their page | |

Codes before 2026-09-29, for old change requests: P11.1 → P11.1.1, P11.2 → P11.2.1 (Language moved to P11.2.2), P11.3 → P11.1.2, P11.4 → P11.1.3, P11.5 → P11.3.1, P11.6 → P11.3.2, P11.7 → P11.3.3, P11.8 → P11.4.2, P11.9 → P11.4.1, P11.10 → P11.4.3.

### Inside P12 Mail

| Code | Name | Notes |
|---|---|---|
| P12.1 | Drop zone | Choose a PDF, or try a sample (text or scanned/OCR) |
| P12.2 | Result filters | Matched / needs attention / no match / unreadable; OCR and separator summary |
| P12.3 | Notices + preview | One row per notice; **Review** (needs a person) or **Confirm & send** (matched) → M15; the scan's pages on the right |

## Popups

| Code | Name | Title on screen | Opened from | Component |
|---|---|---|---|---|
| M1 | KPI detail | The card's name | P1 → click a KPI card | `KpiDetailModal.tsx` |
| M2 | Log a call | "Log a call" / "Edit call" | Top bar **+ Log call** (every page); P10 → pencil on a row | `LogCallModal.tsx` |
| M3 | Client case | The client's name (360 header) | Any client name outside P2 — opens over the current page as `?client=<id>`, Back closes it (`ClientPeek.tsx`); inside M2 → "View profile" after picking a linked client (opens on top of M2); P10 → a row's client | `ClientCaseModal.tsx` |
| M4 | Call notes | "Notes — *name*" | P10 → notes on a row | `CallNotesModal.tsx` |
| M5 | Appointment detail | The client's name | P17.2 → **Focus**; M18 → "Focus view — notes & documents" (opens on top). Emails hidden until **Show emails (N)**; a note posted to several places shows once, "· also on …" | `AppointmentModal.tsx` |
| M6 | *Client notes* | — | Retired 2026-10-07 with the old P4 (notes are P4.5's Notes tab) | — |
| M7 | Day agenda | The date | P7 → click a day | `CalendarPage.tsx` (`DayModal`) |
| M8 | New jail intake | "New jail intake" | P9 → **+ New intake**. Intake status (New Detainee / Payment link sent. Waiting on payment) + optional POC e-mail — the same fields as M2's "this call is a jail intake" | `NewJailIntakeModal.tsx` |
| M9 | Jail intake detail | The detainee's name | P9 → click an intake. The status chip changes the status (D6). A paid intake ("Needs to be scheduled") shows **Book consult**: attorney + date + time → saved to Monday, then a link to press Create Appt there | `JailIntakeDetailModal.tsx` |
| M10 | Book a consult | "Book a consult" | P3.2; P17.1 **+ Book Appt** (starts with a client search). 30-minute time slots; "Needs to pay?" shown disabled (under construction) | `NewAppointmentModal.tsx` |
| M11 | New contract | "New contract (Fee K)" | P3.3; P4.6 **+ New contract**; P14.1 (starts with a client search) | `NewContractModal.tsx` |
| M12 | File preview | The file name | P3.6; P4.5 Documents; the documents section of M5 | `FilePreviewModal.tsx` |
| M13 | Entry editor | The entry's name | P3.8 (admin) | `EntryEditorModal.tsx` |
| M14 | What's new | Changelog | Version badge on P1 Home / P0 Sign in | `VersionBadge.tsx` |
| M15 | Mail review | The notice type and form | P8 → a "Mail to review" row; P12 → **Review** on a notice | `MailReviewModal.tsx` |
| M16 | Connect Monday.com | "Connect your Monday.com account" / "Reconnect…" / "Monday.com connected" | Opens by itself after sign-in when Monday isn't connected (any page but P11); **Not now** hides it for 12 h | `MondayConnectPrompt.tsx` |
| M17 | Released from detention | "Released from detention" | P3.0 → **Released?** on the "Detained at …" pill | `ReleaseDetentionModal.tsx` |
| M18 | Prep consult | "Prep consult" | P17.2 → **Prep** on a consult → D23, D24, D33. **Client wrote (Calendly)** is editable: a correction replaces the client's part of the appointment's Description (reception's part stays below; emptied = unchanged). Documents → **⋯** → D35 to change or create the client's folder. **Detained appt** → D36 detention center. **Has DMS?** (optional) → DMS URL (profile's, else built from Case No.), added to the note and saved to an empty profile DMS URL. "📤 Client's Google Drive uploads" opens the Drive folder the client was sent (Drive intake job; not added to the note) | `ConsultPrepModal.tsx` |
| M19 | Client documents | "Client documents" | M18 → **Browse SharePoint…** (the P3.6 browser in pick mode: Attach / upload) | `ConsultPrepModal.tsx` + `DocumentsTab.tsx` |
| M21 | Payment links | "Payment links" | P14.3 → ⋯ → **Payment links…**. One LawPay link per fee (AF, PF → Operating; FF → Trust), description + amounts editable; **Mark sent** (only in Needs Payment Link) sets Payment Link Sent On | `PaymentLinksModal.tsx` |
| M22 | Generate contract | "Generate contract" | P14.3 → ⋯ → **Generate contract…**. Pick a template from SharePoint `Fee Contracts/App Templates` (staff-edited Word files with `{{tags}}`); a broken template is shown with a link to fix it; only that template's fields are shown, pre-filled from Monday; **Generate PDF** (via the user's Microsoft 365) or **Word** | `GenerateContractModal.tsx` |
| M23 | Generate document | "Generate document" | P3.0 → **Generate Doc**. Pick the document (only **G-28** so far); its fields show pre-filled — attorney from P11.3.4 (the client's Monday attorney when it matches), client from Monday (mailing address split into boxes), a detained client's facility as the address with ICE + Respondent — all editable. **Generate G-28** fills the official USCIS PDF (`templates/forms/g-28.pdf`), downloads it and saves a copy in the client's SharePoint folder (e-file first). Nothing written to Monday | `GenerateDocModal.tsx` |
| M20 | Change consult | "Change consult" | P17.2 → **Edit**. Attorney, date, time; a new attorney moves the appointment to their board in Monday. Calendly is not changed (reminder shown) | `ConsultScheduleModal.tsx` |

## Dropdowns

| Code | Name | Opened from | Component |
|---|---|---|---|
| D1 | Status card menu | P3.0 → Status card | `ClientSnapshot.tsx` |
| D2 | Deadline card menu | P3.0 → Deadline card | `ClientSnapshot.tsx` |
| D3 | Relief card menu | P3.0 → Relief card | `ClientSnapshot.tsx` |
| D4 | Next action card menu | P3.0 → Next action card | `ClientSnapshot.tsx` |
| D5 | Timeline date range | P3.1 → date range filter | `TimelineFilters.tsx` |
| D6 | Status picker | P10 row status; M13; M9 intake status; P4.6 appointment status | `StatusEditor.tsx` |
| D7 | Highlighted For picker | P10 row | `HighlightedForEditor.tsx` |
| D8 | Status filter | P2.3 | `FilterBar.tsx` |
| D9 | Attorney filter | P2.3 | `FilterBar.tsx` |
| D10 | Board type filter | P2.3 | `FilterBar.tsx` |
| D11 | Search type | P2.1 | `SearchBar.tsx` |
| D12 | Urgency picker | P11.3.2, a status row | `StatusTagsSection.tsx` |
| D13 | Intake field picker | Any choice field on an intake form: M8, M2 | `JailIntakeFields.tsx` |
| D14 | Attorney picker | M10; M9 Book consult | `NewAppointmentModal.tsx`, `JailIntakeDetailModal.tsx` |
| D15 | Case type picker | M11 | `NewContractModal.tsx` |
| D16 | Call status | M2 | `LogCallModal.tsx` |
| D17 | Language | M2 (always shown; reused by the jail intake) | `LogCallModal.tsx` |
| D18 | Taken by | M2 → more fields | `LogCallModal.tsx` |
| D19 | Highlight for | M2 → more fields | `LogCallModal.tsx` |
| D20 | Call status filter | P10.1 | `CallLogPage.tsx` |
| D21 | Taken-by filter | P10.1 | `CallLogPage.tsx` |
| D22 | Show column | M1 | `KpiDetailModal.tsx` |
| D23 | Type of appt | M18 | `ConsultPrepModal.tsx` |
| D24 | How to proceed | M18 | `ConsultPrepModal.tsx` |
| D25 | Judge filter | P15.2 | `CourtCasesPage.tsx` |
| D26 | Attorney filter | P15.2 | `CourtCasesPage.tsx` |
| D27 | Paralegal filter | P15.2 | `CourtCasesPage.tsx` |
| D28 | Case Prep Status picker | P15.4 (Prep Pipeline) | `CourtCasesPage.tsx` |
| D29 | Motion type filter | P15.2 (Motions) | `CourtCasesPage.tsx` |
| D30 | Assistant filter | P18.2 | `AddressChangesPage.tsx` |
| D31 | Address change status picker | P18.3 | `AddressChangesPage.tsx` |
| D32 | Motion status picker | P15.5 (Motions) | `CourtCasesPage.tsx` |
| D33 | Needs interpreter? | M18 | `ConsultPrepModal.tsx` |
| D34 | Paralegal filter | P19.2 | `FoiasPage.tsx` |
| D35 | Client folder menu | M18 → Documents **⋯**: **Use a different folder…** (paste a SharePoint link — replaces the profile's on save, only if Monday still holds it), **Find or create e-file folder**, **Find or create consult folder** (creates only when none exists) | `ConsultPrepModal.tsx` |
| D36 | Detention center | M18 → Type of appt **Detained appt**: the Court Cases board's Det. Facility labels (synced) + **Other** (free text). Pre-filled from the client's open court case | `ConsultPrepModal.tsx` |

All components live in `apps/web/src/components/` unless the path says `pages/`.
