// =============================================================================
// FeeKTypesSection (P11.3.6) — the case lookup table, one row per Fee K Type
// =============================================================================
// Every Fee K Type label on Monday (synced) gets a row: the Spanish name, the
// board the case goes to once paid (Monday's "It will go to…" labels) and the
// fee sheet job that prices it (its AF / FF shown from the sheet). Rows saved
// for a label Monday no longer has stay, marked, until someone clears them.
// Used by the Fee K auto-fill ("It will go to…") and the contract forms (AF /
// FF). Admin-only (the tab is); saved to data/fee-k-types.json, audited.
// Before the first save it shows the starting draft (fee-k-types-draft.ts):
// boards from past routing, Spanish names to review — used for nothing until saved.
// =============================================================================

import { useEffect, useMemo, useState } from "react";
import { fetchFeeKTypes, updateFeeKTypes, type FeeKTypeRow } from "../api";
import { feeSheetOnce, type FeeSheet } from "./FeeSheetPicker";
import { money } from "../lib/contract-fill";
import { Button } from "./ui/button";
import { SectionCode } from "./ScreenCode";
import { settingsSectionTitle } from "./settingsStyles";

const inputStyle = { backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border-light)", color: "var(--color-ink)", fontFamily: "var(--font-body)" } as const;
const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

interface Row extends FeeKTypeRow {
  /** The label is no longer on Monday's Fee K Type list. */
  gone: boolean;
}

/** Monday's labels in Monday's order, each with its saved row; then saved rows Monday dropped. */
function mergeRows(saved: FeeKTypeRow[], labels: string[]): Row[] {
  const byKey = new Map(saved.map((r) => [norm(r.feeKType), r]));
  const onMonday = labels.map((l) => ({ ...(byKey.get(norm(l)) ?? { spanish: "", board: "", feeSheetJob: "" }), feeKType: l, gone: false }));
  const known = new Set(labels.map(norm));
  return [...onMonday, ...saved.filter((r) => !known.has(norm(r.feeKType))).map((r) => ({ ...r, gone: true }))];
}

