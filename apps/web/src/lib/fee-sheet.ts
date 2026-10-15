// =============================================================================
// The firm's fee sheet — job → attorney fee (AF) + filing fee (FF)
// =============================================================================
// Staff keep the firm's prices in an Excel file in SharePoint ("FINAL COPY OF
// FIRM FEES 2026.xlsx" in Fee Contracts; sharepoint/graph.ts loadFeeSheet finds
// the newest "…fees….xlsx" there, so next year's copy is picked up by itself).
// M22 and M25 offer its jobs in a picker that fills AF + FF (decided
// 2026-10-15); the sheet stays the one place prices change.
//
// The sheet is written for people, so amounts are not always numbers: "TBD",
// "$4000-inter. extra", "$185 for K's it is $265", "Check filing category +
// EAD tab". Only a plain amount fills a field ("$3,500.00", "3500", and the
// European "$3.500,00" the sheet also has); anything else leaves the field as
// it was and is shown to the user as text, next to the row's note.
// =============================================================================

export interface FeeSheetRow {
  job: string;
  attorneyFee: number | null;
  filingFee: number | null;
  /** The cell as written when it isn't a plain amount ("TBD"…); "" otherwise. */
  attorneyFeeText: string;
  filingFeeText: string;
  /** The row's remarks ("+$100 postage", "USCIS ONLINE NO POSTAGE REQUIRED"…). */
  note: string;
}

const cellText = (v: unknown) => (v === null || v === undefined ? "" : String(v)).replace(/\s+/g, " ").trim();

/** A plain amount → dollars; anything else → null. */
export function parseAmount(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) && raw >= 0 ? raw : null;
  const s = cellText(raw).replace(/^\$\s*/, "").replace(/\s*(usd)?$/i, "");
  if (!/^\d{1,3}([.,]\d{3})*([.,]\d{1,2})?$|^\d+([.,]\d{1,2})?$/.test(s)) return null;
  // The last separator followed by 1–2 digits is the decimal point; the rest group thousands.
  const dec = /[.,](\d{1,2})$/.exec(s);
  const whole = (dec ? s.slice(0, dec.index) : s).replace(/[.,]/g, "");
  const n = Number(`${whole}${dec ? `.${dec[1]}` : ""}`);
  return Number.isFinite(n) ? n : null;
}

/**
 * The sheet's cells (first worksheet, as Excel returns them) → its jobs. The
 * header row is the one whose first cell is "Job"; AF and FF are found by their
 * header, every other filled cell of a row is its note.
 */
export function parseFeeSheet(values: unknown[][]): FeeSheetRow[] {
  const headerAt = values.findIndex((r) => /^job$/i.test(cellText(r[0])));
  if (headerAt < 0) return [];
  const header = values[headerAt]!.map((h) => cellText(h).toLowerCase());
  const af = header.indexOf("af");
  const ff = header.indexOf("ff");
  const out: FeeSheetRow[] = [];
  for (const r of values.slice(headerAt + 1)) {
    const job = cellText(r[0]);
    if (!job) continue;
    const at = (i: number) => (i >= 0 ? r[i] : undefined);
    const attorneyFee = parseAmount(at(af));
    const filingFee = parseAmount(at(ff));
    const note = r
      .map((c, i) => ({ c: cellText(c), i }))
      .filter(({ c, i }) => c && i !== 0 && i !== af && i !== ff && !/surcharge/.test(header[i] ?? ""))
      .map(({ c }) => c)
      .join(" · ");
    out.push({
      job,
      attorneyFee,
      filingFee,
      attorneyFeeText: attorneyFee === null ? cellText(at(af)) : "",
      filingFeeText: filingFee === null ? cellText(at(ff)) : "",
      note,
    });
  }
  return out;
}
