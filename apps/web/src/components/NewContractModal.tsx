// =============================================================================
// NewContractModal — create a Fee K (contract) for a client
// =============================================================================
// Case type (the Fee Ks "Contract for..." dropdown, real options) + AF/FF/PF
// amounts. Creates the item on Monday via createContract, named "<client> —
// <case type>", auto-linked to the profile. Surcharges are NOT here (post-signing).
// The new Fee K gets a note — a For/Fees header (previewed here) plus the
// optional description — as an update and as a "Contract note" in its own
// Emails & Activities. Header format lives in the API's contractNoteText.
// =============================================================================

import { useState } from "react";
import { createContract } from "../api";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Button } from "./ui/button";
import { useBoardColumns } from "../BoardColumnsProvider";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
/** A fee field as the note will print it — blank reads $0.00, same as the API. */
const money = (v: string) => usd.format(v === "" || !Number.isFinite(Number(v)) ? 0 : Number(v));

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
  const [description, setDescription] = useState("");
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
        description: description.trim() || undefined,
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
      <DialogContent code="M11" className="gap-0 p-0 sm:max-w-[460px]">
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
                <div style={{ display: "block", marginBottom: 12 }}>
                  <span style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--color-ink-muted)", marginBottom: 4, fontFamily: "var(--font-body)" }}>Case type (Contract for…)</span>
                  {options.length === 0 ? (
                    <span style={{ fontSize: 12, color: "var(--color-status-red)" }}>Fee Ks options not synced yet — run a sync first.</span>
                  ) : (
                    <Select items={caseTypeItems} value={caseType} onValueChange={(v) => setCaseType(v ?? "")}>
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
                  <div style={{ flex: 1 }}>{numInput("Attorney's fees (AF)", af, setAf)}</div>
                  <div style={{ flex: 1 }}>{numInput("Filing fees (FF)", ff, setFf)}</div>
                  <div style={{ flex: 1 }}>{numInput("Postage (PF)", pf, setPf)}</div>
                </div>

                <label style={{ display: "block", marginBottom: 12 }}>
                  <span style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--color-ink-muted)", marginBottom: 4, fontFamily: "var(--font-body)" }}>Contract note</span>
                  {/* The fixed header the note starts with — filled from the fields above. */}
                  <div aria-label="Note header" style={{ fontSize: 12, lineHeight: 1.5, color: "var(--color-ink-muted)", fontFamily: "var(--font-mono, monospace)", background: "var(--color-surface-alt, var(--color-surface))", border: "1px dashed var(--color-border-light)", borderRadius: 6, padding: "6px 8px", marginBottom: 6, whiteSpace: "pre-wrap" }}>
                    {`For: ${caseType || "___"}\nFees: ${money(af)} AF ${money(ff)} FF`}
                  </div>
                  <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} maxLength={5000}
                    placeholder="Scope, payment plan, anything the team should know…"
                    className="w-full rounded-md px-2 py-1.5 text-sm"
                    style={{ border: "1px solid var(--color-border-light)", background: "var(--color-surface)", color: "var(--color-ink)", fontFamily: "var(--font-body)", resize: "vertical" }} />
                  <span style={{ display: "block", fontSize: 11, color: "var(--color-ink-faint)", marginTop: 2, fontFamily: "var(--font-body)" }}>
                    Posted on the new Fee K as an update and as a Contract note in its Emails &amp; Activities.
                  </span>
                </label>

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
