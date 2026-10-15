// =============================================================================
// FeeSheetPicker — "From fee sheet": pick a job, get its AF + FF
// =============================================================================
// In M22 Generate contract and M25 Edit contract. The jobs come from the firm's
// fee sheet in SharePoint, read when the picker is first opened
// (lib/fee-sheet.ts + sharepoint/graph.ts loadFeeSheet), so a price staff change
// in Excel is what the next contract gets. Typing filters the list (a native
// datalist); picking a job hands its amounts to the form, which still lets
// them be changed by hand. An amount the sheet writes as text ("TBD") fills
// nothing and is shown instead, with the row's note.
// =============================================================================

import { useEffect, useId, useState } from "react";
import { loadFeeSheet } from "../sharepoint/graph";
import { parseFeeSheet, type FeeSheetRow } from "../lib/fee-sheet";
import { money } from "../lib/contract-fill";

interface Sheet { name: string; webUrl: string; rows: FeeSheetRow[] }

// One read per page load; the sheet changes rarely and every picker shares it.
let cached: Promise<Sheet> | null = null;
function sheetOnce(): Promise<Sheet> {
  cached ??= loadFeeSheet()
    .then((s) => ({ name: s.name, webUrl: s.webUrl, rows: parseFeeSheet(s.values) }))
    .catch((e: unknown) => { cached = null; throw e; });
  return cached;
}

interface Props {
  /** The job's amounts; null filingFee = the sheet has none for this job. undefined = the sheet's cell isn't an amount (leave the field). */
  onPick: (fees: { attorneyFee?: number; filingFee?: number | null }, row: FeeSheetRow) => void;
}

const inputStyle = { borderColor: "var(--color-border)", background: "var(--color-surface)", color: "var(--color-ink)" } as const;

export function FeeSheetPicker({ onPick }: Props) {
  const id = useId();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<FeeSheetRow | null>(null);

  const load = () => {
    if (sheet || error) return;
    sheetOnce().then(setSheet).catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not read the fee sheet"));
  };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (job: string) => {
    setText(job);
    const row = sheet?.rows.find((r) => r.job === job);
    if (!row) return;
    setPicked(row);
    onPick({
      ...(row.attorneyFee !== null ? { attorneyFee: row.attorneyFee } : {}),
      // A blank FF cell = no filing fee for this job; text ("TBD") leaves the field alone.
      ...(row.filingFee !== null ? { filingFee: row.filingFee } : row.filingFeeText ? {} : { filingFee: null }),
    }, row);
  };

  const remarks = picked
    ? [
        picked.attorneyFeeText && `AF on the sheet: ${picked.attorneyFeeText}`,
        picked.filingFeeText && `FF on the sheet: ${picked.filingFeeText}`,
        picked.note,
      ].filter(Boolean)
    : [];

  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-muted)" }}>
        From fee sheet
        {sheet && (
          <a href={sheet.webUrl} target="_blank" rel="noreferrer" className="ml-2 font-normal underline" style={{ color: "var(--color-ink-faint)" }}>
            open
          </a>
        )}
      </label>
      <input
        id={id}
        list={`${id}-jobs`}
        className="w-full rounded-md border px-3 py-1.5 text-sm"
        style={inputStyle}
        placeholder={error ? "Fee sheet unavailable" : sheet ? "Type to find a job (e.g. I-130)" : "Loading fee sheet…"}
        disabled={!!error}
        value={text}
        onFocus={load}
        onChange={(e) => {
          setText(e.target.value);
          if (sheet?.rows.some((r) => r.job === e.target.value)) choose(e.target.value);
          else setPicked(null);
        }}
      />
      <datalist id={`${id}-jobs`}>
        {sheet?.rows.map((r) => (
          <option key={r.job} value={r.job}>
            {[r.attorneyFee !== null ? `AF ${money(r.attorneyFee)}` : "", r.filingFee !== null ? `FF ${money(r.filingFee)}` : ""].filter(Boolean).join(" · ")}
          </option>
        ))}
      </datalist>
      {error && <p className="text-xs mt-1" style={{ color: "var(--urgency-overdue)" }}>{error}</p>}
      {picked && (
        <p className="text-xs mt-1" style={{ color: "var(--color-ink-muted)" }}>
          Filled: AF {picked.attorneyFee !== null ? money(picked.attorneyFee) : "—"} · FF{" "}
          {picked.filingFee !== null ? money(picked.filingFee) : picked.filingFeeText ? "—" : "none"}
          {remarks.length > 0 && <span className="block" style={{ color: "var(--color-ink)" }}>⚠ {remarks.join(" · ")}</span>}
        </p>
      )}
    </div>
  );
}
