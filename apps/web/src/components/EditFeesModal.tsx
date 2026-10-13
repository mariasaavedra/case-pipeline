// =============================================================================
// EditFeesModal (M25) — change a contract's case type and AF / FF / PF on Monday
// =============================================================================
// From P14.3: the ⋯ menu's "Edit fees…" / "Change case type…", or a click on
// the fees / the case type. Only what changed is written (PATCH
// /api/contracts/:id/fees, one Monday write); an empty box clears the fee. The
// case type is the Fee Ks "Contract for…" dropdown, one label like M11 New
// contract — picking one replaces every label it had. "+ New case type…" types
// one the dropdown doesn't have; Monday adds it as a new label on save. Refused (409) if Monday changed since the page
// loaded. Queued on an outage like every other write-back.
// =============================================================================

import { useState } from "react";
import { updateContractFees, type ContractFees, type PendingContract } from "../api";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { useContractCaseTypes } from "./ContractFields";
import { useBoardColumnsMeta } from "../BoardColumnsProvider";

interface Props {
  contract: PendingContract;
  /** After a successful (or queued) save; `pending` = queued. */
  onSaved: (pending: boolean) => void;
  onClose: () => void;
  /** What the user clicked to get here — that field gets the focus. */
  focus?: "fees" | "caseType";
}

type FeeKey = keyof ContractFees;
const FEES: { key: FeeKey; label: string; hint: string }[] = [
  { key: "af", label: "Attorney fee (AF)", hint: "Operating" },
  { key: "ff", label: "Filing fee (FF)", hint: "Trust" },
  { key: "pf", label: "Postage fee (PF)", hint: "Operating" },
];

const inputStyle = { border: "1px solid var(--color-border-light)", background: "var(--color-surface)", color: "var(--color-ink)", fontFamily: "var(--font-body)" } as const;

