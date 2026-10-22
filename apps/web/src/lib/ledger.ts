// =============================================================================
// The firm's case-number ledger — highest number used in a year
// =============================================================================
// "SCAL Client Database2.xlsx" in SCALDocs / Client Database: one tab per year
// ("2026"), first row headings (Case No. · Name · Date Opened · Date Closed ·
// Case Type · Information), then one row per hire. Staff type the numbers, so
// they come as "26-230", "26230", "26 - 230", sometimes with stray spaces.
// P21 reads it before showing a case number: the next number has to be free in
// the ledger as well as on Monday. See docs/features/consult-to-efile.md.
// =============================================================================

export const LEDGER_URL =
  "https://sharmacrawford.sharepoint.com/sites/SCALDocs/Shared Documents/Client Database/SCAL Client Database2.xlsx";

export interface LedgerCheck {
  /** Highest YY-NNN in the tab's first column, or null when the tab has none. */
  highest: string | null;
  /** The row that holds it: [case no, name, date opened…] as text. */
  highestRow: string[];
  /** Numbers that appear more than once in the tab. */
  duplicates: string[];
}

const cellText = (v: unknown) => (v === null || v === undefined ? "" : String(v)).replace(/\s+/g, " ").trim();

function caseNo(v: unknown, year: string): string | null {
  const m = /^(\d{2})\s*-*\s*(\d{3})$/.exec(cellText(v));
  return m && m[1] === year ? `${m[1]}-${m[2]}` : null;
}

/** A year tab's used range (rows of cells) → its highest case number for `year` ("26"). */
export function checkLedgerTab(values: unknown[][], year: string): LedgerCheck {
  let highest: string | null = null;
  let highestRow: string[] = [];
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const row of values) {
    const n = caseNo(row[0], year);
    if (!n) continue;
    if (seen.has(n)) duplicates.add(n);
    seen.add(n);
    if (!highest || n > highest) {
      highest = n;
      highestRow = row.slice(0, 5).map(cellText);
    }
  }
  return { highest, highestRow, duplicates: [...duplicates].sort() };
}

/** The larger of two YY-NNN numbers (null-safe). */
export function maxCaseNo(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

/** "26-230" → "26-231". */
export function followingCaseNo(caseNo: string): string {
  return `${caseNo.slice(0, 2)}-${String(Number(caseNo.slice(3)) + 1).padStart(3, "0")}`;
}
