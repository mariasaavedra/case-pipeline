# Active Cases Board — Visual Team Operations View

**Status:** Implemented — 2026-05-26  
**Last updated:** 2026-05-26

---

## Goal

A read-only, at-a-glance page showing every case currently being worked by paralegals and staff. Designed for situational awareness: who has what, what's urgent, what's overdue, and which cases are court matters (higher stakes, different rules).

---

## What "Active" Means

Cases on the **Open Forms** board that belong to either of two groups:
- `Open Forms` — standard USCIS/immigration forms
- `Court Forms` — court-related filings (take priority, ruled by different principles)

Groups **excluded** (not active): Filed, Interviews, and any other terminal/post-filing groups.

---

## Layout: Urgency Columns × Assignee Rows

```
             │ OVERDUE │ 1–3 DAYS │ THIS WEEK │ LATER │ NO DATE │
─────────────┼─────────┼──────────┼───────────┼───────┼─────────┤
Maria        │  [card] │  [card]  │  [card]   │       │         │
             │         │  [card]  │           │       │         │
─────────────┼─────────┼──────────┼───────────┼───────┼─────────┤
James        │         │          │  [card]   │[card] │         │
─────────────┼─────────┼──────────┼───────────┼───────┼─────────┤
Unassigned   │         │  [card]  │           │       │  [card] │
─────────────┴─────────┴──────────┴───────────┴───────┴─────────┘
```

**Columns** are urgency buckets based on Target Date — not status values (too many, not linear):

| Column | Condition |
|---|---|
| Overdue | Target date is in the past |
| 1–3 days | Target date is 1–3 days from today |
| This week | Target date is 4–7 days from today |
| Later | Target date is 8+ days away |
| No date | Target date is blank (temporary — being assigned) |

**Rows** are assignees, derived automatically from the Paralegals column on Open Forms. Any person with at least one active case gets a row — no manual configuration. Currently 4 paralegals; scales to any number. Non-paralegal staff who work cases also appear automatically.

**Unassigned row** — cases with no paralegal assigned float here. Should be rare but visible when it happens.

---

## Card Design

Each case is a card showing:

- **Client name** (links to client 360 view)
- **Form / case name** (from the item name on the board)
- **Status label** — raw value from the Open Forms Status column, displayed as a small badge (not used for layout — just informational)
- **Target date countdown** — e.g. `5 days`, `TODAY`, `3 days overdue`
- **COURT badge** — visually distinct marker on all Court Forms cases (different color treatment, e.g. blue/purple vs the standard form color)
- **Priority badge** — High / Urgent, if priority column is present (see Priority section below)

### Card color coding by urgency

| State | Color |
|---|---|
| Overdue | Red |
| 1–3 days | Orange |
| This week | Yellow |
| Later | Green |
| No date | Grey |

Court cases use a blue/purple hue family instead of the green→red spectrum so they visually separate from standard forms at a glance.

---

## Priority

**Current state:** Priority exists in practice but is not tracked anywhere in Monday.com or the database. Paralegals and attorneys know which cases are urgent, but there is no data field for it.

**Recommended action (before building this feature):**
Add a `Priority` column to the Open Forms board in Monday.com — a simple dropdown with values: `Normal`, `High`, `Urgent`. The sync engine will pick it up automatically once mapped in `config/boards.yaml`.

**Until that column exists:** The board builds fine without it. Priority badges simply won't appear. No placeholder or fallback needed.

---

## Data Source

All data already exists in SQLite (post-sync). No new Monday.com API calls at page load.

| Data point | Source |
|---|---|
| Active cases | `board_items` WHERE board_key = open forms boards AND group_name IN ('Open Forms', 'Court Forms') |
| Assignee | `board_items.columns` → Paralegals column value (autofilled from Fee K) |
| Target date | `board_items.columns` → Target Date column value |
| Status label | `board_items.columns` → Open Forms Status column value |
| Court vs Form | Derived from `group_name` — Court Forms group = court case |
| Client name | JOIN `profiles` on profile relationship |
| Priority | `board_items.columns` → Priority column (once added to Monday.com) |

---

## New API Endpoint ✅ Implemented

```
GET /api/active-cases
```

Returns all active cases grouped by assignee, enriched with target date urgency bucket. Response shape:

```ts
{
  assignees: {
    name: string           // paralegal/staff name, or "Unassigned"
    cases: {
      localId: string
      clientName: string
      clientLocalId: string
      formName: string
      status: string
      targetDate: string | null
      urgency: "overdue" | "critical" | "soon" | "later" | "none"
      daysUntilTarget: number | null  // negative = overdue
      isCourtCase: boolean
      priority: "normal" | "high" | "urgent" | null
    }[]
  }[]
}
```

**File:** `apps/api/src/routes/active-cases.ts`  
**Query:** `libs/query/src/active-cases.ts`

---

## Frontend ✅ Implemented

**Route:** `/active-cases`  
**Page component:** `apps/web/src/components/ActiveCasesPage.tsx`  
**Sidebar link:** "Active Cases" nav item added between Appointments and Calendar

Cards and swim-lane grid are local to this page (`CaseCard`, `AssigneeRow` sub-components). Extract to shared if reused elsewhere.

---

## Open Questions / Future Enhancements

- **Priority column in Monday.com** — needs to be added before priority badges can appear. Simple dropdown: Normal / High / Urgent.
- **Auto-refresh** — page could poll every N minutes to stay current without a manual reload. Decide at implementation time.
- **Click-through behavior** — cards link to client 360 view. No inline editing for now (read-only).
- **Filtering** — could add a paralegal filter dropdown to focus on one person's cases. Deferred.
- **Mobile** — swim-lane grid is desktop-first. A stacked card view for mobile is a follow-up.
