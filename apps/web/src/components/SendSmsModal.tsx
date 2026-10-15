// =============================================================================
// SendSmsModal (M28) — text a client through RingCentral
// =============================================================================
// Pick a template (English / Spanish), fill {{link}} if it has one, read the
// text, press Send. Nothing is sent without that press. The text stays
// editable; a {{placeholder}} still in it blocks Send (the server refuses it
// too). Segment count is shown because a single á turns 160-character texts
// into 70-character ones.
//
// Opened from Log Call (M2, "Text consult link"); later from Payment links
// (M21) and the client page. Rules: routes/sms.ts.
// =============================================================================

import { useEffect, useMemo, useState } from "react";
import { fetchSmsConfig, sendSms, type SendSmsResult, type SmsConfig, type SmsContext } from "../api";
import { firstNameOf, formatUsPhone, renderSmsTemplate, smsSegments, toUsE164, unfilledPlaceholders } from "@case-pipeline/core";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";

interface Props {
  /** The number to text; editable in the popup. */
  phone: string;
  /** Client or caller name — fills {{firstName}} / {{name}}. */
  name: string;
  /** Linked client: the text is logged in their Emails & Activities. */
  profileLocalId?: string | null;
  /** Monday Language label ("Spanish"…) — picks the template language. */
  language?: string;
  /** Template to start on. */
  templateKey?: string;
  /** Extra placeholder values (e.g. `links` from Payment links). */
  vars?: Record<string, string>;
  context: SmsContext;
  onClose: () => void;
  onSent?: (r: SendSmsResult) => void;
}

const labelStyle = { display: "block", fontSize: 12, fontWeight: 600, color: "var(--color-ink-muted)", marginBottom: 4, fontFamily: "var(--font-body)" } as const;
const inputStyle = { border: "1px solid var(--color-border-light)", background: "var(--color-surface)", color: "var(--color-ink)", fontFamily: "var(--font-body)" } as const;

