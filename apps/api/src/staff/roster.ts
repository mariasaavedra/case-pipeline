// =============================================================================
// Staff roster — who works here, in which role, under which names
// =============================================================================
// One row per person (users.db `staff`, schema v14), whether or not they ever
// sign in. Every name the boards use for them is an alias, so a Monday people
// column ("Mayra Ruiz"), a legacy paralegal_link ("mayra ruiz ") and the Azure
// display name all land on the same person. resolveStaffByName is THE name
// matcher; nothing else should compare staff names by hand.
//
// The roster is filled by refreshStaff(): Monday workspace users first (they
// carry the numeric id a people-column write needs), then every name on the
// boards that matched no one — those become inactive "board_name" rows, which
// in practice are former staff still holding open work.
// =============================================================================

import type BetterSqlite3 from "better-sqlite3";
import type { MondayWorkspaceUser } from "@case-pipeline/monday";
import { STAFF_ROLES, isStaffRole, type StaffRole, type StaffSource } from "./schema.js";

type Database = BetterSqlite3.Database;

export interface StaffMember {
  id: number;
  name: string;
  email: string | null;
  mondayUserId: string | null;
  phoneExt: string | null;
  attorneyBoard: string | null;
  active: boolean;
  startDate: string | null;
  endDate: string | null;
  source: StaffSource;
  mondaySeenAt: string | null;
  rolesReviewed: boolean;
  roles: StaffRole[];
  aliases: string[];
  /** The app login linked to this person, if any. */
  login: { userId: number; email: string; active: boolean } | null;
}

interface StaffRow {
  id: number;
  name: string;
  email: string | null;
  monday_user_id: string | null;
  phone_ext: string | null;
  attorney_board: string | null;
  active: number;
  start_date: string | null;
  end_date: string | null;
  source: StaffSource;
  monday_seen_at: string | null;
  roles_reviewed: number;
}

/** Lowercase, no accents, single spaces — the key every name is matched on. */
export function normName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** A people column's text: several assignees joined with ", ". */
export function splitPeople(text: string | null | undefined): string[] {
  if (!text) return [];
  return text.split(",").map((s) => s.trim()).filter(Boolean);
}

// -----------------------------------------------------------------------------
// Reads
// -----------------------------------------------------------------------------

export function listStaff(db: Database): StaffMember[] {
  const rows = db.prepare("SELECT * FROM staff ORDER BY active DESC, name COLLATE NOCASE").all() as StaffRow[];
  const roles = db.prepare("SELECT staff_id, role FROM staff_roles").all() as { staff_id: number; role: string }[];
  const aliases = db.prepare("SELECT staff_id, alias FROM staff_aliases ORDER BY alias").all() as { staff_id: number; alias: string }[];
  const logins = db
    .prepare("SELECT id, email, active, staff_id FROM users WHERE staff_id IS NOT NULL")
    .all() as { id: number; email: string; active: number; staff_id: number }[];

  const rolesBy = groupBy(roles, (r) => r.staff_id);
  const aliasesBy = groupBy(aliases, (a) => a.staff_id);
  const loginBy = new Map(logins.map((l) => [l.staff_id, l]));

  return rows.map((r) => {
    const login = loginBy.get(r.id);
    return {
      ...toMember(r),
      roles: sortRoles((rolesBy.get(r.id) ?? []).map((x) => x.role).filter(isStaffRole)),
      aliases: (aliasesBy.get(r.id) ?? []).map((a) => a.alias),
      login: login ? { userId: login.id, email: login.email, active: login.active === 1 } : null,
    };
  });
}

export function getStaff(db: Database, id: number): StaffMember | null {
  return listStaff(db).find((s) => s.id === id) ?? null;
}

export interface ResolvedStaff {
  id: number;
  name: string;
  active: boolean;
  mondayUserId: string | null;
  roles: StaffRole[];
}

/**
 * Name → person resolver, loaded once. Use this when resolving many names (a
 * whole board); resolveStaffByName is the one-off form. Matches an alias, then
 * the person's own name.
 */
