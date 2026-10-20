// =============================================================================
// ContractFields — the Fee K capture fields, in one place
// =============================================================================
// Case type (the Fee Ks "Fee K Type" dropdown, real options) + AF/FF/PF
// amounts + the contract note (its fixed For/Fees header previewed). Rendered
// by M11 (New contract), by M2's "this call requests a contract" section and,
// without the note, by P4's fee quote, so a field added here reaches all three. See contract-fields.ts. "+ New" (button or
// the list's second item) types a case type the dropdown doesn't have yet;
// Monday adds it when the Fee K is created.
//
// Below the fees (M11, M2, M25 — not P4's quote): the attorney, picked from
// Settings → Documents + anyone already on a Fee K, and the client's e-mail
// and address. Given a profile, all three are pre-filled from it (empty
// fields only) and stay editable; e-mail / address are saved to the profile.
//
// Picking a Fee K Type fills an EMPTY AF / FF from the fee sheet job the Fee K
// Types table names for it (Settings → Firm, P11.3.6) — never over a typed amount.
// =============================================================================

import { useEffect, useRef, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Button } from "./ui/button";
import { useBoardColumns } from "../BoardColumnsProvider";
import { contractNoteHeader, type ContractFieldValues } from "./contract-fields";
import { fetchContractInfo, fetchFeeKTypes, type FeeKTypeRow } from "../api";
import { feeSheetOnce } from "./FeeSheetPicker";
import { money } from "../lib/contract-fill";

export { emptyContractFields, toCreateContractInput, contractFieldProblems } from "./contract-fields";
export type { ContractFieldValues } from "./contract-fields";

const labelStyle = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  color: "var(--color-ink-muted)",
  marginBottom: 4,
  fontFamily: "var(--font-body)",
} as const;

const fieldStyle = {
  border: "1px solid var(--color-border-light)",
  background: "var(--color-surface)",
  color: "var(--color-ink)",
  fontFamily: "var(--font-body)",
} as const;

/** The real "Fee K Type" options (Monday requires one on every new Fee K; the
 *  older "Contract for…" list is no longer written). Empty until the Fee Ks board is synced —
 *  hosts disable their submit on that. */
export function useContractCaseTypes(): string[] {
  const feeKs = useBoardColumns("fee_ks");
  // By id (libs/query fee-k-case-type.ts: it began as "Dup. of Contract for..."), else by title.
  const col = feeKs?.columns.find((c) => c.columnId === "dropdown_mm89vqtc")
    ?? feeKs?.columns.find((c) => c.type === "dropdown" && c.title.trim().toLowerCase() === "fee k type");
  return (col?.options ?? []).map((o) => o.label);
}

// The Fee K Types table, once per page load (an admin edit shows on the next load). The
// unsaved draft is not used.
let feeKTypesCache: Promise<FeeKTypeRow[]> | null = null;
function feeKTypeRowsOnce(): Promise<FeeKTypeRow[]> {
  feeKTypesCache ??= fetchFeeKTypes().then((t) => (t.draft ? [] : t.rows)).catch(() => { feeKTypesCache = null; return []; });
  return feeKTypesCache;
}
const sameType = (a: string, b: string) => a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase();

export interface ContractInfo {
  attorneys: string[];
  email: string;
  address: string;
  attorney: string;
}

/** The pre-fill for one client (null while loading). Refetches when the client changes. */
export function useContractInfo(profileLocalId: string | null | undefined): ContractInfo | null {
  const [info, setInfo] = useState<{ for: string; data: ContractInfo } | null>(null);
  const key = profileLocalId ?? "";
  useEffect(() => {
    let cancelled = false;
    fetchContractInfo(profileLocalId)
      .then((data) => { if (!cancelled) setInfo({ for: key, data }); })
      .catch(() => { if (!cancelled) setInfo({ for: key, data: { attorneys: [], email: "", address: "", attorney: "" } }); });
    return () => { cancelled = true; };
  }, [key, profileLocalId]);
  return info && info.for === key ? info.data : null;
}

interface Props {
  value: ContractFieldValues;
  onChange: (next: ContractFieldValues) => void;
  /** The contract note (M11, M2). P4's fee quote has the consult note instead. */
  showNote?: boolean;
  /** Attorney + client e-mail / address (M11, M2, M25). Off for P4's fee quote. */
  showClient?: boolean;
  /** The client: pre-fills attorney / e-mail / address (empty fields only). */
  profileLocalId?: string | null;
  /** M25 sets its own starting values, so it turns the pre-fill off. */
  prefill?: boolean;
}

