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

When a new screen or popup ships, add it here with the next free number. Never
reuse or renumber a code: old requests keep pointing at the right thing.

## Pages

| Code | Name | Address | Opened from | Component |
|---|---|---|---|---|
| P0 | Sign in | `/login` | Opening the app signed out | `pages/LoginPage.tsx` |
| P1 | Home | `/` | Sidebar → Home | `components/LandingPage.tsx` |
| P2 | Clients | `/clients` | Sidebar → Clients | `components/ClientsPage.tsx` |
| P3 | Client 360 | `/clients/:id` | Any client name anywhere | `components/ClientView.tsx` |
| P4 | Appointments | `/appointments` | Sidebar → Appointments | `components/AppointmentsPage.tsx` |
| P5 | Active Cases | `/active-cases` | Sidebar → Active Cases | `components/ActiveCasesPage.tsx` |
| P6 | My Cases | `/my-cases` | Sidebar → My Cases | `components/MyCasesPage.tsx` |
| P7 | Calendar | `/calendar` | Sidebar → Calendar | `components/CalendarPage.tsx` |
| P8 | Alerts | `/alerts` | Sidebar → Alerts | `components/AlertsPage.tsx` |
| P9 | Jail Intakes | `/jail-intakes` | Sidebar → Jail Intakes | `components/JailIntakesPage.tsx` |
| P10 | Call Log | `/call-log` | Sidebar → Call Log | `components/CallLogPage.tsx` |
| P11 | Settings | `/settings` | Sidebar → Settings (bottom) | `pages/SettingsPage.tsx` |
| P12 | Mail | `/mail` | Sidebar → Mail | `components/MailPage.tsx` |

### Global

| Code | Name | Notes |
|---|---|---|
| G1 | Sidebar | Page links, Settings, your name and sign-out (`Sidebar.tsx`) |
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
| P3.0 | Client header + snapshot | — | Name bar (`ClientHeaderSticky.tsx`) and four snapshot cards (`ClientSnapshot.tsx`) → D1–D4 |
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
| P4.1 | Controls | Board/list, attorney focus, date range, detail level |
| P4.2 | Attorney boards | One column per attorney, or one attorney full width |
| P4.3 | Appointment list | List view, grouped by date. Click an appointment → M5 |

### Inside P5 Active Cases

| Code | Name | Notes |
|---|---|---|
| P5.1 | Case count + North Pole toggle | |
| P5.2 | Swim-lane board | Paralegal rows × urgency columns |

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

Top to bottom. Sections marked *admin* only show for admins.

| Code | Name |
|---|---|
| P11.1 | Profile |
| P11.2 | Preferences |
| P11.3 | My board identity |
| P11.4 | Monday.com account |
| P11.5 | Attorney appointment boards |
| P11.6 | Status tags *(admin)* |
| P11.7 | Urgency *(admin)* |
| P11.8 | Sync health *(admin)* |
| P11.9 | Users *(admin)* |
| P11.10 | Audit log *(admin)* |

### Inside P12 Mail

| Code | Name | Notes |
|---|---|---|
| P12.1 | Drop zone | Choose a PDF, or try a sample (text or scanned/OCR) |
| P12.2 | Result filters | Matched / needs attention / no match / unreadable; OCR and separator summary |
| P12.3 | Notices + preview | One row per notice; **Review** → M15; the scan's pages on the right |

## Popups

| Code | Name | Title on screen | Opened from | Component |
|---|---|---|---|---|
| M1 | KPI detail | The card's name | P1 → click a KPI card | `KpiDetailModal.tsx` |
| M2 | Log a call | "Log a call" / "Edit call" | Top bar **+ Log call** (every page); P10 → pencil on a row | `LogCallModal.tsx` |
| M3 | Client case | The client's name (360 header) | Inside M2 → "View profile" after picking a linked client (opens on top of M2); P10 → a row's client | `ClientCaseModal.tsx` |
| M4 | Call notes | "Notes — *name*" | P10 → notes on a row | `CallNotesModal.tsx` |
| M5 | Appointment detail | The client's name | P4 → click an appointment | `AppointmentModal.tsx` |
| M6 | Client notes | The client's name | P4 → "Open in modal" under a row's notes | `NotesModal.tsx` |
| M7 | Day agenda | The date | P7 → click a day | `CalendarPage.tsx` (`DayModal`) |
| M8 | New jail intake | "New jail intake" | P9 → **+ New intake** | `NewJailIntakeModal.tsx` |
| M9 | Jail intake detail | The detainee's name | P9 → click an intake | `JailIntakeDetailModal.tsx` |
| M10 | Book a consult | "Book a consult" | P3.2 | `NewAppointmentModal.tsx` |
| M11 | New contract | "New contract (Fee K)" | P3.3 | `NewContractModal.tsx` |
| M12 | File preview | The file name | P3.6; the documents section of M5 | `FilePreviewModal.tsx` |
| M13 | Entry editor | The entry's name | P3.8 (admin) | `EntryEditorModal.tsx` |
| M14 | What's new | Changelog | Version badge on P1 Home / P0 Sign in | `VersionBadge.tsx` |
| M15 | Mail review | The notice type and form | P8 → a "Mail to review" row; P12 → **Review** on a notice | `MailReviewModal.tsx` |

## Dropdowns

| Code | Name | Opened from | Component |
|---|---|---|---|
| D1 | Status card menu | P3.0 → Status card | `ClientSnapshot.tsx` |
| D2 | Deadline card menu | P3.0 → Deadline card | `ClientSnapshot.tsx` |
| D3 | Relief card menu | P3.0 → Relief card | `ClientSnapshot.tsx` |
| D4 | Next action card menu | P3.0 → Next action card | `ClientSnapshot.tsx` |
| D5 | Timeline date range | P3.1 → date range filter | `TimelineFilters.tsx` |
| D6 | Status picker | P10 row status; M13 | `StatusEditor.tsx` |
| D7 | Highlighted For picker | P10 row | `HighlightedForEditor.tsx` |
| D8 | Status filter | P2.3 | `FilterBar.tsx` |
| D9 | Attorney filter | P2.3 | `FilterBar.tsx` |
| D10 | Board type filter | P2.3 | `FilterBar.tsx` |
| D11 | Search type | P2.1 | `SearchBar.tsx` |
| D12 | Urgency picker | P11.6, a status row | `StatusTagsSection.tsx` |
| D13 | Intake field picker | Any choice field on an intake form: M8, M2 | `JailIntakeFields.tsx` |
| D14 | Attorney picker | M10 | `NewAppointmentModal.tsx` |
| D15 | Case type picker | M11 | `NewContractModal.tsx` |
| D16 | Call status | M2 | `LogCallModal.tsx` |
| D17 | Language | M2 → more fields | `LogCallModal.tsx` |
| D18 | Taken by | M2 → more fields | `LogCallModal.tsx` |
| D19 | Highlight for | M2 → more fields | `LogCallModal.tsx` |
| D20 | Call status filter | P10.1 | `CallLogPage.tsx` |
| D21 | Taken-by filter | P10.1 | `CallLogPage.tsx` |
| D22 | Show column | M1 | `KpiDetailModal.tsx` |

All components live in `apps/web/src/components/` unless the path says `pages/`.
