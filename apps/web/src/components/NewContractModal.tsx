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
                    <select value={caseType} onChange={(e) => setCaseType(e.target.value)}
                      className="w-full rounded-md px-2 py-1.5 text-sm"
                      style={{ border: "1px solid var(--color-border-light)", background: "var(--color-surface)", color: "var(--color-ink)", fontFamily: "var(--font-body)" }}>
                      <option value="">Select…</option>
                      {options.map((o) => <option key={o.index} value={o.label}>{o.label}</option>)}
                    </select>
                  )}
                </label>

                <div style={{ display: "flex", gap: 10 }}>
                  <div style={{ flex: 1 }}>{numInput("Attorney's fees (AF)", af, setAf)}</div>
                  <div style={{ flex: 1 }}>{numInput("Filing fees (FF)", ff, setFf)}</div>
                  <div style={{ flex: 1 }}>{numInput("Postage (PF)", pf, setPf)}</div>
                </div>

                {error && <p role="alert" style={{ fontSize: 12, color: "var(--color-status-red)", marginBottom: 8 }}>{error}</p>}

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
                  <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm" style={{ background: "transparent", color: "var(--color-ink-muted)", border: "1px solid var(--color-border-light)", cursor: "pointer" }}>Cancel</button>
                  <button type="button" onClick={submit} disabled={saving || options.length === 0} className="rounded-md px-3 py-1.5 text-sm" style={{ background: "var(--color-amber)", color: "#fff", border: "none", cursor: saving ? "wait" : "pointer", opacity: saving || options.length === 0 ? 0.6 : 1 }}>
                    {saving ? "Creating…" : "Create contract"}
                  </button>
                </div>
              </>
            )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
