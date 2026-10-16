// =============================================================================
// Staff roster tables (users.db v15)
// =============================================================================
// Kept apart from users-db.ts so tests can build the same tables in memory.

/** The fixed role list. A person can hold several. */
export const STAFF_ROLES = ["attorney", "paralegal", "court_paralegal", "reception", "billing", "manager"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export function isStaffRole(v: unknown): v is StaffRole {
  return typeof v === "string" && (STAFF_ROLES as readonly string[]).includes(v);
}

/**
 * Where a row came from: a Monday workspace user, a name found only on the
 * boards (someone no longer in Monday — former staff, as a rule), or added by
 * hand in Settings → Staff.
 */
export type StaffSource = "monday" | "board_name" | "manual";

export const createStaffTablesSql = `
  CREATE TABLE IF NOT EXISTS staff (
    id              INTEGER PRIMARY KEY,
    name            TEXT NOT NULL,
    email           TEXT,
    monday_user_id  TEXT UNIQUE,
    phone_ext       TEXT,
    attorney_board  TEXT,
    active          INTEGER NOT NULL DEFAULT 1,
    start_date      TEXT,
    end_date        TEXT,
    source          TEXT NOT NULL DEFAULT 'manual',
    -- Last refresh that found this person among Monday's workspace users.
    monday_seen_at  TEXT,
    -- 1 once an admin has set the roles; the refresh then stops suggesting them.
    roles_reviewed  INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS staff_roles (
    staff_id  INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    role      TEXT NOT NULL,
    PRIMARY KEY (staff_id, role)
  );
  CREATE TABLE IF NOT EXISTS staff_aliases (
    alias_norm  TEXT PRIMARY KEY,
    alias       TEXT NOT NULL,
    staff_id    INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_staff_aliases_staff ON staff_aliases(staff_id);
`;

/**
 * Steps the app can't do for itself, ticked by the admin (staff/offboarding.ts).
 * Order = the order the checklist shows them.
 */
export const OFFBOARDING_MANUAL_STEPS = ["monday_seat", "microsoft_365", "ringcentral", "slack"] as const;
export type OffboardingManualStep = (typeof OFFBOARDING_MANUAL_STEPS)[number];

/** users.db v16: one offboarding per person (a rehire reopens the same row). */
export const createOffboardingTableSql = `
  CREATE TABLE IF NOT EXISTS staff_offboarding (
    id            INTEGER PRIMARY KEY,
    staff_id      INTEGER NOT NULL UNIQUE REFERENCES staff(id) ON DELETE CASCADE,
    started_by    INTEGER,
    started_at    TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at  TEXT,
    -- { "<step>": { "at": "...", "by": "<email>" } } for each ticked manual step
    manual_steps  TEXT NOT NULL DEFAULT '{}'
  );
`;