export function makeStaffResolver(db: Database): (name: string | null | undefined) => ResolvedStaff | null {
  const people = db
    .prepare("SELECT id, name, active, monday_user_id FROM staff")
    .all() as { id: number; name: string; active: number; monday_user_id: string | null }[];
  const roles = db.prepare("SELECT staff_id, role FROM staff_roles").all() as { staff_id: number; role: string }[];
  const rolesBy = groupBy(roles, (r) => r.staff_id);
  const byId = new Map<number, ResolvedStaff>(
    people.map((p) => [
      p.id,
      {
        id: p.id,
        name: p.name,
        active: p.active === 1,
        mondayUserId: p.monday_user_id,
        roles: sortRoles((rolesBy.get(p.id) ?? []).map((r) => r.role).filter(isStaffRole)),
      },
    ]),
  );
  const byKey = new Map<string, ResolvedStaff>();
  for (const p of byId.values()) byKey.set(normName(p.name), p);
  // Aliases win over a same-spelled name: an alias is an explicit decision.
  const aliases = db.prepare("SELECT alias_norm, staff_id FROM staff_aliases").all() as { alias_norm: string; staff_id: number }[];
  for (const a of aliases) {
    const p = byId.get(a.staff_id);
    if (p) byKey.set(a.alias_norm, p);
  }
  return (name) => (name ? byKey.get(normName(name)) ?? null : null);
}

export function resolveStaffByName(db: Database, name: string | null | undefined): ResolvedStaff | null {
  return makeStaffResolver(db)(name);
}

export interface LoginIdentity {
  staff_id?: number | null;
  email: string;
  name: string;
  monday_name?: string | null;
}

/** The roster person behind a login: the explicit link, else email, else name. */
export function staffForUser(db: Database, user: LoginIdentity | null): StaffMember | null {
  if (!user) return null;
  if (user.staff_id) {
    const linked = getStaff(db, user.staff_id);
    if (linked) return linked;
  }
  const id = matchLoginToStaff(db, user);
  return id ? getStaff(db, id) : null;
}

function matchLoginToStaff(db: Database, user: LoginIdentity): number | null {
  const email = user.email?.trim().toLowerCase();
  if (email) {
    const row = db.prepare("SELECT id FROM staff WHERE lower(email) = ? ORDER BY active DESC LIMIT 1").get(email) as
      | { id: number }
      | undefined;
    if (row) return row.id;
  }
  const resolve = makeStaffResolver(db);
  return (resolve(user.name) ?? resolve(user.monday_name))?.id ?? null;
}

// -----------------------------------------------------------------------------
// Writes
// -----------------------------------------------------------------------------

export interface StaffInput {
  name: string;
  email?: string | null;
  mondayUserId?: string | null;
  phoneExt?: string | null;
  attorneyBoard?: string | null;
  active?: boolean;
  startDate?: string | null;
  endDate?: string | null;
  source?: StaffSource;
}

export function createStaff(db: Database, input: StaffInput): number {
  const res = db
    .prepare(
      `INSERT INTO staff (name, email, monday_user_id, phone_ext, attorney_board, active, start_date, end_date, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.name.trim(),
      input.email?.trim() || null,
      input.mondayUserId ?? null,
      input.phoneExt?.trim() || null,
      input.attorneyBoard?.trim() || null,
      input.active === false ? 0 : 1,
      input.startDate ?? null,
      input.endDate ?? null,
      input.source ?? "manual",
    );
  const id = Number(res.lastInsertRowid);
  addAlias(db, id, input.name, { ifFree: true });
  return id;
}

export type StaffPatch = Partial<Omit<StaffInput, "source" | "mondayUserId">>;

const PATCH_COLUMNS: Record<keyof StaffPatch, string> = {
  name: "name",
  email: "email",
  phoneExt: "phone_ext",
  attorneyBoard: "attorney_board",
  active: "active",
  startDate: "start_date",
  endDate: "end_date",
};

export function updateStaff(db: Database, id: number, patch: StaffPatch): void {
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [key, col] of Object.entries(PATCH_COLUMNS) as [keyof StaffPatch, string][]) {
    if (!(key in patch)) continue;
    const v = patch[key];
    sets.push(`${col} = ?`);
    vals.push(key === "active" ? (v ? 1 : 0) : typeof v === "string" ? v.trim() || null : v ?? null);
  }
  if (sets.length === 0) return;
  db.prepare(`UPDATE staff SET ${sets.join(", ")}, updated_at = datetime('now') WHERE id = ?`).run(...vals, id);
  if (patch.name) addAlias(db, id, patch.name, { ifFree: true });
}

/** Replace a person's roles. Marks them reviewed, so a refresh stops suggesting. */
export function setRoles(db: Database, id: number, roles: StaffRole[]): void {
  db.transaction(() => {
    db.prepare("DELETE FROM staff_roles WHERE staff_id = ?").run(id);
    const ins = db.prepare("INSERT OR IGNORE INTO staff_roles (staff_id, role) VALUES (?, ?)");
    for (const r of roles) ins.run(id, r);
    db.prepare("UPDATE staff SET roles_reviewed = 1, updated_at = datetime('now') WHERE id = ?").run(id);
  })();
}

export class AliasTakenError extends Error {
  constructor(public readonly alias: string, public readonly ownerId: number) {
    super(`"${alias}" already belongs to staff #${ownerId}`);
  }
}

