// =============================================================================
// PaymentLinksModal (M21) — LawPay payment links for a signed contract
// =============================================================================
// One link per fee on the contract: AF and PF go to Operating, FF to Trust
// (rules in lib/lawpay.ts, same as the firm's own link script). The
// description starts as "<client> <case type>" and is editable; amounts start
// from Monday's AF / PF / FF and are editable too. Staff either copy the links
// into their own message and press "Mark sent" (records Payment Link Sent On,
// stage → Payment link sent), or press "Text links to client" (M28): a live
// text marks it sent by itself; a test-mode text doesn't.
//
// How the client pays (Credit / Debit / Cash — their pick in the Adobe-signed
// contract lands in the Fee K's Payment Method) sets the amounts: by credit
// card each link carries its own 3%, cash gets no links. For a contract signed
// in Adobe after being sent from the app — only those (decided 2026-10-16) —
// "Email links to client" sends one English + Spanish e-mail
// (lib/payment-email.ts) from the staff member's own Outlook (Graph Mail.Send)
// to the address the client signed with, then marks it sent. Staff see the
// e-mail before sending: the one-click check while this is new.
// =============================================================================

import { useState } from "react";
import { recordPaymentLinks, type PendingContract } from "../api";
import { useAuth } from "../auth/useAuth";
import { GraphConsentRequiredError, sendMailAsMe } from "../sharepoint/graph";
import { chargeFor, payMethodOf, paymentEmail, paymentLines, type PayMethod } from "../lib/payment-email";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { formatLawPayAmount, lawPayLink, lawPayReference, withFeeKCode, FEE_TYPE_LABELS, type FeeType } from "../lib/lawpay";
import { SendSmsModal } from "./SendSmsModal";
import type { SendSmsResult } from "../api";

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

  const [smsOpen, setSmsOpen] = useState(false);
  /** After a text: "marked" = live text + stage recorded; "texted" = sent, nothing to mark; "test" = dry run. */
  const [texted, setTexted] = useState<"marked" | "texted" | "test" | null>(null);

  const { user } = useAuth();
  const [method, setMethod] = useState<PayMethod | null>(payMethodOf(c.paymentMethod));
  const fee = (f: FeeType) => {
    const n = Number(amounts[f].replace(/[^0-9.]/g, ""));
    return amounts[f].trim() !== "" && Number.isFinite(n) && n > 0 ? n : null;
  };
  const charged = (f: FeeType) => {
    const n = fee(f);
    return n === null ? null : method === "credit" ? chargeFor(n, "credit") : n;
  };
  // Every reference carries the Fee K's code, so LawPay's receipt names its Fee K.
  const reference = withFeeKCode(description, c.mondayItemId);
  const links = method === "cash" ? [] : FEES.map((f) => ({ fee: f, link: lawPayLink(reference, f, charged(f) ?? "") }));

  // Every way the links leave M21 is recorded, so LawPay's payment finds this Fee K.
  const record = (channel: "email" | "text" | "copy" | "mark") => {
    const out = method === "cash" ? [] : FEES.flatMap((f) => {
      const amount = charged(f);
      const text = amount === null ? null : formatLawPayAmount(amount);
      return text && reference ? [{ fee: f, amount: Number(text), reference: lawPayReference(reference, f, text) }] : [];
    });
    void recordPaymentLinks(c.localId, { channel, method, links: out });
  };

  // The e-mail (app-signed contracts only).
  const emailTo = c.signedInApp?.clientEmail ?? null;
  const email = emailTo && method && method !== "cash"
    ? paymentEmail({
        clientName: c.clientName,
        matter: c.contractFor.join(", "),
        lines: paymentLines(reference, { AF: fee("AF"), FF: fee("FF"), PF: fee("PF") }, method),
        method,
        senderName: user?.name ?? "",
      })
    : null;
  const [mailing, setMailing] = useState(false);
  const [needsMailConsent, setNeedsMailConsent] = useState(false);
  const [mailed, setMailed] = useState<"marked" | "sent" | null>(null);
  const sendEmail = async (interactive: boolean) => {
    if (!email || !emailTo) return;
    setMailing(true);
    setError(null);
    try {
      await sendMailAsMe({ to: emailTo, subject: email.subject, html: email.html }, interactive);
      setNeedsMailConsent(false);
      record("email");
    } catch (e) {
      if (e instanceof GraphConsentRequiredError) setNeedsMailConsent(true);
      else setError(e instanceof Error ? `The e-mail was not sent: ${e.message}` : "The e-mail was not sent");
      setMailing(false);
      return;
    }
    if (!onMarkSent) { setMailed("sent"); setMailing(false); return; }
    try {
      await onMarkSent();
      setMailed("marked");
    } catch (e) {
      setMailed("sent");
      setError(`E-mail sent, but the stage wasn't recorded: ${e instanceof Error ? e.message : "error"} — press Mark sent.`);
    }
    setMailing(false);
  };
  const ready = links.filter((l): l is { fee: FeeType; link: string } => l.link !== null);
  const linksText = ready.map((l) => `${FEE_TYPE_LABELS[l.fee]}: ${l.link}`).join("\n");

  // A live text is the link going out, so it records the step the same as
  // "Mark sent". A failure there is shown here; the text itself already went.
  const onTexted = async (r: SendSmsResult) => {
    if (r.mode !== "on") { setTexted("test"); return; }
    record("text");
    if (!onMarkSent) { setTexted("texted"); return; }
    try {
      await onMarkSent();
      setTexted("marked");
    } catch (e) {
      setTexted("texted");
      setError(`Text sent, but the stage wasn't recorded: ${e instanceof Error ? e.message : "error"} — press Mark sent.`);
    }
  };

  const copy = async (text: string, which: FeeType | "all") => {
    try {
      await navigator.clipboard.writeText(text);
      record("copy");
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
      record("mark");
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
            {reference !== description.trim() && (
              <p className="text-xs mt-1" style={{ color: "var(--color-ink-faint)" }}>
                The links add <strong>{reference.slice(description.trim().length).trim()}</strong>: the Fee K&apos;s code, so the payment finds this Fee K by itself.
              </p>
            )}
          </div>

          <fieldset>
            <legend style={labelStyle}>How the client pays{c.paymentMethod ? <span style={{ fontWeight: 400 }}> · Monday: {c.paymentMethod}</span> : null}</legend>
            <div className="flex gap-3 text-sm" style={{ color: "var(--color-ink)" }}>
              {([["credit", "Credit card (+3%)"], ["debit", "Debit card"], ["cash", "Cash"]] as const).map(([m, label]) => (
                <label key={m} className="flex items-center gap-1.5">
                  <input type="radio" name="m21-method" checked={method === m} onChange={() => setMethod(m)} /> {label}
                </label>
              ))}
            </div>
          </fieldset>

          {method === "cash" ? (
            <p className="text-sm" style={{ color: "var(--color-ink-muted)" }}>
              The client pays in cash during lobby hours — no payment links.
            </p>
          ) : (
          <ul className="space-y-3">
            {FEES.map((fee) => ({ fee, link: links.find((l) => l.fee === fee)?.link ?? null })).map(({ fee, link }) => (
              <li key={fee}>
                <div className="flex items-center gap-2">
                  <label htmlFor={`m21-${fee}`} className="text-sm w-36 shrink-0" style={{ color: "var(--color-ink)" }}>
                    {FEE_TYPE_LABELS[fee]} <span style={{ color: "var(--color-ink-faint)" }}>({fee})</span>
                  </label>
                  <span className="text-sm" style={{ color: "var(--color-ink-muted)" }}>$</span>
                  <input id={`m21-${fee}`} inputMode="decimal" value={amounts[fee]} placeholder="—"
                    onChange={(e) => setAmounts((a) => ({ ...a, [fee]: e.target.value }))}
                    className="w-24 rounded-md px-2 py-1 text-sm tabular-nums" style={inputStyle} />
                  <span className="text-xs" style={{ color: "var(--color-ink-faint)" }}>
                    {fee === "FF" ? "Trust" : "Operating"}
                    {method === "credit" && charged(fee) !== null && <> · link ${charged(fee)!.toFixed(2)} with 3%</>}
                  </span>
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
          )}

          {email && emailTo && (
            <div className="rounded-md border p-3 space-y-2" style={{ borderColor: "var(--color-border-light)" }}>
              <div className="text-sm" style={{ color: "var(--color-ink)" }}>
                E-mail the links to <strong>{emailTo}</strong> <span style={{ color: "var(--color-ink-faint)" }}>(the address the client signed with)</span>
              </div>
              <details>
                <summary className="text-xs cursor-pointer" style={{ color: "var(--color-ink-muted)" }}>Preview the e-mail · {email.subject}</summary>
                <pre className="mt-2 text-xs whitespace-pre-wrap" style={{ color: "var(--color-ink)", fontFamily: "var(--font-body)" }}>{email.text}</pre>
              </details>
              {mailed ? (
                <p className="text-sm" style={{ color: "var(--color-ink)" }}>
                  {mailed === "marked" ? "✓ E-mailed to the client and marked sent." : "✓ E-mailed to the client."}
                </p>
              ) : needsMailConsent ? (
                <Button type="button" disabled={mailing} onClick={() => void sendEmail(true)}>
                  Allow sending from your Outlook, then send
                </Button>
              ) : (
                <Button type="button" disabled={mailing || ready.length === 0} onClick={() => void sendEmail(false)}>
                  {mailing ? "Sending…" : "Email links to client"}
                </Button>
              )}
            </div>
          )}
          {c.signedInApp && !method && (
            <p className="text-sm" style={{ color: "var(--color-ink-muted)" }}>Pick how the client pays to e-mail the links.</p>
          )}

          {method !== "cash" && ready.length === 0 && (
            <p className="text-sm" style={{ color: "var(--color-ink-faint)" }}>Enter a description and at least one amount.</p>
          )}
          {error && <p className="text-sm" style={{ color: "var(--urgency-overdue)" }}>{error}</p>}
          {texted && (
            <p className="text-sm" style={{ color: "var(--color-ink)" }}>
              {texted === "marked" && "✓ Links texted to the client and marked sent."}
              {texted === "texted" && "✓ Links texted to the client."}
              {texted === "test" && "Test text recorded (not sent) — nothing marked."}
            </p>
          )}

          <div className="flex items-center gap-2 pt-1 flex-wrap">
            {ready.length > 1 && (
              <Button type="button" variant="outline"
                onClick={() => copy(linksText, "all")}>
                {copied === "all" ? "Copied ✓" : "Copy all"}
              </Button>
            )}
            <Button type="button" variant="outline" disabled={ready.length === 0} onClick={() => setSmsOpen(true)}
              title={c.clientPhone || c.clientContact.phone2 ? undefined : "No phone on the client's profile — type one in"}>
              Text links to client
            </Button>
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

      {smsOpen && (
        <SendSmsModal
          context="payment_links"
          templateKey="payment_links"
          vars={{ links: linksText }}
          phone={c.clientPhone || c.clientContact.phone2 || ""}
          altPhones={[c.clientContact.phone2]}
          name={c.clientName}
          firstName={c.clientContact.firstName}
          language={c.clientContact.preferredLanguage ?? undefined}
          profileLocalId={c.clientLocalId}
          onSent={(r) => void onTexted(r)}
          onClose={() => setSmsOpen(false)}
        />
      )}
    </Dialog>
  );
}
