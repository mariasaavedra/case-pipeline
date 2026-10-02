// =============================================================================
// Reading the consult upload tree's folder names
// =============================================================================
// The Zapier automation builds, per Calendly booking:
//
//   Virtual Appointments - NEW            ← the root shared with the service account
//     OCTOBER                             ← month (no year; reused every year)
//       October 02, 2026                  ← day
//         M                               ← attorney initials = appointments_m
//           10:00 LOPEZ LEAL, Yemil       ← slot: time, SURNAME, Given
//             Consult Documents Yemil LOPEZ LEAL - October 02, 2026 at 10:00
//               …client uploads…          ← the folder the client is sent
//
// Times are 12-hour without am/pm ("01:30" is half past one in the afternoon),
// and a reschedule creates a whole new branch, so the date and time here are
// where the consult was booked at the time, not necessarily where it is now.
// The matcher treats them as a hint for that reason.
// =============================================================================

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/** "October 02, 2026" → "2026-10-02". */
export function parseDayFolder(name: string): string | null {
  const m = name.trim().match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
  if (!m) return null;
  return isoDate(m[1]!, m[2]!, m[3]!);
}

/** "M", "LB", "CR" → "m", "lb", "cr" (the appointments_<initials> suffix). */
export function parseAttorneyFolder(name: string): string | null {
  const m = name.trim().match(/^([A-Za-z]{1,4})$/);
  return m ? m[1]!.toLowerCase() : null;
}

export interface SlotFolder {
  time: string;
  surname: string;
  given: string;
}

/**
 * "10:00 LOPEZ LEAL, Yemil" → time + the surname/given split, exactly as booked.
 * The given name is often blank ("01:00 HEMZANI, ") — most slot folders in
 * October 2026 — and is then taken from the upload folder.
 */
export function parseSlotFolder(name: string): SlotFolder | null {
  const m = name.match(/^\s*(\d{1,2}:\d{2})\s+(.+?),\s*(.*?)\s*$/);
  if (!m || !m[2]!.trim()) return null;
  return { time: m[1]!, surname: m[2]!.trim(), given: m[3]! };
}

/** "Luis Angel ESPARZA REYES" minus the surname "ESPARZA REYES" → "Luis Angel". */
function givenFrom(fullName: string, surname: string): string {
  const full = fullName.trim();
  if (surname && full.toUpperCase().endsWith(surname.toUpperCase())) return full.slice(0, full.length - surname.length).trim();
  // Booked as SURNAME in capitals: everything before the first all-caps word.
  const words = full.split(/\s+/);
  const firstCaps = words.findIndex((w) => w.length > 1 && w === w.toUpperCase());
  return (firstCaps > 0 ? words.slice(0, firstCaps) : words.slice(0, 1)).join(" ");
}

export interface UploadFolder {
  fullName: string;
  date: string;
  time: string;
}

/** "Consult Documents Yemil LOPEZ LEAL - October 02, 2026 at 10:00". */
export function parseUploadFolder(name: string): UploadFolder | null {
  const m = name
    .trim()
    .match(/^Consult Documents\s+(.+?)\s+-\s+([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s+at\s+(\d{1,2}:\d{2})$/i);
  if (!m) return null;
  const date = isoDate(m[2]!, m[3]!, m[4]!);
  return date ? { fullName: m[1]!.trim(), date, time: m[5]! } : null;
}

function isoDate(month: string, day: string, year: string): string | null {
  const mi = MONTHS.indexOf(month.toLowerCase());
  const d = Number(day);
  if (mi < 0 || d < 1 || d > 31) return null;
  return `${year}-${String(mi + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** What a file's position in the tree says about whose upload it is. */
export interface UploadContext {
  /** appointments_<initials> */
  boardKey: string;
  /** The consult date the folder was made for. */
  date: string;
  surname: string;
  given: string;
  /** Folder names from the root down, for receipts and review. */
  path: string[];
}

export type ContextResult =
  | { ok: true; context: UploadContext }
  | { ok: false; reason: string; path: string[] };

/**
 * Read a file's ancestor folders (root first, root itself excluded) into who
 * and when. Needs the day, the attorney and a name; the name comes from the
 * slot folder, which splits surname from given name, else from the upload
 * folder. A file placed anywhere else in the tree is not guessed at.
 */
export function readContext(ancestors: string[]): ContextResult {
  const fail = (reason: string): ContextResult => ({ ok: false, reason, path: ancestors });

  // [month, day, attorney, slot, upload?, …deeper]
  if (ancestors.length < 4) return fail("not inside a client folder");
  const date = parseDayFolder(ancestors[1]!);
  if (!date) return fail(`day folder not recognised: "${ancestors[1]}"`);
  const initials = parseAttorneyFolder(ancestors[2]!);
  if (!initials) return fail(`attorney folder not recognised: "${ancestors[2]}"`);

  const boardKey = `appointments_${initials}`;
  const slot = parseSlotFolder(ancestors[3]!);
  const upload = ancestors[4] ? parseUploadFolder(ancestors[4]) : null;

  if (slot?.given) {
    return { ok: true, context: { boardKey, date, surname: slot.surname, given: slot.given, path: ancestors } };
  }
  if (slot && upload) {
    const given = givenFrom(upload.fullName, slot.surname);
    if (given) return { ok: true, context: { boardKey, date, surname: slot.surname, given, path: ancestors } };
  }
  if (upload) {
    const words = upload.fullName.split(/\s+/);
    const given = givenFrom(upload.fullName, "");
    const surname = words.slice(given.split(/\s+/).length).join(" ");
    if (given && surname) return { ok: true, context: { boardKey, date, surname, given, path: ancestors } };
  }
  return fail(slot ? `no given name for "${ancestors[3]}"` : `client folder not recognised: "${ancestors[3]}"`);
}