/**
 * Point a name at a person. `ifFree` = keep the existing owner instead of
 * throwing (used for automatic aliases, which must never steal a name).
 */
export function addAlias(db: Database, id: number, alias: string, opts: { ifFree?: boolean } = {}): void {
  const norm = normName(alias);
  if (!norm) return;
  const owner = db.prepare("SELECT staff_id FROM staff_aliases WHERE alias_norm = ?").get(norm) as { staff_id: number } | undefined;
  if (owner) {
    if (owner.staff_id === id || opts.ifFree) return;
    throw new AliasTakenError(alias.trim(), owner.staff_id);
  }
  db.prepare("INSERT INTO staff_aliases (alias_norm, alias, staff_id) VALUES (?, ?, ?)").run(norm, alias.trim(), id);
}

/**
 * Move a name from whoever holds it to `id`. The admin's "this name is this
 * person" — e.g. a board_name row turns out to be a nickname of a real person.
 * A board_name row left with no names is removed, since nothing points at it.
 */
export function reassignAlias(db: Database, id: number, alias: string): void {
  const norm = normName(alias);
  if (!norm) return;
  db.transaction(() => {
    const owner = db.prepare("SELECT staff_id FROM staff_aliases WHERE alias_norm = ?").get(norm) as { staff_id: number } | undefined;
    db.prepare("DELETE FROM staff_aliases WHERE alias_norm = ?").run(norm);
    db.prepare("INSERT INTO staff_aliases (alias_norm, alias, staff_id) VALUES (?, ?, ?)").run(norm, alias.trim(), id);
    if (owner && owner.staff_id !== id) dropOrphanBoardName(db, owner.staff_id);
  })();
}

export function removeAlias(db: Database, id: number, alias: string): void {
  db.prepare("DELETE FROM staff_aliases WHERE alias_norm = ? AND staff_id = ?").run(normName(alias), id);
}

function dropOrphanBoardName(db: Database, id: number): void {
  const row = db.prepare("SELECT source FROM staff WHERE id = ?").get(id) as { source: string } | undefined;
  if (row?.source !== "board_name") return;
  const left = db.prepare("SELECT COUNT(*) AS n FROM staff_aliases WHERE staff_id = ?").get(id) as { n: number };
  const linked = db.prepare("SELECT COUNT(*) AS n FROM users WHERE staff_id = ?").get(id) as { n: number };
  if (left.n === 0 && linked.n === 0) db.prepare("DELETE FROM staff WHERE id = ?").run(id);
}

/** Link (or unlink, with null) an app login to a person. */
export function linkLogin(db: Database, userId: number, staffId: number | null): void {
  db.prepare("UPDATE users SET staff_id = ? WHERE id = ?").run(staffId, userId);
}

// -----------------------------------------------------------------------------
// Refresh: Monday users + board names + legacy links
// -----------------------------------------------------------------------------

export interface BoardNames {
  /** Every name in a `paralegal` people column, with how many items use it. */
  paralegals: Map<string, number>;
  /** Every name in an `attorney` people column. */
  attorneys: Map<string, number>;
  /** Fee K `assistant` names: people to know, but no role is suggested from it. */
  assistants?: Map<string, number>;
}

