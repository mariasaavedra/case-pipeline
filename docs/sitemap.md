# Application Sitemap

```
/                          Landing Page (Dashboard)
|
|-- KPI Cards Grid
|   |-- Open Forms              --> /clients?board_type=_cd_open_forms
|   |-- Pending Contracts       --> /clients?status=pending_contracts
|   |-- Paid Fee Ks             --> /clients?status=paid_fee_ks
|   |-- Upcoming Deadlines      --> /clients?date_from=...&date_to=...
|   |-- Upcoming Hearings       --> /clients?board_type=court_cases&date_from=...&date_to=...
|   '-- Alerts                  --> /alerts
|
/clients                   Clients Page (Search + Browse)
|
|-- SearchBar (full-text + typed search)
|-- FilterBar
|   |-- Priority: All | High | Medium | Low
|   |-- Status: All | Pending Contracts | Paid Fee Ks | [dynamic]
|   |-- Attorney: All | [dynamic from board_items]
|   |-- Board Type: All | [dynamic from board_items]
|   '-- Date Range: from / to
|
'-- Profile List --> click --> /clients/:localId
|
/clients/:localId          Client 360 View
|
|-- Profile Header (name, email, phone, priority, address)
|-- Tabs
|   |-- overview       Overview tab
|   |   |-- Client Snapshot (active cases, pending contracts, next deadline)
|   |   |-- Contracts Section (active / closed)
|   |   |-- Board Items (grouped by board type)
|   |   '-- Updates Timeline
|   |-- documents      Documents tab
|   |-- appointments   Appointments tab
|   '-- relations      Relationships tab
|
/appointments              Appointments Page
|
|-- Controls
|   |-- Attorney: All | R | M | LB | WH
|   |-- Range: Today | This Week | Upcoming | All
|   '-- Detail: Minimal | Snapshot | Full
|
|-- Appointment Cards (grouped by date)
|   |-- Card Header: date, status, board tag, client name, priority
|   |-- Snapshot Bar: active cases, pending contracts, next deadline, contact
|   |-- Full Case Summary: contracts, board items by type
|   '-- Recent Notes Timeline (collapsible)
|
/alerts                    Alerts Page
|
|-- Controls
|   |-- Attorney: All | [dynamic]
|   '-- Severity: All | Critical | Warning | Info
|
'-- Alert Groups (collapsible)
    |-- Critical: Overdue Deadlines (past next_date)
    |-- Warning: Stale Cases (no updates in 30+ days)
    '-- Info: Pending Contracts (paid, no active work)
```

## Navigation

```
+--------------------------------------------------+
|  [Sidebar]              [Header - sticky]        |
|  +-----------+  +------------------------------+ |
|  | Home      |  | <- Back (on client detail)   | |
|  | Clients   |  +------------------------------+ |
|  | Appts     |                                   |
|  | Alerts    |  [Main Content Area]              |
|  +-----------+                                   |
+--------------------------------------------------+
```

Sidebar collapses to icon-only mode (60px). Full width: 220px.
Mobile: sidebar is a slide-out overlay with hamburger toggle.

## Data Flow

```
User Action          Frontend Component       API Endpoint              Query Layer
-----------          ------------------       ------------              -----------
Load dashboard       LandingPage              GET /api/dashboard        getDashboardKpis()
Search clients       SearchBar                GET /api/clients/search   searchClients()
Typed search         SearchBar                GET /api/search           searchByType()
Browse/filter        ClientsPage + FilterBar  GET /api/clients          listProfilesFiltered()
Filter options       FilterBar                GET /api/filter-options   getFilterOptions()
View client 360      ClientView               GET /api/clients/:id      getClientCaseSummary()
View appointments    AppointmentsPage         GET /api/appointments     getAppointments()
View alerts          AlertsPage               GET /api/alerts           getAlerts()
```
