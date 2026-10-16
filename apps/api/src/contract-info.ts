// =============================================================================
// Contract info — what a Fee K needs before a contract can be generated
// =============================================================================
// P14 flags five things as "missing": Contract for, AF, Attorney, E-mail,
// Address (pending-contracts.ts MISSING_FIELDS). Case type and fees live on the
// Fee K; the attorney is the Fee K's People column; e-mail and address live on
// the client's PROFILE — the Fee K only mirrors them, so they are written there.
//
// Shared by the create route (M11 / M2: all five required) and M25 Edit
// contract (routes/contract-fees.ts). Pure planning here, unit-tested; the
// routes do the Monday writes.
// =============================================================================

import type BetterSqlite3 from "better-sqlite3";
type DatabaseInstance = BetterSqlite3.Database;
import type { BoardColumns } from "@case-pipeline/query";
import type { MondayWorkspaceUser } from "@case-pipeline/monday";
import { loadDocumentSettings } from "./documents/document-settings.js";
import { staffForUser } from "./staff/roster.js";
import { getWorkspaceUsers } from "./staff/workspace-users.js";

/** Fee Ks "Attorney" (People) — config/boards.yaml fee_ks.attorney. */
export const FEE_K_ATTORNEY = { id: "deal_owner", key: "attorney" } as const;
/** Profile columns the Fee K mirrors (config/boards.yaml profiles.email / physical_address). */
export const PROFILE_CONTACT = {
  email: { id: "email__1", key: "email", label: "E-mail" },
  address: { id: "text_mkrkrsgj", key: "physical_address", label: "Address" },
} as const;
export type ContactKey = keyof typeof PROFILE_CONTACT;

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MAX_ADDRESS = 300;

const norm = (s: string) => s.trim().replace(/\s+/g, " ");
const same = (a: string | null | undefined, b: string | null | undefined) =>
  norm(a ?? "").toLowerCase() === norm(b ?? "").toLowerCase();

/** "A, B" (a People label) → names; e-mails dropped. */
export function splitPeople(raw: string | null | undefined): string[] {
  return (raw ?? "").split(",").map((s) => s.trim()).filter((s) => s && !s.includes("@"));
}

/**
 * Who can be picked as the attorney: Settings → Documents first (they have
 * e-mails, which Adobe Sign needs), then anyone already named on a Fee K.
 */
export function contractAttorneys(db: DatabaseInstance): string[] {
  const out: string[] = [];
  const add = (n: string) => { const v = norm(n); if (v && !out.some((o) => same(o, v))) out.push(v); };
  for (const a of loadDocumentSettings().attorneys) add(`${a.givenName} ${a.familyName}`);
  const rows = db.prepare(
    "SELECT DISTINCT json_extract(raw_column_values, '$.attorney.label') AS a FROM contracts WHERE deleted_at IS NULL",
  ).all() as { a: string | null }[];
  for (const name of rows.flatMap((r) => splitPeople(r.a)).sort((x, y) => x.localeCompare(y))) add(name);
  return out;
}

/**
 * Monday user id for an attorney's name. The roster first (Settings e-mail,
 * then the name or any alias), then the shared workspace list (e-mail, then
 * name). The list is only fetched when the roster has no Monday id.
 */
export function makeMondayUserResolver(token: string | undefined, rosterDb: DatabaseInstance | null) {
  return async (name: string): Promise<number | null> => {
    const settings = loadDocumentSettings().attorneys.find((a) => same(`${a.givenName} ${a.familyName}`, name));
    const hit = await findMondayUser(token, rosterDb, settings?.email ?? "", name);
    return hit?.id ?? null;
  };
}

export const peopleValue = (userId: number) => ({ personsAndTeams: [{ id: userId, kind: "person" }] });

/** Fee Ks "Assistant" (People) — config/boards.yaml fee_ks.assistant. */
export const FEE_K_ASSISTANT = { id: "people__1", key: "assistant" } as const;

