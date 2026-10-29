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
//
// Split (rare — a client's bank won't take the whole fee at once): the small
// "Split" next to a fee turns it into 2–4 links, equal by default; typing one
// part fills in the others so they still add up. Each part has its own
// reference ("AF 1/2"), and the API calls the fee paid once every part is.
// =============================================================================

import { useState } from "react";
import { recordPaymentLinks, type PendingContract } from "../api";
import { useAuth } from "../auth/useAuth";
import { GraphConsentRequiredError, sendMailAsMe } from "../sharepoint/graph";
import { chargeFor, payMethodOf, paymentEmail, paymentLines, type PayMethod } from "../lib/payment-email";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import {
  formatLawPayAmount, lawPayLink, lawPayReference, partsAddUp, rebalanceParts, splitEvenly, withFeeKCode,
  FEE_TYPE_LABELS, MAX_PARTS, type FeePart, type FeeType,
} from "../lib/lawpay";
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

const toNumber = (raw: string) => {
  const n = Number(raw.replace(/[^0-9.]/g, ""));
  return raw.trim() !== "" && Number.isFinite(n) && n > 0 ? n : null;
};
const toText = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** One link: a whole fee, or one part of a split fee. */
interface LinkItem { fee: FeeType; part?: FeePart; amount: number; link: string | null }
const itemKey = (i: Pick<LinkItem, "fee" | "part">) => (i.part ? `${i.fee}-${i.part.n}` : i.fee);
const itemLabel = (i: Pick<LinkItem, "fee" | "part">) =>
  `${FEE_TYPE_LABELS[i.fee]}${i.part ? ` (${i.part.n} of ${i.part.of})` : ""}`;

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
  /** Split fees: each part as typed. Monday's "SPLIT PAYMENTS" opens with the AF in two. */
  const [splits, setSplits] = useState<Partial<Record<FeeType, string[]>>>(() =>
    /split/i.test(c.paymentMethod ?? "") && (c.attorneyFee ?? 0) > 0 ? { AF: splitEvenly(c.attorneyFee!, 2).map(toText) } : {});
  const [copied, setCopied] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [smsOpen, setSmsOpen] = useState(false);
  /** After a text: "marked" = live text + stage recorded; "texted" = sent, nothing to mark; "test" = dry run. */
  const [texted, setTexted] = useState<"marked" | "texted" | "test" | null>(null);

  const { user } = useAuth();
  const [method, setMethod] = useState<PayMethod | null>(payMethodOf(c.paymentMethod));
  const fee = (f: FeeType) => toNumber(amounts[f]);
  const charge = (n: number) => (method === "credit" ? chargeFor(n, "credit") : n);
  // Every reference carries the Fee K's code, so LawPay's receipt names its Fee K.
  const reference = withFeeKCode(description, c.mondayItemId);

  // A split fee's parts, when they add up to the fee (else no links for it yet).
  const partsOf = (f: FeeType): number[] | null => {
    const total = fee(f);
    const parts = splits[f]?.map((p) => toNumber(p) ?? 0);
    return total !== null && parts && partsAddUp(total, parts) ? parts : null;
  };
  const unbalanced = FEES.filter((f) => splits[f] && fee(f) !== null && !partsOf(f));
  const items: LinkItem[] = method === "cash" ? [] : FEES.flatMap((f) => {
    const total = fee(f);
    if (total === null) return [];
    const parts = splits[f] ? partsOf(f) : [total];
    if (!parts) return [];
    return parts.map((base, i) => {
      const part = parts.length > 1 ? { n: i + 1, of: parts.length } : undefined;
      const amount = charge(base);
      return { fee: f, part, amount, link: lawPayLink(reference, f, amount, part) };
    });
  });

  const resplit = (f: FeeType, n: number) => {
    const total = fee(f);
    if (total !== null) setSplits((s) => ({ ...s, [f]: splitEvenly(total, n).map(toText) }));
  };
  const cancelSplit = (f: FeeType) => setSplits((s) => {
    const rest = { ...s };
    delete rest[f];
    return rest;
  });
  // Typing one part fills in the others so they still add up to the fee.
  const setPart = (f: FeeType, i: number, raw: string) => {
    setSplits((s) => {
      const parts = [...(s[f] ?? [])];
      parts[i] = raw;
      const total = fee(f);
      const typed = toNumber(raw);
      if (total === null || typed === null || typed >= total) return { ...s, [f]: parts };
      const balanced = rebalanceParts(total, parts.map((p) => toNumber(p) ?? 0), i);
      return { ...s, [f]: balanced.map((p, k) => (k === i ? raw : toText(p))) };
    });
  };
  const setAmount = (f: FeeType, raw: string) => {
    setAmounts((a) => ({ ...a, [f]: raw }));
    // A new fee re-splits evenly in the same number of parts.
    const total = toNumber(raw);
    if (splits[f] && total !== null) setSplits((s) => ({ ...s, [f]: splitEvenly(total, s[f]!.length).map(toText) }));
  };

  // Every way the links leave M21 is recorded, so LawPay's payment finds this Fee K.
  const record = (channel: "email" | "text" | "copy" | "mark") => {
    const out = items.flatMap((it) => {
      const text = formatLawPayAmount(it.amount);
      return text && reference ? [{ fee: it.fee, amount: Number(text), reference: lawPayReference(reference, it.fee, text, it.part) }] : [];
    });
    void recordPaymentLinks(c.localId, { channel, method, links: out });
  };

  // The e-mail (app-signed contracts only).
  const emailTo = c.signedInApp?.clientEmail ?? null;
  const email = emailTo && method && method !== "cash"
    ? paymentEmail({
        clientName: c.clientName,
        matter: c.contractFor.join(", "),
        lines: paymentLines(reference, { AF: fee("AF"), FF: fee("FF"), PF: fee("PF") }, method,
          Object.fromEntries(FEES.flatMap((f) => { const p = partsOf(f); return p ? [[f, p]] : []; }))),
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
  // Nothing goes out while a split doesn't add up: the client would get part of a fee.
  const ready = unbalanced.length ? [] : items.filter((l): l is LinkItem & { link: string } => l.link !== null);
  const linksText = ready.map((l) => `${itemLabel(l)}: ${l.link}`).join("\n");

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

  const copy = async (text: string, which: string) => {
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
            {FEES.map((fee) => {
              const split = splits[fee];
              const total = toNumber(amounts[fee]);
              const whole = split ? undefined : items.find((i) => i.fee === fee);
              return (
              <li key={fee}>
                <div className="flex items-center gap-2">
                  <label htmlFor={`m21-${fee}`} className="text-sm w-36 shrink-0" style={{ color: "var(--color-ink)" }}>
                    {FEE_TYPE_LABELS[fee]} <span style={{ color: "var(--color-ink-faint)" }}>({fee})</span>
                  </label>
                  <span className="text-sm" style={{ color: "var(--color-ink-muted)" }}>$</span>
                  <input id={`m21-${fee}`} inputMode="decimal" value={amounts[fee]} placeholder="—"
                    onChange={(e) => setAmount(fee, e.target.value)}
                    className="w-24 rounded-md px-2 py-1 text-sm tabular-nums" style={inputStyle} />
                  <span className="text-xs" style={{ color: "var(--color-ink-faint)" }}>
                    {fee === "FF" ? "Trust" : "Operating"}
                    {method === "credit" && whole && <> · link ${whole.amount.toFixed(2)} with 3%</>}
                  </span>
                  {!split && total !== null && (
                    <button type="button" onClick={() => resplit(fee, 2)} className="text-xs underline"
                      style={{ color: "var(--color-ink-faint)" }}
                      title="For a client whose bank won't take the whole amount at once: one link per part">
                      Split
                    </button>
                  )}
                  {whole?.link && <LinkButtons link={whole.link} copied={copied === fee} onCopy={() => copy(whole.link!, fee)} />}
                </div>
                {whole?.link && <LinkText link={whole.link} />}

                {split && total !== null && (
                  <div className="mt-2 ml-4 rounded-md border p-2 space-y-2" style={{ borderColor: "var(--color-border-light)" }}>
                    <div className="flex items-center gap-2 text-xs" style={{ color: "var(--color-ink-muted)" }}>
                      <label htmlFor={`m21-${fee}-n`}>Split into</label>
                      <select id={`m21-${fee}-n`} value={split.length} onChange={(e) => resplit(fee, Number(e.target.value))}
                        className="rounded-md px-1 py-0.5 text-xs" style={inputStyle}>
                        {Array.from({ length: MAX_PARTS - 1 }, (_, k) => k + 2).map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                      <span>payments</span>
                      <button type="button" onClick={() => cancelSplit(fee)} className="ml-auto underline">Don&apos;t split</button>
                    </div>
                    {split.map((raw, i) => {
                      const n = i + 1;
                      const item = items.find((it) => it.fee === fee && it.part?.n === n);
                      return (
                        <div key={i}>
                          <div className="flex items-center gap-2">
                            <label htmlFor={`m21-${fee}-${i}`} className="text-sm w-32 shrink-0" style={{ color: "var(--color-ink)" }}>
                              Part {n} of {split.length}
                            </label>
                            <span className="text-sm" style={{ color: "var(--color-ink-muted)" }}>$</span>
                            <input id={`m21-${fee}-${i}`} inputMode="decimal" value={raw}
                              onChange={(e) => setPart(fee, i, e.target.value)}
                              className="w-24 rounded-md px-2 py-1 text-sm tabular-nums" style={inputStyle} />
                            {method === "credit" && item && (
                              <span className="text-xs" style={{ color: "var(--color-ink-faint)" }}>link ${item.amount.toFixed(2)} with 3%</span>
                            )}
                            {item?.link && <LinkButtons link={item.link} copied={copied === itemKey(item)} onCopy={() => copy(item.link!, itemKey(item))} />}
                          </div>
                          {item?.link && <LinkText link={item.link} />}
                        </div>
                      );
                    })}
                    {unbalanced.includes(fee) && (
                      <p className="text-xs" style={{ color: "var(--urgency-overdue)" }}>
                        The parts add up to {usd.format(split.reduce((sum, p) => sum + (toNumber(p) ?? 0), 0))}, not {usd.format(total)}
                        {split.some((p) => toNumber(p) === null) ? " — every part needs an amount" : ""}.
                      </p>
                    )}
                  </div>
                )}
              </li>
              );
            })}
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

          {method !== "cash" && ready.length === 0 && !unbalanced.length && (
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

function LinkButtons({ link, copied, onCopy }: { link: string; copied: boolean; onCopy: () => void }) {
  return (
    <div className="ml-auto flex gap-1.5">
      <Button type="button" size="sm" variant="outline" onClick={onCopy}>
        {copied ? "Copied ✓" : "Copy"}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => window.open(link, "_blank", "noopener")}>
        Open
      </Button>
    </div>
  );
}

function LinkText({ link }: { link: string }) {
  return (
    <div className="mt-1 text-xs break-all" style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-mono, monospace)" }}>
      {link}
    </div>
  );
}
