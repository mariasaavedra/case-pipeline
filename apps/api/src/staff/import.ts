// =============================================================================
// Staff import — the firm's staff table (CSV) → the roster
// =============================================================================
// One row per person: name, email, Monday user id, active/disabled in Monday,
// Slack member id, initials, class, RingCentral number + ext. The table is
// what staff keep; Monday says who is still here. planStaffImport says what
// would change, applyStaffImport does it. Rules:
//
// - A row is matched by Monday user id, then email, then name (the roster's
//   matcher). No match → a new person.
// - Email, ext. and Slack id are set from the table when they differ. A
//   Monday id is only filled in, never replaced (refreshStaff owns it).
// - Active = the table's monday_status. A retired person is only marked
//   inactive here; handing over their open work stays in Offboarding.
// - Roles from Class, only for people whose roles an admin hasn't reviewed
//   (Settings → Staff wins). A Class with no app role (Assistant, Volunteer)
//   leaves the roles alone.
// - The name stays as the roster has it; the table's spelling becomes an alias.
// - Initials and the RingCentral number have no place in the roster: ignored.
//
// The CLI is scripts/staff-import.ts.
// =============================================================================

import type BetterSqlite3 from "better-sqlite3";
import { SLACK_USER_ID_RE, type StaffRole } from "./schema.js";
import { addAlias, createStaff, getStaff, makeStaffResolver, setRoles, updateStaff, type StaffPatch } from "./roster.js";

type Database = BetterSqlite3.Database;

export interface StaffImportRow {
  name: string;
  email: string | null;
  mondayUserId: string | null;
  active: boolean;
  slackUserId: string | null;
  phoneExt: string | null;
  className: string | null;
}

const CLASS_ROLES: Record<string, StaffRole[]> = {
  attorney: ["attorney"],
  paralegal: ["paralegal"],
  "court paralegal": ["paralegal", "court_paralegal"],
  receptionist: ["reception"],
  reception: ["reception"],
};

/** The app roles a Class means; null = none we track (leave roles alone). */
export function rolesForClass(className: string | null): StaffRole[] | null {
  return className ? CLASS_ROLES[className.trim().toLowerCase()] ?? null : null;
}

// -----------------------------------------------------------------------------
// CSV
// -----------------------------------------------------------------------------

const COLUMNS = ["name", "email", "monday_user_id", "monday_status", "slack_user_id", "class", "rc_ext"] as const;

