// =============================================================================
// EditFeesModal (M25) — change a contract's AF / FF / PF on Monday
// =============================================================================
// From P14.3: the ⋯ menu's "Edit fees…", or a click on the fees. Only the fees
// that changed are written (PATCH /api/contracts/:id/fees, one Monday write);
// an empty box clears the fee. Refused (409) if Monday changed since the page
// loaded. Queued on an outage like every other write-back.
// =============================================================================

import { useState } from "react";
import { updateContractFees, type ContractFees, type PendingContract } from "../api";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";

interface Props {
  contract: PendingContract;
  /** After a successful (or queued) save; `pending` = queued. */
  onSaved: (pending: boolean) => void;
  onClose: () => void;
}

type FeeKey = keyof ContractFees;
const FEES: { key: FeeKey; label: string; hint: string }[] = [
  { key: "af", label: "Attorney fee (AF)", hint: "Operating" },
  { key: "ff", label: "Filing fee (FF)", hint: "Trust" },
  { key: "pf", label: "Processing fee (PF)", hint: "Operating" },
];

const inputStyle = { border: "1px solid var(--color-border-light)", background: "var(--color-surface)", color: "var(--color-ink)", fontFamily: "var(--font-body)" } as const;

/** "" = no fee; otherwise a number (commas and $ allowed). undefined = not a number. */
function parse(text: string): number | null | undefined {
  const s = text.replace(/[$,\s]/g, "");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export function EditFeesModal({ contract: c, onSaved, onClose }: Props) {
  const seen: ContractFees = { af: c.attorneyFee, ff: c.filingFee, pf: c.processingFee };
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

  const save = async () => {
    if (invalid.length > 0 || changed.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const fees: Partial<ContractFees> = {};
      const from: Partial<ContractFees> = {};
      for (const k of changed) {
        fees[k] = parsed[k] as number | null;
        from[k] = seen[k];
      }
      const res = await updateContractFees(c.localId, fees, from);
      onSaved(res.pending);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the fees");
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent code="M25" className="gap-0 p-0 sm:max-w-[420px]">
        <DialogHeader className="gap-0.5 border-b border-border px-5 py-4 pr-12">
          <DialogTitle style={{ fontFamily: "var(--font-display)" }}>Edit fees</DialogTitle>
          <DialogDescription>{c.clientName}{c.itemName !== c.clientName ? ` · ${c.itemName}` : ""}</DialogDescription>
        </DialogHeader>

        <form className="px-5 py-4 space-y-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          {FEES.map(({ key, label, hint }) => (
            <div key={key} className="flex items-center gap-2">
              <label htmlFor={`m25-${key}`} className="text-sm w-40 shrink-0" style={{ color: "var(--color-ink)" }}>{label}</label>
              <span className="text-sm" style={{ color: "var(--color-ink-muted)" }}>$</span>
              <input id={`m25-${key}`} inputMode="decimal" value={text[key]} placeholder="—" autoFocus={key === "af"}
                onChange={(e) => setText((t) => ({ ...t, [key]: e.target.value }))}
                aria-invalid={parsed[key] === undefined}
                className="w-28 rounded-md px-2 py-1 text-sm tabular-nums"
                style={{ ...inputStyle, ...(parsed[key] === undefined ? { borderColor: "var(--urgency-overdue)" } : {}) }} />
              <span className="text-xs" style={{ color: "var(--color-ink-faint)" }}>{hint}</span>
            </div>
          ))}
          <p className="text-xs" style={{ color: "var(--color-ink-faint)" }}>Saved to the contract on Monday. Leave a box empty to clear that fee.</p>
          {invalid.length > 0 && (
            <p className="text-sm" style={{ color: "var(--urgency-overdue)" }}>Enter an amount (numbers only) for {invalid.map((f) => f.label).join(", ")}.</p>
          )}
          {error && <p className="text-sm" style={{ color: "var(--urgency-overdue)" }}>{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving || invalid.length > 0 || changed.length === 0}>{saving ? "Saving…" : "Save"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