/** Distinct names in the mirror's people columns: board items, then Fee Ks. */
export function readBoardNames(caseDb: Database): BoardNames {
  const paralegals = new Map<string, number>();
  const attorneys = new Map<string, number>();
  const assistants = new Map<string, number>();
  const count = (m: Map<string, number>, text: string | null) => {
    for (const n of splitPeople(text)) m.set(n, (m.get(n) ?? 0) + 1);
  };

  const items = caseDb
    .prepare(
      `SELECT paralegals, attorney FROM board_items
        WHERE (paralegals IS NOT NULL AND paralegals != '') OR (attorney IS NOT NULL AND attorney != '')`,
    )
    .all() as { paralegals: string | null; attorney: string | null }[];
  for (const r of items) {
    count(paralegals, r.paralegals);
    count(attorneys, r.attorney);
  }

  // Fee Ks (Prescheduling, Contracts) live in `contracts`, people in the raw values.
  const feeKs = caseDb
    .prepare(
      `SELECT json_extract(raw_column_values, '$.paralegal.label') AS paralegal,
              json_extract(raw_column_values, '$.attorney.label')  AS attorney,
              json_extract(raw_column_values, '$.assistant.label') AS assistant
         FROM contracts WHERE deleted_at IS NULL AND raw_column_values IS NOT NULL`,
    )
    .all() as { paralegal: string | null; attorney: string | null; assistant: string | null }[];
  for (const r of feeKs) {
    count(paralegals, r.paralegal);
    count(attorneys, r.attorney);
    count(assistants, r.assistant);
  }
  return { paralegals, attorneys, assistants };
}

export interface RefreshInput {
  /** null = Monday not configured / unreachable: the board + legacy steps still run. */
  workspaceUsers: MondayWorkspaceUser[] | null;
  boardNames: BoardNames;
  /** Attorney names from Settings → Attorney boards, with their board key. */
  attorneyBoards: Array<{ boardKey: string; attorneyName?: string; displayName: string }>;
}

export interface RefreshResult {
  mondayAdded: number;
  mondayUpdated: number;
  boardNamesAdded: number;
  rolesSuggested: number;
  loginsLinked: number;
  /** Active Monday-sourced people the workspace no longer lists. */
  missingFromMonday: string[];
}

export function refreshStaff(db: Database, input: RefreshInput): RefreshResult {
  const result: RefreshResult = {
    mondayAdded: 0,
    mondayUpdated: 0,
    boardNamesAdded: 0,
    rolesSuggested: 0,
    loginsLinked: 0,
    missingFromMonday: [],
  };

  db.transaction(() => {
    // 1. Monday workspace users.
    if (input.workspaceUsers) {
      const seen = new Set<string>();
      for (const u of input.workspaceUsers) {
        const mondayId = String(u.id);
        seen.add(mondayId);
        const existing = findForMondayUser(db, mondayId, u);
        if (existing) {
          db.prepare(
            `UPDATE staff SET monday_user_id = ?, monday_seen_at = datetime('now'),
                    email = COALESCE(email, ?),
                    -- A board_name row that turns out to be a Monday user is a real, current person.
                    active = CASE WHEN source = 'board_name' THEN 1 ELSE active END,
                    source = CASE WHEN source = 'board_name' THEN 'monday' ELSE source END,
                    updated_at = datetime('now')
              WHERE id = ?`,
          ).run(mondayId, u.email?.trim() || null, existing);
          addAlias(db, existing, u.name, { ifFree: true });
          result.mondayUpdated++;
        } else {
          const id = createStaff(db, { name: u.name, email: u.email, mondayUserId: mondayId, source: "monday" });
          db.prepare("UPDATE staff SET monday_seen_at = datetime('now') WHERE id = ?").run(id);
          result.mondayAdded++;
        }
      }
      const gone = db
        .prepare("SELECT name, monday_user_id FROM staff WHERE source = 'monday' AND active = 1 AND monday_user_id IS NOT NULL")
        .all() as { name: string; monday_user_id: string }[];
      result.missingFromMonday = gone.filter((g) => !seen.has(g.monday_user_id)).map((g) => g.name);
    }

    // 2. Names on the boards that match no one → inactive board_name rows.
    let resolve = makeStaffResolver(db);
    const allNames = new Set([
      ...input.boardNames.paralegals.keys(),
      ...input.boardNames.attorneys.keys(),
      ...(input.boardNames.assistants?.keys() ?? []),
    ]);
    for (const name of allNames) {
      if (resolve(name)) continue;
      createStaff(db, { name, active: false, source: "board_name" });
      result.boardNamesAdded++;
    }
    resolve = makeStaffResolver(db);

    // 3. Suggested roles, only for people an admin hasn't reviewed yet.
    const suggestions = new Map<number, Set<StaffRole>>();
    const suggest = (name: string | undefined, role: StaffRole) => {
      const p = resolve(name);
      if (!p) return;
      if (!suggestions.has(p.id)) suggestions.set(p.id, new Set());
      suggestions.get(p.id)!.add(role);
    };
    for (const n of input.boardNames.paralegals.keys()) suggest(n, "paralegal");
    for (const n of input.boardNames.attorneys.keys()) suggest(n, "attorney");
    for (const b of input.attorneyBoards) suggest(b.attorneyName, "attorney");
    const unreviewed = new Set(
      (db.prepare("SELECT id FROM staff WHERE roles_reviewed = 0").all() as { id: number }[]).map((r) => r.id),
    );
    const insRole = db.prepare("INSERT OR IGNORE INTO staff_roles (staff_id, role) VALUES (?, ?)");
    for (const [id, roles] of suggestions) {
      if (!unreviewed.has(id)) continue;
      for (const r of roles) result.rolesSuggested += insRole.run(id, r).changes;
    }

    // An attorney board named for a person, with no board set on them yet.
    for (const b of input.attorneyBoards) {
      const p = resolve(b.attorneyName);
      if (p) db.prepare("UPDATE staff SET attorney_board = ? WHERE id = ? AND attorney_board IS NULL").run(b.boardKey, p.id);
    }

    // 4. Logins: carry over paralegal_link / attorney_board, link by email/name.
    const logins = db
      .prepare("SELECT id, email, name, monday_name, paralegal_link, attorney_board, staff_id FROM users")
      .all() as Array<{
      id: number;
      email: string;
      name: string;
      monday_name: string | null;
      paralegal_link: string | null;
      attorney_board: string | null;
      staff_id: number | null;
    }>;
    for (const u of logins) {
      let staffId = u.staff_id;
      if (!staffId) {
        staffId = resolve(u.paralegal_link)?.id ?? matchLoginToStaff(db, u);
        if (staffId) {
          linkLogin(db, u.id, staffId);
          result.loginsLinked++;
        }
      }
      if (!staffId) continue;
      if (u.paralegal_link) addAlias(db, staffId, u.paralegal_link, { ifFree: true });
      if (u.attorney_board) {
        db.prepare("UPDATE staff SET attorney_board = ? WHERE id = ? AND attorney_board IS NULL").run(u.attorney_board, staffId);
      }
    }
  })();

  return result;
}

