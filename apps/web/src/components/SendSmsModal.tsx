// =============================================================================
// SendSmsModal (M28) — text a client through RingCentral
// =============================================================================
// The form is SmsComposer (shared with M2's "Send a text"): template, language,
// {{link}}, the text itself, and adding / editing templates. Nothing is sent
// without the Send press here.
//
// Opened from Payment links (M21, "Text links to client"), the client header
// (P3.0, "Text") and the upload link popup. Log Call (M2) has it inline as a
// checkbox instead. Rules: routes/sms.ts.
// =============================================================================

import { useState } from "react";
import { sendSms, type SendSmsResult, type SmsContext } from "../api";
import { formatUsPhone } from "@case-pipeline/core";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { SmsComposer, type SmsComposerState } from "./SmsComposer";

export { isSpanishLabel } from "./SmsComposer";

interface Props {
  /** The number to text; editable in the popup. */
  phone: string;
  /** Other numbers on file (Phone 2) — offered as one-click switches. */
  altPhones?: (string | null | undefined)[];
  /** Client or caller name — fills {{name}}, and {{firstName}} unless `firstName` is given. */
  name: string;
  /** The profile's First Name column, when there is one. */
  firstName?: string | null;
  /** Linked client: the text is logged in their Emails & Activities. */
  profileLocalId?: string | null;
  /** Monday Language label ("Spanish", the profile's "Espanol"…) — picks the template language. */
  language?: string;
  /** Template to start on; "" = free text; absent = the first template. */
  templateKey?: string;
  /** Extra placeholder values (e.g. `links` from Payment links). */
  vars?: Record<string, string>;
  context: SmsContext;
  onClose: () => void;
  onSent?: (r: SendSmsResult) => void;
}

export function SendSmsModal({
  phone, altPhones, name, firstName, profileLocalId, language, templateKey, vars, context, onClose, onSent,
}: Props) {
  const [state, setState] = useState<SmsComposerState>({ draft: null, problem: null, mode: null });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ r: SendSmsResult; to: string } | null>(null);

  const { draft, mode } = state;
  const canSend = !!draft && !sending;

  async function send() {
    if (!draft || sending) return;
    setSending(true);
    setError(null);
    try {
      const r = await sendSms({ ...draft, context, profileLocalId: profileLocalId ?? null });
      setResult({ r, to: draft.to });
      onSent?.(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent code="M28" className="gap-0 p-0 sm:max-w-[520px]">
        <DialogHeader className="gap-0.5 border-b border-border px-5 py-4 pr-12">
          <DialogTitle style={{ fontFamily: "var(--font-display)" }}>Send a text</DialogTitle>
          <DialogDescription>{name || formatUsPhone(phone)}</DialogDescription>
        </DialogHeader>

        <div className="max-h-[75vh] overflow-y-auto px-5 py-4 space-y-4" style={{ fontFamily: "var(--font-body)" }}>
          {result ? (
            <div className="text-sm" style={{ color: "var(--color-ink)" }}>
              <SmsSentLine result={result.r} to={result.to} />
              <div className="flex justify-end mt-4">
                <Button type="button" onClick={onClose}>Done</Button>
              </div>
            </div>
          ) : (
            <>
              <SmsComposer
                phone={phone} altPhones={altPhones} name={name} firstName={firstName}
                language={language} templateKey={templateKey} vars={vars} onChange={setState}
              />

              {error && <p role="alert" className="text-xs" style={{ color: "var(--color-status-red)" }}>{error}</p>}

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
                <Button type="button" onClick={send} disabled={!canSend}>
                  {sending ? "Sending…" : mode === "dry-run" ? "Send (test)" : "Send text"}
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** "✓ Text sent to …" plus where it was logged — M28's result and M2's confirmation. */
export function SmsSentLine({ result, to }: { result: SendSmsResult; to: string }) {
  return (
    <>
      <p>
        ✓ {result.mode === "on" ? "Text sent" : "Test text recorded (not sent)"} to <strong>{formatUsPhone(to)}</strong>
        {result.segments > 1 ? ` (${result.segments} segments)` : ""}.
      </p>
      {result.activity === "logged" && <p className="mt-1 text-xs" style={{ color: "var(--color-ink-muted)" }}>Logged in the client&apos;s Emails &amp; Activities.</p>}
      {result.activity === "queued" && <p className="mt-1 text-xs" style={{ color: "var(--color-ink-muted)" }}>Monday was unreachable — the timeline entry is queued.</p>}
    </>
  );
}
