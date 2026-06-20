# Hearing Prep Checklist

**Status:** Planned — not started  
**Last updated:** 2026-05-25

---

## Goal

A structured, per-case checklist of everything that needs to be ready before a court hearing. Lives as a tab or section on court case detail views. Gives attorneys and paralegals a clear picture of readiness without digging through the board.

---

## Why This Matters

Court hearings are high-stakes and time-sensitive. Missing a document, an evidence deadline, or a brief submission can have serious consequences. A structured checklist — derived from what's already in the data — surfaces gaps before the hearing date rather than at it.

---

## Checklist Items (Draft)

These should be validated against real court case workflows before building:

**Pre-hearing documents:**
- [ ] Notice to Appear (NTA) filed
- [ ] Evidence deadline confirmed
- [ ] Evidence packet submitted
- [ ] Brief filed (if required)
- [ ] WPS (Written Pleading Statement) filed
- [ ] Application filed

**Client preparation:**
- [ ] Client prep appointment scheduled
- [ ] Client prep appointment completed
- [ ] Client documents collected

**Day-of:**
- [ ] Hearing date and time confirmed
- [ ] Attorney assigned
- [ ] Interpreter arranged (if needed)

---

## Data Mapping

Each checklist item maps to a column value in the court case board item. "Checked" = the column is non-empty, has a date in the past, or has a specific status value. Exact mapping TBD — requires reviewing the Calendaring and Court Cases board columns.

---

## Frontend

Lives as a new tab on the existing `ClientView.tsx` component — appears only when the client has at least one court case.

Or as a section within the existing Active Cases tab / court case detail view — to be decided at implementation time.

---

## Open Questions

- What are the exact column names in the Calendaring and Court Cases boards that map to each checklist item? (Needs a board audit before building.)
- Should checklist items be checkable manually (write-back to Monday.com) or purely derived from existing data (read-only)?
- Should there be a "hearing readiness" percentage shown on the active cases board cards for court cases?
- Different case types (asylum, removal, appeal) may need different checklists — worth designing for multiple templates from the start.

---

## Dependencies

- Requires understanding of Calendaring and Court Cases board column structure
- Write-back (interactive checkboxes) depends on Monday.com write-back feature