function findForMondayUser(db: Database, mondayId: string, u: MondayWorkspaceUser): number | null {
  const byId = db.prepare("SELECT id FROM staff WHERE monday_user_id = ?").get(mondayId) as { id: number } | undefined;
  if (byId) return byId.id;
  // An existing row without a Monday id: same name, or same email.
  const p = makeStaffResolver(db)(u.name);
  if (p && !p.mondayUserId) return p.id;
  const email = u.email?.trim().toLowerCase();
  if (email) {
    const byEmail = db
      .prepare("SELECT id FROM staff WHERE lower(email) = ? AND monday_user_id IS NULL")
      .get(email) as { id: number } | undefined;
    if (byEmail) return byEmail.id;
  }
  return null;
}

/** Names on the boards that resolve to no one, with how many items carry them. */
export function unmatchedBoardNames(db: Database, names: BoardNames): Array<{ name: string; items: number }> {
  const resolve = makeStaffResolver(db);
  const counts = new Map<string, number>();
  for (const m of [names.paralegals, names.attorneys, names.assistants ?? new Map<string, number>()]) {
    for (const [n, c] of m) if (!resolve(n)) counts.set(n, (counts.get(n) ?? 0) + c);
  }
  return [...counts].map(([name, items]) => ({ name, items })).sort((a, b) => b.items - a.items);
}

// -----------------------------------------------------------------------------

function toMember(r: StaffRow): Omit<StaffMember, "roles" | "aliases" | "login"> {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    mondayUserId: r.monday_user_id,
    phoneExt: r.phone_ext,
    attorneyBoard: r.attorney_board,
    active: r.active === 1,
    startDate: r.start_date,
    endDate: r.end_date,
    source: r.source,
    mondaySeenAt: r.monday_seen_at,
    rolesReviewed: r.roles_reviewed === 1,
  };
}

function sortRoles(roles: StaffRole[]): StaffRole[] {
  return [...new Set(roles)].sort((a, b) => STAFF_ROLES.indexOf(a) - STAFF_ROLES.indexOf(b));
}

function groupBy<T, K>(items: T[], key: (t: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const it of items) {
    const k = key(it);
    const list = out.get(k);
    if (list) list.push(it);
    else out.set(k, [it]);
  }
  return out;
}