/** The signed-in user's Monday id: by login e-mail, else by name — roster first, then Monday's list. */
export function makeMondayUserByLogin(token: string | undefined, rosterDb: DatabaseInstance | null) {
  return (email: string, name: string): Promise<{ id: number; name: string } | null> =>
    findMondayUser(token, rosterDb, email, name);
}

async function findMondayUser(
  token: string | undefined,
  rosterDb: DatabaseInstance | null,
  email: string,
  name: string,
): Promise<{ id: number; name: string } | null> {
  const staff = rosterDb ? staffForUser(rosterDb, { email, name }) : null;
  const fromRoster = Number(staff?.mondayUserId ?? NaN);
  if (staff && Number.isFinite(fromRoster)) return { id: fromRoster, name: staff.name };
  const users: MondayWorkspaceUser[] = await getWorkspaceUsers(token);
  // The roster's spellings of this person reach Monday under their own name too.
  const names = [name, ...(staff ? [staff.name, ...staff.aliases] : [])].filter(Boolean);
  const hit = (email && users.find((u) => same(u.email, email)))
    || (staff?.email && users.find((u) => same(u.email, staff.email)))
    || users.find((u) => names.some((n) => same(u.name, n)));
  const id = hit ? Number(hit.id) : NaN;
  return hit && Number.isFinite(id) ? { id, name: hit.name } : null;
}

/** A profile contact value in the shape its Monday column takes. */
export function contactValue(schema: BoardColumns | null, key: ContactKey, value: string): unknown {
  const col = schema?.columns.find((c) => c.columnId === PROFILE_CONTACT[key].id);
  if (value === "") return col?.type === "email" ? {} : "";
  return col?.type === "email" ? { email: value, text: value } : value;
}

export interface ContactInput {
  email?: unknown;
  address?: unknown;
}

/** Validate typed e-mail / address. Returns the cleaned values or an error. */
export function cleanContact(input: ContactInput, required: boolean): { email?: string; address?: string } | { error: string } {
  const out: { email?: string; address?: string } = {};
  if (input.email !== undefined || required) {
    const email = typeof input.email === "string" ? input.email.trim() : "";
    if (required && !email) return { error: "The client's e-mail is required" };
    if (email && !EMAIL_RE.test(email)) return { error: `"${email}" is not an e-mail address` };
    out.email = email;
  }
  if (input.address !== undefined || required) {
    const address = typeof input.address === "string" ? norm(input.address) : "";
    if (required && !address) return { error: "The client's address is required" };
    if (address.length > MAX_ADDRESS) return { error: `The address can be at most ${MAX_ADDRESS} characters` };
    out.address = address;
  }
  return out;
}

export interface ProfileContactPlan {
  /** Monday column id → value, only what changed. */
  values: Record<string, unknown>;
  /** profiles table column → new value, for the optimistic local update. */
  local: Partial<Record<"email" | "address", string>>;
  changed: ContactKey[];
}

/** What to write to the profile: only fields that differ from what it holds. */
export function planProfileContact(
  current: { email: string | null; address: string | null },
  next: { email?: string; address?: string },
  schema: BoardColumns | null,
): ProfileContactPlan {
  const plan: ProfileContactPlan = { values: {}, local: {}, changed: [] };
  for (const key of ["email", "address"] as const) {
    const v = next[key];
    if (v === undefined || same(v, current[key])) continue;
    plan.values[PROFILE_CONTACT[key].id] = contactValue(schema, key, v);
    plan.local[key] = v;
    plan.changed.push(key);
  }
  return plan;
}

/** Apply a profile contact plan to the local mirror (P14, M22 pre-fill see it at once). */
export function applyProfileContactLocally(db: DatabaseInstance, profileLocalId: string, local: ProfileContactPlan["local"]): void {
  if (local.email !== undefined) db.prepare("UPDATE profiles SET email = ? WHERE local_id = ?").run(local.email, profileLocalId);
  if (local.address !== undefined) db.prepare("UPDATE profiles SET address = ? WHERE local_id = ?").run(local.address, profileLocalId);
}
