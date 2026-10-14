// =============================================================================
// ContractFields — the Fee K capture fields, in one place
// =============================================================================
// Case type (the Fee Ks "Contract for..." dropdown, real options) + AF/FF/PF
// amounts + the contract note (its fixed For/Fees header previewed). Rendered
// by M11 (New contract), by M2's "this call requests a contract" section and,
// without the note, by P4's fee quote, so a field added here reaches all three. See contract-fields.ts. "+ New" (button or
// the list's second item) types a case type the dropdown doesn't have yet;
// Monday adds it when the Fee K is created.
// =============================================================================

import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Button } from "./ui/button";
import { useBoardColumns } from "../BoardColumnsProvider";
import { contractNoteHeader, type ContractFieldValues } from "./contract-fields";

export { emptyContractFields, toCreateContractInput } from "./contract-fields";
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

/** The real "Contract for…" options. Empty until the Fee Ks board is synced —
 *  hosts disable their submit on that. */
export function useContractCaseTypes(): string[] {
  const feeKs = useBoardColumns("fee_ks");
  const col = feeKs?.columns.find((c) => c.type === "dropdown" && c.title.trim().toLowerCase().startsWith("contract for"));
  return (col?.options ?? []).map((o) => o.label);
}

interface Props {
  value: ContractFieldValues;
  onChange: (next: ContractFieldValues) => void;
  /** The contract note (M11, M2). P4's fee quote has the consult note instead. */
  showNote?: boolean;
}

export function ContractFields({ value, onChange, showNote = true }: Props) {
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
        <span style={labelStyle}>Case type (Contract for…)</span>
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
                ? `"${value.caseType}" will be added to Monday's "Contract for…" list for every contract.`
                : typedMatch ? `Already on the list — this uses "${typedMatch}".` : "Type a case type that isn't on the list."}
            </span>
          </>
        ) : (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Select items={caseTypeItems} value={value.caseType}
              onValueChange={(v) => (v === NEW ? startAdding() : onChange({ ...value, caseType: v ?? "", newCaseType: false }))}>
              <SelectTrigger aria-label="Case type (Contract for…)" size="sm" className="flex-1 min-w-0 border-border-light bg-surface">
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
