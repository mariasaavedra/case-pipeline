// =============================================================================
// Which Monday column records a folder
// =============================================================================
// A client folder means different things depending on where it lives, and the
// Profiles board has a column for each meaning:
//
//   SCAL Consults  → "Consult File"  — they consulted, they have not hired
//   SCAL E-Files   → "E-File"        — they hired; this is the live case file
//   SCAL Closed    → "E-File"        — the case finished and the folder moved
//
// The last one is the non-obvious case, and getting it wrong is the reason this
// is a named function with a test rather than an inline ternary: writing a
// SCAL Closed URL into "Consult File" would record a finished case as a pending
// consultation, in the exact column the Documents tab and the appointment-board
// mirrors read.
//
// There is no separate "Closed File" column on Profiles. The firm already
// handles closure by re-pointing E-File at the new location by hand, so this
// follows the convention that exists rather than inventing a column.
// =============================================================================

export interface LinkTarget {
  /** Monday column id on the Profiles board. */
  columnId: string;
  /** Key in raw_column_values, for checking what is already recorded. */
  columnKey: string;
  /** Human label, for the report. */
  label: string;
}

export const CONSULT_FILE: LinkTarget = {
  columnId: "text_mkxphk77",
  columnKey: "consult_file",
  label: "Consult File",
};

export const E_FILE: LinkTarget = {
  columnId: "e_file__1",
  columnKey: "e_file",
  label: "E-File",
};

/** Site (as it appears in the URL) → the column that should hold it. */
export function linkTargetForSite(site: string): LinkTarget {
  return site.toLowerCase() === "scalconsults" ? CONSULT_FILE : E_FILE;
}