/** "" = no fee; otherwise a number (commas and $ allowed). undefined = not a number. */
function parse(text: string): number | null | undefined {
  const s = text.replace(/[$,\s]/g, "");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export function EditFeesModal({ contract: c, onSaved, onClose, focus = "fees" }: Props) {
  const seen: ContractFees = { af: c.attorneyFee, ff: c.filingFee, pf: c.processingFee };
  const caseTypes = useContractCaseTypes();
  // One label shows as picked; none or several show "Select…" (a pick replaces them).
  const seenType = c.contractFor.length === 1 ? c.contractFor[0] : "";
  const [caseType, setCaseType] = useState(seenType);
  const { refresh: refreshColumns } = useBoardColumnsMeta();
  // "+ New case type…" swaps the dropdown for a text box.
  const NEW = "__new__";
  const [adding, setAdding] = useState(false);
  const [newType, setNewType] = useState("");
  const [text, setText] = useState<Record<FeeKey, string>>({
    af: seen.af === null ? "" : String(seen.af),
    ff: seen.ff === null ? "" : String(seen.ff),
    pf: seen.pf === null ? "" : String(seen.pf),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = Object.fromEntries(FEES.map(({ key }) => [key, parse(text[key])])) as Record<FeeKey, number | null | undefined>;
  const invalid = FEES.filter(({ key }) => parsed[key] === undefined);
  const changed = FEES.filter(({ key }) => parsed[key] !== undefined && parsed[key] !== seen[key]).map(({ key }) => key);
  const typed = newType.trim().replace(/\s+/g, " ");
  // Typed a label that already exists (any case)? Then it is that one, not a new one.
  const typedMatch = caseTypes.find((t) => t.toLowerCase() === typed.toLowerCase());
  const pickedType = adding ? (typedMatch ?? typed) : caseType;
  const isNewType = adding && typed !== "" && !typedMatch;
  const typeChanged = pickedType !== "" && pickedType !== seenType;
  const nothing = changed.length === 0 && !typeChanged;

  const save = async () => {
    if (invalid.length > 0 || nothing) return;
    setSaving(true);
    setError(null);
    try {
      const fees: Partial<ContractFees> = {};
      const from: Partial<ContractFees> & { caseType?: string[] } = {};
      for (const k of changed) {
        fees[k] = parsed[k] as number | null;
        from[k] = seen[k];
      }
      if (typeChanged) from.caseType = c.contractFor;
      const res = await updateContractFees(
        c.localId,
        { fees, ...(typeChanged ? { caseType: pickedType, ...(isNewType ? { newCaseType: true } : {}) } : {}) },
        from,
      );
      if (isNewType) refreshColumns();
      onSaved(res.pending);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent code="M25" className="gap-0 p-0 sm:max-w-[420px]">
        <DialogHeader className="gap-0.5 border-b border-border px-5 py-4 pr-12">
          <DialogTitle style={{ fontFamily: "var(--font-display)" }}>Edit contract</DialogTitle>
          <DialogDescription>{c.clientName}{c.itemName !== c.clientName ? ` · ${c.itemName}` : ""}</DialogDescription>
        </DialogHeader>

        <form className="px-5 py-4 space-y-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <div className="flex items-center gap-2">
            <span className="text-sm w-40 shrink-0" style={{ color: "var(--color-ink)" }}>Case type</span>
            {caseTypes.length === 0 ? (
              <span className="text-xs" style={{ color: "var(--color-status-red)" }}>Fee Ks options not synced yet — run a sync first.</span>
            ) : adding ? (
              <>
                <input aria-label="New case type" value={newType} maxLength={60} autoFocus placeholder="e.g. T Visa"
                  onChange={(e) => setNewType(e.target.value)}
                  className="flex-1 min-w-0 rounded-md px-2 py-1 text-sm" style={inputStyle} />
                <button type="button" className="text-xs shrink-0" style={{ color: "var(--color-ink-muted)", background: "none", border: "none", cursor: "pointer" }}
                  onClick={() => { setAdding(false); setNewType(""); }}>Cancel</button>
              </>
            ) : (
              <Select items={[{ value: "", label: "Select…" }, ...caseTypes.map((t) => ({ value: t, label: t })), { value: NEW, label: "+ New case type…" }]}
                value={caseType} onValueChange={(v) => { if (v === NEW) setAdding(true); else setCaseType(v ?? ""); }}>
                <SelectTrigger aria-label="Case type (Contract for…)" size="sm" autoFocus={focus === "caseType"}
                  className="flex-1 min-w-0 border-border-light bg-surface">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent code="D15" className="w-[var(--anchor-width)]">
                  <SelectItem value="">Select…</SelectItem>
                  {caseTypes.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  <SelectItem value={NEW}>+ New case type…</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>
          {isNewType && (
            <p className="text-xs" style={{ color: "var(--color-ink-faint)" }}>"{typed}" will be added to Monday's "Contract for…" list for every contract.</p>
          )}
          {adding && typedMatch && typedMatch !== seenType && (
            <p className="text-xs" style={{ color: "var(--color-ink-faint)" }}>Already on the list — this uses "{typedMatch}".</p>
          )}
          {c.contractFor.length > 1 && (
            <p className="text-xs" style={{ color: "var(--color-ink-faint)" }}>Now: {c.contractFor.join(", ")}. Picking one replaces them.</p>
          )}
          {FEES.map(({ key, label, hint }) => (
            <div key={key} className="flex items-center gap-2">
              <label htmlFor={`m25-${key}`} className="text-sm w-40 shrink-0" style={{ color: "var(--color-ink)" }}>{label}</label>
              <span className="text-sm" style={{ color: "var(--color-ink-muted)" }}>$</span>
              <input id={`m25-${key}`} inputMode="decimal" value={text[key]} placeholder="—" autoFocus={focus === "fees" && key === "af"}
                onChange={(e) => setText((t) => ({ ...t, [key]: e.target.value }))}
                aria-invalid={parsed[key] === undefined}
                className="w-28 rounded-md px-2 py-1 text-sm tabular-nums"
                style={{ ...inputStyle, ...(parsed[key] === undefined ? { borderColor: "var(--urgency-overdue)" } : {}) }} />
              <span className="text-xs" style={{ color: "var(--color-ink-faint)" }}>{hint}</span>
            </div>
          ))}
          <p className="text-xs" style={{ color: "var(--color-ink-faint)" }}>Saved to the contract on Monday. Leave a fee empty to clear it.</p>
          {invalid.length > 0 && (
            <p className="text-sm" style={{ color: "var(--urgency-overdue)" }}>Enter an amount (numbers only) for {invalid.map((f) => f.label).join(", ")}.</p>
          )}
          {error && <p className="text-sm" style={{ color: "var(--urgency-overdue)" }}>{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving || invalid.length > 0 || nothing}>{saving ? "Saving…" : "Save"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
