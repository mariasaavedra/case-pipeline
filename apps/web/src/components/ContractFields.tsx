// =============================================================================
// ContractFields — the Fee K capture fields, in one place
// =============================================================================
// Case type (the Fee Ks "Contract for..." dropdown, real options) + AF/FF/PF
// amounts + the contract note (its fixed For/Fees header previewed). Rendered
// by M11 (New contract) and by M2's "this call requests a contract" section, so
// a field added here reaches both. See contract-fields.ts.
// =============================================================================

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
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
}

export function ContractFields({ value, onChange }: Props) {
  const options = useContractCaseTypes();
  // See KpiDetailModal: `items` is what lets the closed trigger show a label.
  const caseTypeItems = [{ value: "", label: "Select…" }, ...options.map((o) => ({ value: o, label: o }))];
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
        ) : (
          <Select items={caseTypeItems} value={value.caseType} onValueChange={(v) => set("caseType")(v ?? "")}>
            <SelectTrigger aria-label="Case type (Contract for…)" size="sm" className="w-full border-border-light bg-surface">
              <SelectValue />
            </SelectTrigger>
            <SelectContent code="D15" className="w-[var(--anchor-width)]">
              <SelectItem value="">Select…</SelectItem>
              {caseTypeItems.slice(1).map((i) => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ flex: 1 }}>{numInput("af", "Attorney's fees (AF)")}</div>
        <div style={{ flex: 1 }}>{numInput("ff", "Filing fees (FF)")}</div>
        <div style={{ flex: 1 }}>{numInput("pf", "Postage (PF)")}</div>
      </div>

      <label style={{ display: "block", marginBottom: 12 }}>
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
      </label>
    </>
  );
}
