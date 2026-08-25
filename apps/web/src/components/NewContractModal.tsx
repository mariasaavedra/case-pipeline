// =============================================================================
// NewContractModal — create a Fee K (contract) for a client
// =============================================================================
// Case type (the Fee Ks "Contract for..." dropdown, real options) + AF/FF/PF
// amounts. Creates the item on Monday via createContract, named "<client> —
// <case type>", auto-linked to the profile. Surcharges are NOT here (post-signing).
// =============================================================================

import { useState } from "react";
import { createContract } from "../api";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Button } from "./ui/button";
import { useBoardColumns } from "../BoardColumnsProvider";

interface Props {
  profileLocalId: string;
  clientName: string;
  onClose: () => void;
}

export function NewContractModal({ profileLocalId, clientName, onClose }: Props) {
  const feeKs = useBoardColumns("fee_ks");
  const caseTypeCol = feeKs?.columns.find((c) => c.type === "dropdown" && c.title.trim().toLowerCase().startsWith("contract for"));
  const options = caseTypeCol?.options ?? [];
  // See KpiDetailModal: `items` is what lets the closed trigger show a label.
  const caseTypeItems = [
    { value: "", label: "Select…" },
    ...options.map((o) => ({ value: o.label, label: o.label })),
  ];

  const [caseType, setCaseType] = useState("");
  const [af, setAf] = useState("");
  const [ff, setFf] = useState("");
  const [pf, setPf] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ name: string; pending: boolean } | null>(null);

  const submit = async () => {
    if (!caseType) { setError("Pick a case type."); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await createContract(profileLocalId, {
        caseType,
        af: af === "" ? null : Number(af),
        ff: ff === "" ? null : Number(ff),
        pf: pf === "" ? null : Number(pf),
      });
      setDone({ name: res.name, pending: res.pending });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create contract");
    } finally {
      setSaving(false);
    }
  };

  const numInput = (label: string, value: string, set: (v: string) => void) => (
    <label style={{ display: "block", marginBottom: 12 }}>
      <span style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--color-ink-muted)", marginBottom: 4, fontFamily: "var(--font-body)" }}>{label}</span>
      <input type="number" min="0" step="0.01" value={value} onChange={(e) => set(e.target.value)} placeholder="0.00"
        className="w-full rounded-md px-2 py-1.5 text-sm"
        style={{ border: "1px solid var(--color-border-light)", background: "var(--color-surface)", color: "var(--color-ink)", fontFamily: "var(--font-body)" }} />
    </label>
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="gap-0 p-0 sm:max-w-[460px]">
        <DialogHeader className="gap-0.5 border-b border-border px-5 py-4 pr-12">
          <DialogTitle style={{ fontFamily: "var(--font-display)" }}>New contract (Fee K)</DialogTitle>
          <DialogDescription>{clientName}</DialogDescription>
        </DialogHeader>

        <div className="px-5 py-4">
            {done ? (
              <div style={{ fontFamily: "var(--font-body)", fontSize: 14, color: "var(--color-ink)" }}>
                <p style={{ marginBottom: 8 }}>✓ Contract <strong>{done.name}</strong> {done.pending ? "queued (will sync to Monday shortly)" : "created in Monday"}.</p>
                <p style={{ fontSize: 12, color: "var(--color-ink-faint)" }}>It will appear in the Contracts list after the next sync.</p>
                <button type="button" onClick={onClose} className="mt-3 rounded-md px-3 py-1.5 text-sm" style={{ background: "var(--color-amber-light)", color: "var(--color-amber)", border: "none", cursor: "pointer" }}>Done</button>
              </div>
            ) : (
              <>
                <label style={{ display: "block", marginBottom: 12 }}>
                  <span style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--color-ink-muted)", marginBottom: 4, fontFamily: "var(--font-body)" }}>Case type (Contract for…)</span>
                  {options.length === 0 ? (
                    <span style={{ fontSize: 12, color: "var(--color-status-red)" }}>Fee Ks options not synced yet — run a sync first.</span>
                  ) : (
                    <Select items={caseTypeItems} value={caseType} onValueChange={(v) => setCaseType(v ?? "")}>
                      <SelectTrigger size="sm" className="w-full border-border-light bg-surface">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="w-[var(--anchor-width)]">
                        <SelectItem value="">Select…</SelectItem>
                        {caseTypeItems.slice(1).map((i) => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                </label>

                <div style={{ display: "flex", gap: 10 }}>
                  <div style={{ flex: 1 }}>{numInput("Attorney's fees (AF)", af, setAf)}</div>
                  <div style={{ flex: 1 }}>{numInput("Filing fees (FF)", ff, setFf)}</div>
                  <div style={{ flex: 1 }}>{numInput("Postage (PF)", pf, setPf)}</div>
                </div>

                {error && <p role="alert" style={{ fontSize: 12, color: "var(--color-status-red)", marginBottom: 8 }}>{error}</p>}

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
                  <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
                  <Button type="button" onClick={submit} disabled={saving || options.length === 0}>
                    {saving ? "Creating…" : "Create contract"}
                  </Button>
                </div>
              </>
            )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