export function SendSmsModal({ phone: initialPhone, name, profileLocalId, language, templateKey, vars, context, onClose, onSent }: Props) {
  const [config, setConfig] = useState<SmsConfig | null>(null);
  const [phone, setPhone] = useState(initialPhone);
  const [key, setKey] = useState(templateKey ?? "");
  const [lang, setLang] = useState<"en" | "es">(/^span/i.test(language ?? "") ? "es" : "en");
  const [link, setLink] = useState("");
  const [body, setBody] = useState("");
  /** Staff edited the text by hand — a template/language switch then asks first. */
  const [edited, setEdited] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SendSmsResult | null>(null);

  useEffect(() => {
    fetchSmsConfig()
      .then((c) => {
        setConfig(c);
        setKey((k) => (c.templates.some((t) => t.key === k) ? k : c.templates[0]?.key ?? ""));
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const template = config?.templates.find((t) => t.key === key) ?? null;
  const templateText = template ? (template[lang] || template[lang === "en" ? "es" : "en"]) : "";
  const usesLink = /\{\{\s*link\s*\}\}/.test(templateText);

  const rendered = useMemo(
    () =>
      renderSmsTemplate(templateText, {
        firstName: firstNameOf(name),
        name: name.trim(),
        link,
        ...config?.firm,
        ...vars,
      }),
    [templateText, name, link, config, vars],
  );

  // The text follows the template until staff type in it.
  useEffect(() => {
    if (!edited) setBody(rendered.body);
  }, [rendered.body, edited]);

  const switchTemplate = (fn: () => void) => {
    if (edited && !window.confirm("Replace the text you edited with the template?")) return;
    setEdited(false);
    fn();
  };

  const to = toUsE164(phone);
  const segs = smsSegments(body);
  const unfilled = unfilledPlaceholders(body);
  const mode = config?.mode ?? "off";
  const canSend = mode !== "off" && !!to && body.trim().length > 0 && unfilled.length === 0 && !sending;

  async function send() {
    if (!canSend || !to) return;
    setSending(true);
    setError(null);
    try {
      const r = await sendSms({ to, body, context, templateKey: key || null, language: lang, profileLocalId: profileLocalId ?? null });
      setResult(r);
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
          <DialogDescription>
            {name || formatUsPhone(phone)}
            {config?.fromNumber ? ` · from ${config.fromNumber}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 py-4 space-y-4" style={{ fontFamily: "var(--font-body)" }}>
          {mode === "dry-run" && (
            <p className="text-xs px-3 py-2 rounded" style={{ background: "var(--color-amber-light)", color: "var(--color-ink)" }}>
              Test mode — the text is recorded but <strong>not sent</strong>.
            </p>
          )}
          {config && mode === "off" && (
            <p className="text-xs px-3 py-2 rounded" style={{ background: "var(--color-status-red-bg)", color: "var(--color-status-red)" }}>
              Texting is turned off on the server.
            </p>
          )}

          {result ? (
            <div className="text-sm" style={{ color: "var(--color-ink)" }}>
              <p>
                ✓ {result.mode === "on" ? "Text sent" : "Test text recorded (not sent)"} to <strong>{formatUsPhone(phone)}</strong>
                {result.segments > 1 ? ` (${result.segments} segments)` : ""}.
              </p>
              {result.activity === "logged" && <p className="mt-1 text-xs" style={{ color: "var(--color-ink-muted)" }}>Logged in the client&apos;s Emails &amp; Activities.</p>}
              {result.activity === "queued" && <p className="mt-1 text-xs" style={{ color: "var(--color-ink-muted)" }}>Monday was unreachable — the timeline entry is queued.</p>}
              <div className="flex justify-end mt-4">
                <Button type="button" onClick={onClose}>Done</Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex gap-3">
                <label className="flex-1">
                  <span style={labelStyle}>To</span>
                  <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
                    className="w-full rounded-md px-2 py-1.5 text-sm" style={inputStyle} />
                  {phone && !to && <span className="text-xs" style={{ color: "var(--color-status-red)" }}>Not a US number</span>}
                </label>
                <div>
                  <span style={labelStyle}>Language</span>
                  <div className="flex rounded-md overflow-hidden" style={{ border: "1px solid var(--color-border-light)" }}>
                    {(["en", "es"] as const).map((l) => (
                      <button key={l} type="button" onClick={() => switchTemplate(() => setLang(l))}
                        className="px-3 py-1.5 text-sm"
                        style={{ background: lang === l ? "var(--color-ink)" : "var(--color-surface)", color: lang === l ? "var(--color-surface)" : "var(--color-ink)" }}>
                        {l === "en" ? "English" : "Español"}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <label className="block">
                <span style={labelStyle}>Template</span>
                <select value={key} onChange={(e) => { const v = e.target.value; switchTemplate(() => setKey(v)); }}
                  className="w-full rounded-md px-2 py-1.5 text-sm" style={inputStyle} disabled={!config}>
                  {config?.templates.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                  <option value="">Free text</option>
                </select>
              </label>

              {usesLink && !edited && (
                <label className="block">
                  <span style={labelStyle}>Link</span>
                  <input type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://calendly.com/…"
                    className="w-full rounded-md px-2 py-1.5 text-sm" style={inputStyle} />
                </label>
              )}

              <label className="block">
                <span style={labelStyle}>Text</span>
                <textarea value={body} rows={6} onChange={(e) => { setBody(e.target.value); setEdited(true); }}
                  className="w-full rounded-md px-2 py-1.5 text-sm" style={{ ...inputStyle, resize: "vertical" }} />
                <span className="text-xs" style={{ color: segs.segments > 2 ? "var(--color-status-red)" : "var(--color-ink-faint)" }}>
                  {segs.units} characters · {segs.segments} {segs.segments === 1 ? "text" : "texts"}
                  {segs.encoding === "unicode" ? " (accents like á/í/ó/ú shorten each text to 70)" : ""}
                </span>
                {unfilled.length > 0 && (
                  <span className="block text-xs" style={{ color: "var(--color-status-red)" }}>
                    Fill in {unfilled.map((p) => `{{${p}}}`).join(", ")} before sending.
                  </span>
                )}
              </label>

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
