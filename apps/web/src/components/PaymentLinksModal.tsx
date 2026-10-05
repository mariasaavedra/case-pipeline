// =============================================================================
// PaymentLinksModal (M21) — LawPay payment links for a signed contract
// =============================================================================
// One link per fee on the contract: AF and PF go to Operating, FF to Trust
// (rules in lib/lawpay.ts, same as the firm's own link script). The
// description starts as "<client> <case type>" and is editable; amounts start
// from Monday's AF / PF / FF and are editable too. Nothing is sent from here —
// staff copy the links into their message, then "Mark sent" records Payment
// Link Sent On and moves the stage to Payment link sent.
// =============================================================================

import { useState } from "react";
import type { PendingContract } from "../api";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { lawPayLink, FEE_TYPE_LABELS, type FeeType } from "../lib/lawpay";

interface Props {
  contract: PendingContract;
  /** Present when the contract is waiting for its payment link. */
  onMarkSent?: () => Promise<void>;
  onClose: () => void;
}

const FEES: FeeType[] = ["AF", "PF", "FF"];

const labelStyle = { display: "block", fontSize: 12, fontWeight: 600, color: "var(--color-ink-muted)", marginBottom: 4, fontFamily: "var(--font-body)" } as const;
const inputStyle = { border: "1px solid var(--color-border-light)", background: "var(--color-surface)", color: "var(--color-ink)", fontFamily: "var(--font-body)" } as const;

export function PaymentLinksModal({ contract: c, onMarkSent, onClose }: Props) {
  const [description, setDescription] = useState(
    [c.clientName, ...c.contractFor].join(" ").trim(),
  );
  const start = (n: number | null) => (n !== null && n > 0 ? String(n) : "");
  const [amounts, setAmounts] = useState<Record<FeeType, string>>({
    AF: start(c.attorneyFee),
    PF: start(c.processingFee),
    FF: start(c.filingFee),
  });
  const [copied, setCopied] = useState<FeeType | "all" | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const links = FEES.map((fee) => ({ fee, link: lawPayLink(description, fee, amounts[fee]) }));
  const ready = links.filter((l): l is { fee: FeeType; link: string } => l.link !== null);

  const copy = async (text: string, which: FeeType | "all") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied((w) => (w === which ? null : w)), 1500);
    } catch {
      setError("Could not copy — select the link and copy it by hand.");
    }
  };

  const markSent = async () => {
    if (!onMarkSent) return;
    setSaving(true);
    setError(null);
    try {
      await onMarkSent();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record the payment link");
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent code="M21" className="gap-0 p-0 sm:max-w-[560px]">
        <DialogHeader className="gap-0.5 border-b border-border px-5 py-4 pr-12">
          <DialogTitle style={{ fontFamily: "var(--font-display)" }}>Payment links</DialogTitle>
          <DialogDescription>{c.clientName}</DialogDescription>
        </DialogHeader>

        <div className="px-5 py-4 space-y-4">
          <div>
            <label style={labelStyle} htmlFor="m21-desc">Description (the reference the client sees)</label>
            <input id="m21-desc" value={description} onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-md px-2 py-1.5 text-sm" style={inputStyle} />
          </div>

          <ul className="space-y-3">
            {links.map(({ fee, link }) => (
              <li key={fee}>
                <div className="flex items-center gap-2">
                  <label htmlFor={`m21-${fee}`} className="text-sm w-36 shrink-0" style={{ color: "var(--color-ink)" }}>
                    {FEE_TYPE_LABELS[fee]} <span style={{ color: "var(--color-ink-faint)" }}>({fee})</span>
                  </label>
                  <span className="text-sm" style={{ color: "var(--color-ink-muted)" }}>$</span>
                  <input id={`m21-${fee}`} inputMode="decimal" value={amounts[fee]} placeholder="—"
                    onChange={(e) => setAmounts((a) => ({ ...a, [fee]: e.target.value }))}
                    className="w-24 rounded-md px-2 py-1 text-sm tabular-nums" style={inputStyle} />
                  <span className="text-xs" style={{ color: "var(--color-ink-faint)" }}>{fee === "FF" ? "Trust" : "Operating"}</span>
                  {link && (
                    <div className="ml-auto flex gap-1.5">
                      <Button type="button" size="sm" variant="outline" onClick={() => copy(link, fee)}>
                        {copied === fee ? "Copied ✓" : "Copy"}
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => window.open(link, "_blank", "noopener")}>
                        Open
                      </Button>
                    </div>
                  )}
                </div>
                {link && (
                  <div className="mt-1 text-xs break-all" style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-mono, monospace)" }}>
                    {link}
                  </div>
                )}
              </li>
            ))}
          </ul>

          {ready.length === 0 && (
            <p className="text-sm" style={{ color: "var(--color-ink-faint)" }}>Enter a description and at least one amount.</p>
          )}
          {error && <p className="text-sm" style={{ color: "var(--urgency-overdue)" }}>{error}</p>}

          <div className="flex items-center gap-2 pt-1">
            {ready.length > 1 && (
              <Button type="button" variant="outline"
                onClick={() => copy(ready.map((l) => `${FEE_TYPE_LABELS[l.fee]}: ${l.link}`).join("\n"), "all")}>
                {copied === "all" ? "Copied ✓" : "Copy all"}
              </Button>
            )}
            <div className="ml-auto flex gap-2">
              <Button type="button" variant="outline" onClick={onClose}>Close</Button>
              {onMarkSent && (
                <Button type="button" disabled={saving || ready.length === 0} onClick={markSent}
                  title="Sets Payment Link Sent On to today and the stage to Payment link sent">
                  {saving ? "Saving…" : "Mark sent"}
                </Button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