export function ContractFields({ value, onChange, showNote = true, showClient = true, profileLocalId, prefill = true }: Props) {
  const info = useContractInfo(showClient ? profileLocalId : undefined);
  // Pre-fill once per client, into empty fields only — never over what was typed.
  const latest = useRef(value);
  latest.current = value;
  const filledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!showClient || !prefill || !info || !profileLocalId || filledFor.current === profileLocalId) return;
    filledFor.current = profileLocalId;
    const v = latest.current;
    const next = {
      ...v,
      attorney: v.attorney || info.attorney,
      email: v.email || info.email,
      address: v.address || info.address,
    };
    if (next.attorney !== v.attorney || next.email !== v.email || next.address !== v.address) onChange(next);
  }, [info, profileLocalId, prefill, showClient, onChange]);
  const options = useContractCaseTypes();
  const NEW = "__new__";
  // "+ New" swaps the dropdown for a text box; `typed` is what's in it.
  const [adding, setAdding] = useState(!!value.newCaseType);
  const [typed, setTyped] = useState(value.newCaseType ? value.caseType : "");
  // See KpiDetailModal: `items` is what lets the closed trigger show a label.
  const caseTypeItems = [{ value: "", label: "Select…" }, { value: NEW, label: "+ New case type…" }, ...options.map((o) => ({ value: o, label: o }))];
  /** Typed text → caseType: an existing label (any case) is that label, else new. */
  const typeNew = (text: string) => {
    setTyped(text);
    const t = text.trim().replace(/\s+/g, " ");
    const match = options.find((o) => o.toLowerCase() === t.toLowerCase());
    onChange({ ...value, caseType: match ?? t, newCaseType: !match && t !== "" });
  };
  const startAdding = () => { setAdding(true); typeNew(""); };
  const stopAdding = () => { setAdding(false); setTyped(""); onChange({ ...value, caseType: "", newCaseType: false }); };
  const typedMatch = adding && typed.trim() !== "" && !value.newCaseType ? value.caseType : null;
  const set = (k: keyof ContractFieldValues) => (v: string) => onChange({ ...value, [k]: v });

  // A picked Fee K Type → its fee sheet job → AF / FF, into empty fields only.
  const [feeHint, setFeeHint] = useState<string | null>(null);
  const pickType = (caseType: string) => {
    onChange({ ...value, caseType, newCaseType: false });
    setFeeHint(null);
    if (!caseType) return;
    void feeKTypeRowsOnce().then(async (rows) => {
      const job = rows.find((r) => sameType(r.feeKType, caseType))?.feeSheetJob;
      if (!job) return;
      let sheetRow;
      try {
        sheetRow = (await feeSheetOnce()).rows.find((r) => sameType(r.job, job));
      } catch {
        setFeeHint(`Fee sheet unavailable — "${job}" not read.`);
        return;
      }
      const v = latest.current;
      if (!sheetRow || v.caseType !== caseType) return;
      const af = v.af.trim() === "" && sheetRow.attorneyFee !== null ? String(sheetRow.attorneyFee) : v.af;
      const ff = v.ff.trim() === "" && sheetRow.filingFee !== null ? String(sheetRow.filingFee) : v.ff;
      setFeeHint(`Fee sheet "${sheetRow.job}": AF ${sheetRow.attorneyFee !== null ? money(sheetRow.attorneyFee) : sheetRow.attorneyFeeText || "—"} · FF ${sheetRow.filingFee !== null ? money(sheetRow.filingFee) : sheetRow.filingFeeText || "none"}${af !== v.af || ff !== v.ff ? " (filled)" : " (kept what was typed)"}${sheetRow.note ? ` · ${sheetRow.note}` : ""}`);
      if (af !== v.af || ff !== v.ff) onChange({ ...v, af, ff });
    });
  };

  const numInput = (k: "af" | "ff" | "pf", label: string) => (
    <label style={{ display: "block", marginBottom: 12 }}>
      <span style={labelStyle}>{label}</span>
      <input type="number" min="0" step="0.01" value={value[k]} onChange={(e) => set(k)(e.target.value)} placeholder="0.00"
        className="w-full rounded-md px-2 py-1.5 text-sm" style={fieldStyle} />
    </label>
  );

  return (
    <>
      <div style={{ display: "block", marginBottom: 12 }}>
        <span style={labelStyle}>Case type (Fee K Type)</span>
        {options.length === 0 ? (
          <span style={{ fontSize: 12, color: "var(--color-status-red)" }}>Fee Ks options not synced yet — run a sync first.</span>
        ) : adding ? (
          <>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input aria-label="New case type" value={typed} maxLength={60} autoFocus placeholder="e.g. T Visa"
                onChange={(e) => typeNew(e.target.value)}
                className="flex-1 min-w-0 rounded-md px-2 py-1.5 text-sm" style={fieldStyle} />
              <Button type="button" size="xs" variant="ghost" onClick={stopAdding}>Cancel</Button>
            </div>
            <span style={{ display: "block", fontSize: 11, color: "var(--color-ink-faint)", marginTop: 2, fontFamily: "var(--font-body)" }}>
              {value.newCaseType
                ? `"${value.caseType}" will be added to Monday's "Fee K Type" list for every contract.`
                : typedMatch ? `Already on the list — this uses "${typedMatch}".` : "Type a case type that isn't on the list."}
            </span>
          </>
        ) : (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Select items={caseTypeItems} value={value.caseType}
              onValueChange={(v) => (v === NEW ? startAdding() : pickType(v ?? ""))}>
              <SelectTrigger aria-label="Case type (Fee K Type)" size="sm" className="flex-1 min-w-0 border-border-light bg-surface">
                <SelectValue />
              </SelectTrigger>
              <SelectContent code="D15" className="w-[var(--anchor-width)]">
                <SelectItem value="">Select…</SelectItem>
                {/* Second, not last: the list is long (129 labels on 2026-10-13). */}
                {caseTypeItems.slice(1).map((i) => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button type="button" size="xs" variant="outline" className="shrink-0" onClick={startAdding}>+ New</Button>
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ flex: 1 }}>{numInput("af", "Attorney's fees (AF)")}</div>
        <div style={{ flex: 1 }}>{numInput("ff", "Filing fees (FF)")}</div>
        <div style={{ flex: 1 }}>{numInput("pf", "Postage (PF)")}</div>
      </div>
      {feeHint && (
        <span style={{ display: "block", fontSize: 11, color: "var(--color-ink-faint)", marginTop: -6, marginBottom: 12, fontFamily: "var(--font-body)" }}>
          {feeHint}
        </span>
      )}

      {showClient && (
        <fieldset style={{ border: "none", padding: 0, margin: "0 0 4px" }}>
          <legend style={{ ...labelStyle, fontSize: 13, color: "var(--color-ink)", marginBottom: 8 }}>Contract details</legend>
          <div style={{ display: "block", marginBottom: 12 }}>
            <span style={labelStyle}>Attorney</span>
            {(() => {
              const names = info?.attorneys ?? [];
              // Keep a name that isn't on the list (e.g. from the profile) pickable.
              const list = value.attorney && !names.some((n) => n.toLowerCase() === value.attorney.toLowerCase()) ? [value.attorney, ...names] : names;
              const items = [{ value: "", label: info ? "Select…" : "Loading…" }, ...list.map((n) => ({ value: n, label: n }))];
              return (
                <Select items={items} value={value.attorney} onValueChange={(v) => onChange({ ...value, attorney: v ?? "" })}>
                  <SelectTrigger aria-label="Attorney" size="sm" className="w-full border-border-light bg-surface">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="w-[var(--anchor-width)]">
                    {items.map((i) => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              );
            })()}
          </div>
          <label style={{ display: "block", marginBottom: 12 }}>
            <span style={labelStyle}>Client e-mail</span>
            <input type="email" value={value.email} onChange={(e) => set("email")(e.target.value)} placeholder="name@example.com"
              className="w-full rounded-md px-2 py-1.5 text-sm" style={fieldStyle} />
          </label>
          <label style={{ display: "block", marginBottom: 12 }}>
            <span style={labelStyle}>Client address</span>
            <input value={value.address} onChange={(e) => set("address")(e.target.value)} maxLength={300}
              placeholder="123 Main St, Kansas City, MO 64105"
              className="w-full rounded-md px-2 py-1.5 text-sm" style={fieldStyle} />
            <span style={{ display: "block", fontSize: 11, color: "var(--color-ink-faint)", marginTop: 2, fontFamily: "var(--font-body)" }}>
              E-mail and address are saved on the client&apos;s profile in Monday — the contract shows them from there.
            </span>
          </label>
        </fieldset>
      )}

      {showNote && <label style={{ display: "block", marginBottom: 12 }}>
        <span style={labelStyle}>Contract note</span>
        {/* The fixed header the note starts with — filled from the fields above. */}
        <div aria-label="Note header" style={{ fontSize: 12, lineHeight: 1.5, color: "var(--color-ink-muted)", fontFamily: "var(--font-mono, monospace)", background: "var(--color-surface-alt, var(--color-surface))", border: "1px dashed var(--color-border-light)", borderRadius: 6, padding: "6px 8px", marginBottom: 6, whiteSpace: "pre-wrap" }}>
          {contractNoteHeader(value)}
        </div>
        <textarea value={value.description} onChange={(e) => set("description")(e.target.value)} rows={4} maxLength={5000}
          placeholder="Scope, payment plan, anything the team should know…"
          className="w-full rounded-md px-2 py-1.5 text-sm"
          style={{ ...fieldStyle, resize: "vertical" }} />
        <span style={{ display: "block", fontSize: 11, color: "var(--color-ink-faint)", marginTop: 2, fontFamily: "var(--font-body)" }}>
          Posted on the new Fee K as an update and as a Contract note in its Emails &amp; Activities.
        </span>
      </label>}
    </>
  );
}
