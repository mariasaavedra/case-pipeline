# Monday.com Domain Map

## Board Relationship Diagram

```
                        ENTRY POINTS
                        ────────────
    Calendly Scheduling              Staff Form
           │                              │
           ▼                              ▼
   ┌──────────────────┐         ┌──────────────────┐
   │   Appointments    │         │  Jail Intakes     │
   │  (WH/LB/M/R)     │         │  some → Appt      │
   │  per attorney     │         │  some don't       │
   └────────┬─────────┘         └──────────────────┘
            │ auto-creates
            ▼
   ┌──────────────────┐
   │     PROFILES      │  Central entity — the person
   └──┬───┬───┬───┬───┘
      │   │   │   │
      │   │   │   └── DIRECT from Profile (no Fee K)
      │   │   │        ├── Address Changes
      │   │   │        ├── NVC Notices (received by mail)
      │   │   │        ├── Originals+Cards+Notices (received by mail)
      │   │   │        └── RFEs (received by email, occasionally own Fee K)
      │   │   │
      │   │   └── Fee K ──→ Court Case (can be standalone)
      │   │
      │   └── Fee K ──→ Open Form (USCIS/NVC, not court)
      │
      └── Fee K ──→ Motion / Appeal / FOIA / Litigation / I918B

   Key: Some Fee Ks create entries on MULTIPLE boards
        e.g. Fee K → Court Case + Open Form
   Note: Motions link to an existing court case but don't create one
```

## Board Inventory (18 boards)

| Board Key | Description | Links To |
|-----------|-------------|----------|
| `profiles` | Central client entity | — |
| `fee_ks` | Contracts (case type + fee) | Profile |
| `court_cases` | EOIR court representation | Profile, Fee K |
| `_cd_open_forms` | USCIS/NVC filings | Profile, Fee K |
| `motions` | Court motions (MTR, MTA, bond, etc.) | Profile, Fee K, Court Case |
| `appeals` | BIA / Circuit appeals | Profile, Fee K |
| `foias` | Freedom of Information Act requests | Profile, Fee K |
| `litigation` | Federal litigation (Mandamus) | Profile, Fee K |
| `_lt_i918b_s` | I-918B certifications | Profile, Fee K |
| `address_changes` | Court/USCIS address updates | Profile |
| `nvc_notices` | NVC mail notices | Profile |
| `_na_originals_cards_notices` | Received documents (EADs, cards) | Profile |
| `rfes_all` | Requests for Evidence | Profile |
| `appointments_r` | Rekha's appointments | Profile |
| `appointments_m` | Michael's appointments | Profile |
| `appointments_lb` | Lucy's appointments | Profile |
| `appointments_wh` | William's appointments | Profile |
| `_fa_jail_intakes` | Detention facility intakes | — |

## Flow Details

### Entry Points

- **Appointments**: Created via Calendly integration. Each attorney has their own board (`appointments_r`, `appointments_m`, `appointments_lb`, `appointments_wh`). An appointment automatically creates a Profile.
- **Jail Intakes**: Added by staff via a form. Captures detention info, consultation scheduling. Some convert to appointments (and then profiles), some don't.

### Profile → Fee K → Work Board

A **Profile** represents a client (individual person). When hired for a service, a **Fee K** (contract) is created linking the case type and fee amount to the profile.

Each Fee K's case type determines which work board(s) get entries:

- **Court track**: EOIR hearings, trials, bond → `court_cases`
- **USCIS/NVC track**: I-forms, N-forms, DACA, TPS, consular → `_cd_open_forms`
- **Motions**: Standalone on the `motions` board (link to an existing court case, don't create one)
- **Appeals**: BIA or Circuit → `appeals`
- **FOIAs**: EOIR, G639, OBIM, FBI, NRC → `foias`
- **Litigation**: Mandamus → `litigation`
- **I-918B**: U-Visa certifications → `_lt_i918b_s`

Some case types create entries on **multiple boards** simultaneously:
- `I-485 (Adjustment in Court)` → `_cd_open_forms` + `court_cases`

Motions link to an existing court case but are routed only to the `motions` board (they don't create a new `court_cases` entry).

### Direct-from-Profile Boards (no Fee K)

These boards link directly to profiles without going through a Fee K:

- **Address Changes**: Court or USCIS address updates
- **NVC Notices**: Received by mail from NVC
- **Originals+Cards+Notices**: Physical documents received (EADs, green cards, etc.)
- **RFEs**: Requests for Evidence received via email (occasionally have their own Fee K)
