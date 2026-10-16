// =============================================================================
// Staff names on board pages — one entry per person
// =============================================================================
// Boards spell one person several ways ("Mayra Ruiz", "mayra ruiz ", "Mayra R.").
// The API owns the roster (users.db) and passes its matcher in as a
// StaffResolver, so this package never touches users.db. A page's query maps
// every name it returns through StaffNames: the roster name when the person is
// known, the board's own spelling otherwise, and it reports which of those
// people are inactive so pickers can mark them.
//
// Display only. Anything compared against Monday (a write's `from` check) keeps
// the board's own spelling.
// =============================================================================

export type StaffResolver = (name: string) => { id: number; name: string; active: boolean } | null;

export interface StaffNames {
  /** One name → the roster name, else the trimmed spelling. */
  one(name: string): string;
  /** A people cell ("A, B") → the same cell with each name mapped. Empty → null. */
  cell(text: string | null | undefined): string | null;
  /** Names → mapped and de-duplicated, order kept. */
  list(names: string[]): string[];
  /** Roster names seen so far whose person is inactive, sorted. */
  inactive(): string[];
}

export function makeStaffNames(resolve?: StaffResolver): StaffNames {
  const inactive = new Set<string>();
  const one = (name: string) => {
    const p = resolve?.(name);
    if (!p) return name.trim();
    if (!p.active) inactive.add(p.name);
    return p.name;
  };
  const list = (names: string[]) => [...new Set(names.map(one))];
  return {
    one,
    list,
    cell: (text) => {
      const names = (text ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      return names.length ? list(names).join(", ") : null;
    },
    inactive: () => [...inactive].sort((a, b) => a.localeCompare(b)),
  };
}

/**
 * Every spelling in `candidates` that is the same person as `name` — what a
 * filter picked by roster name has to match in the raw board cells.
 */
export function spellingsOf(name: string, candidates: Iterable<string>, resolve?: StaffResolver): string[] {
  const names = makeStaffNames(resolve);
  const target = names.one(name);
  const out = new Set([name]);
  for (const c of candidates) if (names.one(c) === target) out.add(c);
  return [...out];
}
