// =============================================================================
// Is this client detained? — the one rule behind every "Detained" pill
// =============================================================================
// P3.0's header, P17 reception and P4 My Day all ask this. Until 2026-10-22 the
// answer was only the Det. Facility on an open court case, which staff fill on
// 3 of 221 open cases: they write the detention in the NAME instead
// ("Daniel SOLORZANO LOPEZ (DETAINED IN CORE CIVIC)"), and a new detainee from
// a jail intake has no court case at all. 0 of 283 such profiles showed it.
//
// Now, in order:
//   1. Det. Facility on an open ("Court Case" group) court case — where, for sure.
//   2. "Det" / "Detained" in an open court case's name, or in the profile's
//      name while the client is active (an open court case, or an appointment
//      in the last DETENTION_WINDOW_DAYS days).
//   3. A recent appointment that came from a jail intake (its Jail Intakes
//      link), or whose status is Det Hire / Det No Hire / Today's consult
//      (detainee), or whose name says Det / Detained.
//
// A release (M17) beats 2 and 3: the name keeps its "(Det. at …)" after the
// client walks out, so a release recorded in detention_releases (or its E&A
// "Released from detention" entry, once synced) switches the name signals off
// for good, and an appointment signal off unless the appointment is later
// than the release — a client detained again comes back on. 1 needs no help:
// a release clears Det. Facility itself.
//
// Old detainees are why 2 and 3 are bounded by recency: 283 profiles say
// "Detained" in their name, most from cases closed or deported years ago.
// =============================================================================

import type BetterSqlite3 from "better-sqlite3";
type Database = BetterSqlite3.Database;
import type { Detention } from "./types";

/** An appointment, or the activity that makes a profile's name count, within this many days. */
export const DETENTION_WINDOW_DAYS = 180;

/** Appointment statuses that mean a detainee consult (labels as on the boards). */
const DETAINEE_STATUSES = new Set(["det hire", "det no hire", "today's consult (detainee)"]);

const DET_WORD = /\b(?:detained|det)\b/i;
const RELEASED_WORD = /\breleased\b/i;
/** Inside a bracket: "Det Greene Co", "Detained at Greene County", "DETAINED IN CHASE". */
const BRACKET_NOTE = /^\s*(?:detained|det)\b\.?\s*(?:(?:in|at)\b\.?\s*)?(.*)$/i;
/** Outside one, only with "in" / "at" — "DETAINED Fidencio MERCADO" names no place. */
const INLINE_NOTE = /\b(?:detained|det)\b\.?\s+(?:in|at)\b\.?\s+([^()[\]|]+)/i;

function tidyPlace(raw: string | undefined): string | null {
  const place = (raw ?? "").replace(/^the\s+/i, "").replace(/[\s,;:-]+$/, "").trim();
  if (!place || /\d/.test(place)) return null;
  // "CORE CIVIC" → "Core Civic"; "CoreCivic", "Greene Co." stay as typed.
  if (place === place.toUpperCase()) {
    return place.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_m, sep: string, c: string) => sep + c.toUpperCase());
  }
  return place;
}

/**
 * What a name says about detention: null when it says nothing (or says
 * "released"), else where, when it names a place.
 *
 *   "Felipe P. PEDRAZA [A221-455-464](Det. at Greene Co.)" → { at: "Greene Co." }
 *   "DETAINED Fidencio MERCADO"                           → { at: null }
 */
export function detentionNote(name: string | null | undefined): { at: string | null } | null {
  if (!name || !DET_WORD.test(name) || RELEASED_WORD.test(name)) return null;
  for (const m of name.matchAll(/[[(]([^\])]*)[\])]?/g)) {
    const note = BRACKET_NOTE.exec(m[1]!);
    if (note) return { at: tidyPlace(note[1]) };
  }
  return { at: tidyPlace(INLINE_NOTE.exec(name)?.[1]) };
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
}

interface FacilityRow { pid: string; facility: string }
interface CaseRow { pid: string; name: string }
interface ApptRow { pid: string; name: string; status: string | null; date: string | null; fromIntake: number }
interface ReleaseRow { pid: string; releasedOn: string | null }

function placeholders(n: number): string {
  return Array.from({ length: n }, () => "?").join(",");
}

/**
 * The detention of each profile (by local id) that is detained; profiles that
 * aren't are absent. One query per signal for the whole batch.
 */