/** Parse the table. Throws on a missing column; returns per-line problems for bad rows. */
export function parseStaffCsv(text: string): { rows: StaffImportRow[]; problems: string[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) throw new Error("the file is empty");
  const header = splitCsvLine(lines[0]!).map((h) => h.trim().toLowerCase());
  const at = Object.fromEntries(COLUMNS.map((c) => [c, header.indexOf(c)])) as Record<(typeof COLUMNS)[number], number>;
  const missing = COLUMNS.filter((c) => at[c] < 0);
  if (missing.length) throw new Error(`missing column(s): ${missing.join(", ")}`);

  const rows: StaffImportRow[] = [];
  const problems: string[] = [];
  lines.slice(1).forEach((line, i) => {
    const cells = splitCsvLine(line);
    const cell = (c: (typeof COLUMNS)[number]) => cells[at[c]]?.trim() || null;
    const name = cell("name");
    const where = `line ${i + 2}${name ? ` (${name})` : ""}`;
    if (!name) {
      problems.push(`${where}: no name`);
      return;
    }
    const status = cell("monday_status")?.toLowerCase();
    if (status !== "active" && status !== "disabled") {
      problems.push(`${where}: monday_status must be active or disabled`);
      return;
    }
    const mondayUserId = cell("monday_user_id");
    if (mondayUserId && !/^\d+$/.test(mondayUserId)) {
      problems.push(`${where}: monday_user_id must be a number`);
      return;
    }
    const slackUserId = cell("slack_user_id")?.toUpperCase() ?? null;
    if (slackUserId && !SLACK_USER_ID_RE.test(slackUserId)) {
      problems.push(`${where}: "${slackUserId}" is not a Slack member id (U…)`);
      return;
    }
    rows.push({
      name,
      email: cell("email")?.toLowerCase() ?? null,
      mondayUserId,
      active: status === "active",
      slackUserId,
      phoneExt: cell("rc_ext"),
      className: cell("class"),
    });
  });
  return { rows, problems };
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

// -----------------------------------------------------------------------------
// Plan
// -----------------------------------------------------------------------------

export interface StaffImportChange {
  field: "email" | "mondayUserId" | "phoneExt" | "slackUserId" | "active" | "roles";
  from: string | null;
  to: string | null;
}

export interface StaffImportStep {
  row: StaffImportRow;
  /** null = a new person. */
  staffId: number | null;
  rosterName: string | null;
  action: "create" | "update" | "same" | "skip";
  changes: StaffImportChange[];
  /** Why it was skipped, or a note on something left alone. */
  note: string | null;
}

export function planStaffImport(db: Database, rows: StaffImportRow[]): StaffImportStep[] {
  const resolve = makeStaffResolver(db);
  const byMondayId = db.prepare("SELECT id FROM staff WHERE monday_user_id = ?");
  const byEmail = db.prepare("SELECT id FROM staff WHERE lower(email) = ? ORDER BY active DESC LIMIT 1");
  const slackOwner = db.prepare("SELECT id, name FROM staff WHERE slack_user_id = ?");
  const mondayOwner = db.prepare("SELECT id, name FROM staff WHERE monday_user_id = ?");

  const claimedSlack = new Map<string, string>();
  return rows.map((row): StaffImportStep => {
    const id =
      (row.mondayUserId ? (byMondayId.get(row.mondayUserId) as { id: number } | undefined)?.id : undefined) ??
      (row.email ? (byEmail.get(row.email) as { id: number } | undefined)?.id : undefined) ??
      resolve(row.name)?.id ??
      null;
    const skip = (note: string): StaffImportStep => ({ row, staffId: id, rosterName: null, action: "skip", changes: [], note });

    if (row.slackUserId) {
      const twice = claimedSlack.get(row.slackUserId);
      if (twice) return skip(`Slack id ${row.slackUserId} is also on ${twice} in the table`);
      claimedSlack.set(row.slackUserId, row.name);
      const owner = slackOwner.get(row.slackUserId) as { id: number; name: string } | undefined;
      if (owner && owner.id !== id) return skip(`Slack id ${row.slackUserId} already belongs to ${owner.name}`);
    }

    const classRoles = rolesForClass(row.className);
    if (id === null) {
      if (row.mondayUserId && mondayOwner.get(row.mondayUserId)) return skip(`Monday user ${row.mondayUserId} is on someone else`);
      const changes: StaffImportChange[] = [
        { field: "email", from: null, to: row.email },
        { field: "mondayUserId", from: null, to: row.mondayUserId },
        { field: "phoneExt", from: null, to: row.phoneExt },
        { field: "slackUserId", from: null, to: row.slackUserId },
        { field: "active", from: null, to: row.active ? "active" : "inactive" },
        { field: "roles", from: null, to: classRoles?.join(", ") ?? null },
      ].filter((c) => c.to !== null) as StaffImportChange[];
      return { row, staffId: null, rosterName: null, action: "create", changes, note: null };
    }

    const s = getStaff(db, id)!;
    if (row.mondayUserId && s.mondayUserId && s.mondayUserId !== row.mondayUserId) {
      return skip(`roster has Monday user ${s.mondayUserId} for ${s.name}, the table says ${row.mondayUserId}`);
    }
    const changes: StaffImportChange[] = [];
    const diff = (field: StaffImportChange["field"], from: string | null, to: string | null) => {
      if (to !== null && (from ?? null) !== to) changes.push({ field, from, to });
    };
    diff("email", s.email?.toLowerCase() ?? null, row.email);
    if (!s.mondayUserId) diff("mondayUserId", null, row.mondayUserId);
    diff("phoneExt", s.phoneExt, row.phoneExt);
    diff("slackUserId", s.slackUserId, row.slackUserId);
    diff("active", s.active ? "active" : "inactive", row.active ? "active" : "inactive");

    let note: string | null = null;
    if (classRoles) {
      const want = classRoles.join(", ");
      const have = s.roles.join(", ");
      if (want !== have) {
        if (s.rolesReviewed) note = `roles set in Settings (${have || "none"}) kept; the table says ${row.className}`;
        else changes.push({ field: "roles", from: have || null, to: want });
      }
    }
    return { row, staffId: id, rosterName: s.name, action: changes.length ? "update" : "same", changes, note };
  });
}

// -----------------------------------------------------------------------------
// Apply
// -----------------------------------------------------------------------------

export interface StaffImportResult {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
}

/** Apply a plan from planStaffImport, in one transaction. */
export function applyStaffImport(db: Database, plan: StaffImportStep[]): StaffImportResult {
  const result: StaffImportResult = { created: 0, updated: 0, unchanged: 0, skipped: 0 };
  db.transaction(() => {
    for (const step of plan) {
      const { row } = step;
      const roles = rolesForClass(row.className);
      if (step.action === "skip") {
        result.skipped++;
        continue;
      }
      if (step.action === "create") {
        const id = createStaff(db, {
          name: row.name,
          email: row.email,
          mondayUserId: row.mondayUserId,
          phoneExt: row.phoneExt,
          slackUserId: row.slackUserId,
          active: row.active,
          source: row.mondayUserId ? "monday" : "manual",
        });
        if (roles) setRoles(db, id, roles);
        result.created++;
        continue;
      }
      const id = step.staffId!;
      addAlias(db, id, row.name, { ifFree: true });
      if (step.action === "same") {
        result.unchanged++;
        continue;
      }
      const patch: StaffPatch = {};
      for (const c of step.changes) {
        if (c.field === "email") patch.email = c.to;
        else if (c.field === "phoneExt") patch.phoneExt = c.to;
        else if (c.field === "slackUserId") patch.slackUserId = c.to;
        else if (c.field === "active") patch.active = c.to === "active";
        else if (c.field === "mondayUserId") {
          db.prepare("UPDATE staff SET monday_user_id = ?, updated_at = datetime('now') WHERE id = ?").run(c.to, id);
        } else if (c.field === "roles" && roles) setRoles(db, id, roles);
      }
      updateStaff(db, id, patch);
      result.updated++;
    }
  })();
  return result;
}
