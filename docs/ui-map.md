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

Every code is shown in the app, in small grey text:

- **Pages and tabs** — bottom-right corner of the window (`PageCode` in
  `components/ScreenCode.tsx`; page codes in `app.tsx`, Client 360 tab codes in
  `ClientView.tsx`).
- **Popups** — just under the × button (`code` prop on `DialogContent`).
- **Dropdowns** — last line of the menu, bottom-right (`code` prop on
  `PopoverContent`, or `MenuCode` in the two custom menus).

- **Sections inside a page** — after the section's heading (Settings), or on a
  small line above the section's right edge (Home, Clients); P3.0 sits in the
  bottom-right of the Client 360 header (`SectionCode` in `ScreenCode.tsx`).

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

Always on screen (not pages): the **Sidebar** (`components/Sidebar.tsx`), the
**Top bar** with Back and **+ Log call** (`app.tsx`), and the **Version badge**
in the sidebar (`components/VersionBadge.tsx`).

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

## Popups

| Code | Name | Title on screen | Opened from | Component |
|---|---|---|---|---|
| M1 | KPI detail | The card's name | P1 → click a KPI card | `KpiDetailModal.tsx` |
| M2 | Log a call | "Log a call" / "Edit call" | Top bar **+ Log call** (every page); P10 → pencil on a row | `LogCallModal.tsx` |
| M3 | Client case | The client's name (360 header) | Inside M2 → "View profile" after picking a linked client — opens on top of M2 | `ClientCaseModal.tsx` |
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
| M14 | What's new | Changelog | Version badge in the sidebar | `VersionBadge.tsx` |

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

All components live in `apps/web/src/components/` unless the path says `pages/`.