export function batchGetDetentions(
  db: Database,
  profileLocalIds: string[],
  opts: { today?: string } = {},
): Map<string, Detention> {
  const out = new Map<string, Detention>();
  const ids = [...new Set(profileLocalIds.filter(Boolean))];
  if (!ids.length) return out;
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const ph = placeholders(ids.length);

  // 1. Det. Facility on an open court case, newest first (same order as getOpenDetentions).
  const facilities = db.prepare(`
      SELECT profile_local_id AS pid, json_extract(column_values, '$.det_facility.label') AS facility
        FROM board_items
       WHERE profile_local_id IN (${ph})
         AND board_key = 'court_cases' AND group_title = 'Court Case' AND deleted_at IS NULL
         AND COALESCE(json_extract(column_values, '$.det_facility.label'), '') <> ''
       ORDER BY COALESCE(updated_at_source, created_at) DESC
    `).all(...ids) as FacilityRow[];
  for (const f of facilities) if (!out.has(f.pid)) out.set(f.pid, { at: f.facility, source: "facility" });

  const rest = ids.filter((id) => !out.has(id));
  if (!rest.length) return out;
  const rph = placeholders(rest.length);

  const openCases = db.prepare(`
      SELECT profile_local_id AS pid, name FROM board_items
       WHERE profile_local_id IN (${rph})
         AND board_key = 'court_cases' AND group_title = 'Court Case' AND deleted_at IS NULL
    `).all(...rest) as CaseRow[];
  const appts = db.prepare(`
      SELECT profile_local_id AS pid, name, status,
             json_extract(column_values, '$.consult_date.date') AS date,
             json_extract(column_values, '$.jail_intakes.linked_item_ids[0]') IS NOT NULL AS fromIntake
        FROM board_items
       WHERE profile_local_id IN (${rph})
         AND board_key LIKE 'appointments\\_%' ESCAPE '\\' AND deleted_at IS NULL
       ORDER BY date DESC
    `).all(...rest) as ApptRow[];
  const profiles = db.prepare(`
      SELECT local_id AS pid, name, monday_item_id AS mondayId FROM profiles WHERE local_id IN (${rph})
    `).all(...rest) as Array<{ pid: string; name: string; mondayId: string | null }>;
  // A release from M17 (immediate), or its E&A entry (after the next full sync).
  const releases = db.prepare(`
      SELECT p.local_id AS pid, COALESCE(r.released_on, substr(r.created_at, 1, 10)) AS releasedOn
        FROM detention_releases r JOIN profiles p ON p.monday_item_id = r.profile_monday_id
       WHERE p.local_id IN (${rph})
      UNION ALL
      SELECT profile_local_id AS pid, substr(created_at_source, 1, 10) AS releasedOn
        FROM client_updates
       WHERE profile_local_id IN (${rph}) AND title LIKE 'Released from detention%'
    `).all(...rest, ...rest) as ReleaseRow[];

  const group = <T extends { pid: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) m.set(r.pid, [...(m.get(r.pid) ?? []), r]);
    return m;
  };
  const casesBy = group(openCases);
  const apptsBy = group(appts);
  const releasedBy = new Map<string, string>();
  for (const r of releases) {
    const d = r.releasedOn ?? "";
    if (d > (releasedBy.get(r.pid) ?? "")) releasedBy.set(r.pid, d);
  }

  for (const p of profiles) {
    const released = releasedBy.get(p.pid) ?? null;
    const cases = casesBy.get(p.pid) ?? [];
    const recentAppts = (apptsBy.get(p.pid) ?? []).filter(
      (a) => a.date && daysBetween(today, a.date) <= DETENTION_WINDOW_DAYS,
    );
    // Where, from the first name that names a place: case, profile, then appointments.
    const notes = [...cases.map((c) => c.name), p.name, ...recentAppts.map((a) => a.name)].map(detentionNote);
    const at = notes.find((n) => n?.at)?.at ?? null;

    // 2. Names — off for good once a release is recorded.
    if (!released) {
      const active = cases.length > 0 || recentAppts.length > 0;
      if (cases.some((c) => detentionNote(c.name)) || (active && detentionNote(p.name))) {
        out.set(p.pid, { at, source: "name" });
        continue;
      }
    }

    // 3. A recent detainee appointment, later than any release.
    const appt = recentAppts.find(
      (a) =>
        (!released || a.date! > released) &&
        (a.fromIntake || DETAINEE_STATUSES.has((a.status ?? "").trim().toLowerCase()) || detentionNote(a.name)),
    );
    if (appt) out.set(p.pid, { at, source: appt.fromIntake ? "intake" : "appointment" });
  }
  return out;
}

export function getDetention(db: Database, profileLocalId: string, opts: { today?: string } = {}): Detention | null {
  return batchGetDetentions(db, [profileLocalId], opts).get(profileLocalId) ?? null;
}