export function FeeKTypesSection() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [boards, setBoards] = useState<string[]>([]);
  const [draft, setDraft] = useState(false);
  const [sheet, setSheet] = useState<FeeSheet | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    fetchFeeKTypes()
      .then((t) => { setRows(mergeRows(t.rows, t.feeKTypes)); setBoards(t.boards); setDraft(t.draft); })
      .catch((e: Error) => setError(e.message));
    feeSheetOnce().then(setSheet).catch((e: unknown) => setSheetError(e instanceof Error ? e.message : "Could not read the fee sheet"));
  }, []);

  const jobs = useMemo(() => new Map((sheet?.rows ?? []).map((r) => [norm(r.job), r])), [sheet]);

  const set = (feeKType: string, p: Partial<FeeKTypeRow>) => {
    setRows((rs) => rs && rs.map((r) => (r.feeKType === feeKType ? { ...r, ...p } : r)));
    setSavedAt(null);
  };

  async function save() {
    if (!rows) return;
    setSaving(true);
    setError(null);
    try {
      const t = await updateFeeKTypes(rows.map(({ gone: _gone, ...r }) => r));
      setRows(mergeRows(t.rows, t.feeKTypes));
      setBoards(t.boards);
      setDraft(t.draft);
      setSavedAt(Date.now());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const shown = rows?.filter((r) => !filter.trim() || [r.feeKType, r.spanish, r.board, r.feeSheetJob].some((v) => norm(v).includes(norm(filter))));
  const unset = rows?.filter((r) => !r.gone && (!r.spanish || !r.board || !r.feeSheetJob)).length ?? 0;

  return (
    <section style={{ marginBottom: "40px" }}>
      <h2 style={settingsSectionTitle}>
        Fee K Types
        <SectionCode code="P11.3.6" inline />
      </h2>
      <p style={{ fontSize: 13, color: "var(--color-ink-faint)", fontFamily: "var(--font-body)", marginBottom: 8, lineHeight: 1.5 }}>
        One row per case type on Monday&apos;s Fee K Type list. <strong>Board once paid</strong> fills an empty
        &quot;It will go to…&quot; on new Fee Ks. <strong>Fee sheet job</strong> fills an empty AF / FF when staff pick the
        type in New contract, Log a call or Edit contract — prices stay in the fee sheet.
        {sheet && <> <a href={sheet.webUrl} target="_blank" rel="noreferrer" className="underline">Open the fee sheet</a>.</>}
      </p>
      {sheetError && (
        <p className="text-xs mb-2" style={{ color: "var(--color-status-red)" }}>Fee sheet unavailable ({sheetError}) — jobs can still be typed.</p>
      )}

      {draft && rows && rows.length > 0 && (
        <div className="px-4 py-2 rounded-lg mb-3 text-sm" style={{ backgroundColor: "var(--color-status-yellow-bg)", color: "var(--color-ink)" }}>
          <strong>Draft — not in use yet.</strong> Boards come from where past Fee Ks were sent; Spanish names are drafted
          for review. Check them, pick the fee sheet jobs, then <strong>Save</strong> to turn the table on.
        </div>
      )}

      {error && (
        <div className="px-4 py-2 rounded-lg mb-3 text-sm" style={{ backgroundColor: "var(--color-status-red-bg)", color: "var(--color-status-red)" }}>
          {error}
        </div>
      )}

      {!rows ? (
        <p className="text-sm" style={{ color: "var(--color-ink-faint)" }}>Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--color-status-red)" }}>Fee K Type options not synced yet — run a sync first.</p>
      ) : (
        <>
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            <input className="text-sm px-2 py-1 rounded" style={{ ...inputStyle, width: 240 }} placeholder="Filter…"
              aria-label="Filter Fee K Types" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <span className="text-xs" style={{ color: "var(--color-ink-faint)" }}>
              {rows.filter((r) => !r.gone).length} types · {unset} not fully set
            </span>
          </div>
          <datalist id="fee-k-type-jobs">
            {sheet?.rows.map((r) => <option key={r.job} value={r.job} />)}
          </datalist>
          <div style={{ overflowX: "auto", border: "1px solid var(--color-border-light)", borderRadius: 8 }}>
            <table className="text-sm" style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--color-ink-muted)", fontSize: 12 }}>
                  <th className="px-2 py-2" style={{ width: "28%" }}>Fee K Type</th>
                  <th className="px-2 py-2" style={{ width: "26%" }}>Spanish name</th>
                  <th className="px-2 py-2" style={{ width: "18%" }}>Board once paid</th>
                  <th className="px-2 py-2">Fee sheet job</th>
                </tr>
              </thead>
              <tbody>
                {shown!.map((r) => {
                  const job = r.feeSheetJob ? jobs.get(norm(r.feeSheetJob)) : undefined;
                  return (
                    <tr key={r.feeKType} style={{ borderTop: "1px solid var(--color-border-light)", verticalAlign: "top" }}>
                      <td className="px-2 py-1.5" style={{ color: r.gone ? "var(--color-ink-faint)" : "var(--color-ink)" }}>
                        <span style={{ whiteSpace: "pre-wrap" }}>{r.feeKType}</span>
                        {r.gone && (
                          <span className="block text-xs" style={{ color: "var(--color-status-red)" }}>
                            Not on Monday anymore —{" "}
                            <button type="button" className="underline" onClick={() => { setRows((rs) => rs && rs.filter((x) => x.feeKType !== r.feeKType)); setSavedAt(null); }}>remove</button>
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        <input className="w-full text-sm px-2 py-1 rounded" style={inputStyle} value={r.spanish} maxLength={120}
                          aria-label={`Spanish name for ${r.feeKType}`} onChange={(e) => set(r.feeKType, { spanish: e.target.value })} />
                      </td>
                      <td className="px-2 py-1.5">
                        <select className="w-full text-sm px-1 py-1 rounded" style={inputStyle} value={r.board}
                          aria-label={`Board once paid for ${r.feeKType}`} onChange={(e) => set(r.feeKType, { board: e.target.value })}>
                          <option value="">—</option>
                          {/* Keep a saved board Monday renamed visible, so it can be changed. */}
                          {r.board && !boards.includes(r.board) && <option value={r.board}>{r.board} (not on Monday)</option>}
                          {boards.map((b) => <option key={b} value={b}>{b}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-1.5">
                        <input className="w-full text-sm px-2 py-1 rounded" style={inputStyle} value={r.feeSheetJob} maxLength={120}
                          list="fee-k-type-jobs" placeholder={sheet ? "Pick a job" : ""}
                          aria-label={`Fee sheet job for ${r.feeKType}`} onChange={(e) => set(r.feeKType, { feeSheetJob: e.target.value })} />
                        {r.feeSheetJob && sheet && (
                          <span className="block text-xs mt-0.5" style={{ color: job ? "var(--color-ink-faint)" : "var(--color-status-red)" }}>
                            {job
                              ? `AF ${job.attorneyFee !== null ? money(job.attorneyFee) : job.attorneyFeeText || "—"} · FF ${job.filingFee !== null ? money(job.filingFee) : job.filingFeeText || "none"}`
                              : "Not a job on the fee sheet"}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-3 mt-3">
            <Button type="button" size="sm" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
            {savedAt && <span className="text-xs" style={{ color: "var(--color-ink-faint)" }}>Saved</span>}
          </div>
        </>
      )}
    </section>
  );
}
