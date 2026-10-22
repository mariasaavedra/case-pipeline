// =============================================================================
// SmsComposer — the text form shared by M28 (Send a text) and M2 (Log a call)
// =============================================================================
// Pick a template (English / Spanish), fill {{link}} if it has one, read the
// text. The text stays editable; a {{placeholder}} still in it makes the draft
// unsendable (the server refuses it too). Segment count is shown because a
// single á turns 160-character texts into 70-character ones.
//
// The composer never sends: it reports a ready-to-send draft (or why there
// isn't one) to its host, whose own button sends it — M28's "Send text", M2's
// "Log call" with "Send a text" ticked.
//
// Anyone can add a template ("+ New") or change the one picked ("Edit"); every
// user sees the same list (POST / PUT /api/sms/templates, audited). Reordering
// and deleting stay with admins in Settings → Firm.
// =============================================================================

import { useEffect, useMemo, useState } from "react";
import {
  createSmsTemplate, editSmsTemplate, fetchSmsConfig,
  type SmsConfig, type SmsMode, type SmsTemplate,
} from "../api";
import { firstNameOf, formatUsPhone, renderSmsTemplate, smsSegments, toUsE164, unfilledPlaceholders } from "@case-pipeline/core";
import { Button } from "./ui/button";

export interface SmsDraft {
  /** E.164. */
  to: string;
  body: string;
  templateKey: string | null;
  language: "en" | "es";
}

export interface SmsComposerState {
  /** Present only when the text could go out as it stands. */
  draft: SmsDraft | null;
  /** Why there is no draft, in words for staff. */
  problem: string | null;
  mode: SmsMode | null;
}

interface Props {
  /** The number to text; editable here, and followed until it is edited. */
  phone: string;
  /** Other numbers on file (Phone 2) — offered as one-click switches. */
  altPhones?: (string | null | undefined)[];
  /** Client or caller name — fills {{name}}, and {{firstName}} unless `firstName` is given. */
  name: string;
  /** The profile's First Name column, when there is one. */
  firstName?: string | null;
  /** Monday Language label ("Spanish", the profile's "Espanol"…) — picks the template language. */
  language?: string;
  /** Template to start on; "" = free text; absent = the first template. */
  templateKey?: string;
  /** Extra placeholder values (e.g. `links` from Payment links). */
  vars?: Record<string, string>;
  onChange: (s: SmsComposerState) => void;
}

const labelStyle = { display: "block", fontSize: 12, fontWeight: 600, color: "var(--color-ink-muted)", marginBottom: 4, fontFamily: "var(--font-body)" } as const;
const inputStyle = { border: "1px solid var(--color-border-light)", background: "var(--color-surface)", color: "var(--color-ink)", fontFamily: "var(--font-body)" } as const;
const linkButton = { background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 12, color: "var(--color-amber)", fontFamily: "var(--font-body)" } as const;

/** Monday's Spanish labels: "Spanish" (Call Log), "Espanol" / "Español" (Profiles). */
export const isSpanishLabel = (label: string | null | undefined) => /^(span|espa)/i.test(label?.trim() ?? "");

function Count({ text }: { text: string }) {
  if (!text.trim()) return null;
  const s = smsSegments(text);
  return (
    <span className="text-xs" style={{ color: s.segments > 2 ? "var(--color-status-red)" : "var(--color-ink-faint)" }}>
      {s.units} chars · {s.segments} {s.segments === 1 ? "text" : "texts"}
    </span>
  );
}

/** Add or change one template. Both languages optional, one required. */
function TemplateEditor({
  initial, onSaved, onCancel,
}: {
  initial: SmsTemplate | null;
  onSaved: (t: SmsTemplate) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(initial?.label ?? "");
  const [en, setEn] = useState(initial?.en ?? "");
  const [es, setEs] = useState(initial?.es ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSave = !!label.trim() && (!!en.trim() || !!es.trim()) && !saving;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const input = { label, en, es };
      onSaved(initial ? await editSmsTemplate(initial.key, input) : await createSmsTemplate(input));
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 rounded-md p-3" style={{ border: "1px solid var(--color-border-light)", background: "var(--color-surface-warm)" }}>
      <p className="text-xs" style={{ color: "var(--color-ink-muted)" }}>
        {initial ? "Changes this template for everyone." : "Everyone will see this template."}{" "}
        Fills in: {"{{firstName}} {{name}} {{link}} {{firmName}} {{firmPhone}}"}. End with &ldquo;Reply STOP to opt out.&rdquo;
      </p>
      <label className="block">
        <span style={labelStyle}>Template name</span>
        <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} placeholder="e.g. Court reminder"
          className="w-full rounded-md px-2 py-1.5 text-sm" style={inputStyle} />
      </label>
      <label className="block">
        <span style={labelStyle}>English</span>
        <textarea value={en} rows={3} onChange={(e) => setEn(e.target.value)} maxLength={400}
          className="w-full rounded-md px-2 py-1.5 text-sm" style={{ ...inputStyle, resize: "vertical" }} />
        <Count text={en} />
      </label>
      <label className="block">
        <span style={labelStyle}>Español</span>
        <textarea value={es} rows={3} onChange={(e) => setEs(e.target.value)} maxLength={400}
          className="w-full rounded-md px-2 py-1.5 text-sm" style={{ ...inputStyle, resize: "vertical" }} />
        <Count text={es} />
      </label>
      {error && <p role="alert" className="text-xs" style={{ color: "var(--color-status-red)" }}>{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
        <Button type="button" size="sm" onClick={save} disabled={!canSave}>
          {saving ? "Saving…" : initial ? "Save template" : "Add template"}
        </Button>
      </div>
    </div>
  );
}

export function SmsComposer({
  phone: initialPhone, altPhones, name, firstName, language, templateKey, vars, onChange,
}: Props) {
  const [config, setConfig] = useState<SmsConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Follows the host's number (M2's phone field) until staff pick another here.
  const [phoneOverride, setPhoneOverride] = useState<string | null>(null);
  const phone = phoneOverride ?? initialPhone;
  // null until the templates load: absent prop → the first template.
  const [chosenKey, setKey] = useState<string | null>(templateKey ?? null);
  const key = chosenKey ?? "";
  const [lang, setLang] = useState<"en" | "es">(isSpanishLabel(language) ? "es" : "en");
  const [link, setLink] = useState("");
  const [body, setBody] = useState("");
  /** Staff edited the text by hand — a template/language switch then asks first. */
  const [edited, setEdited] = useState(false);
  /** The template form: "new", or the key of the one being changed. */
  const [editing, setEditing] = useState<"new" | string | null>(null);

  useEffect(() => {
    fetchSmsConfig()
      .then((c) => {
        setConfig(c);
        // "" = free text, on purpose; an unknown or missing key falls back to the first template.
        setKey((k) => (k === "" || c.templates.some((t) => t.key === k) ? k : c.templates[0]?.key ?? ""));
      })
      .catch((e: Error) => setLoadError(e.message));
  }, []);

  const template = config?.templates.find((t) => t.key === key) ?? null;
  const templateText = template ? (template[lang] || template[lang === "en" ? "es" : "en"]) : "";
  const usesLink = /\{\{\s*link\s*\}\}/.test(templateText);

  const rendered = useMemo(
    () =>
      renderSmsTemplate(templateText, {
        firstName: firstName?.trim() || firstNameOf(name),
        name: name.trim(),
        link,
        ...config?.firm,
        ...vars,
      }),
    [templateText, name, firstName, link, config, vars],
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
  // Other US numbers on file that aren't the one in the box.
  const otherPhones = [...new Set([initialPhone, ...(altPhones ?? [])])].filter(
    (p): p is string => !!p && !!toUsE164(p) && toUsE164(p) !== to,
  );
  const segs = smsSegments(body);
  const unfilled = unfilledPlaceholders(body);
  const mode = config?.mode ?? null;

  const problem =
    loadError ? loadError
    : !config ? "Loading templates…"
    : mode === "off" ? "Texting is turned off on the server."
    : !phone.trim() ? "Add the number to text."
    : !to ? "Not a US number."
    : !body.trim() ? "Write the text."
    : unfilled.length > 0 ? `Fill in ${unfilled.map((p) => `{{${p}}}`).join(", ")} before sending.`
    : null;

  useEffect(() => {
    onChange({
      draft: problem || !to ? null : { to, body, templateKey: key || null, language: lang },
      problem,
      mode,
    });
    // onChange is the host's setter; re-running on its identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problem, to, body, key, lang, mode]);

  const onTemplateSaved = (t: SmsTemplate) => {
    setConfig((c) => c && {
      ...c,
      templates: c.templates.some((x) => x.key === t.key)
        ? c.templates.map((x) => (x.key === t.key ? t : x))
        : [...c.templates, t],
    });
    setEditing(null);
    setEdited(false);
    setKey(t.key);
  };

  return (
    <div className="space-y-4" style={{ fontFamily: "var(--font-body)" }}>
      {mode === "dry-run" && (
        <p className="text-xs px-3 py-2 rounded" style={{ background: "var(--color-amber-light)", color: "var(--color-ink)" }}>
          Test mode — the text is recorded but <strong>not sent</strong>.
        </p>
      )}
      {mode === "off" && (
        <p className="text-xs px-3 py-2 rounded" style={{ background: "var(--color-status-red-bg)", color: "var(--color-status-red)" }}>
          Texting is turned off on the server.
        </p>
      )}
      {loadError && <p role="alert" className="text-xs" style={{ color: "var(--color-status-red)" }}>{loadError}</p>}

      <div className="flex gap-3">
        <label className="flex-1">
          <span style={labelStyle}>To{config?.fromNumber ? ` · from ${config.fromNumber}` : ""}</span>
          <input type="tel" value={phone} onChange={(e) => setPhoneOverride(e.target.value)}
            className="w-full rounded-md px-2 py-1.5 text-sm" style={inputStyle} />
          {phone && !to && <span className="text-xs" style={{ color: "var(--color-status-red)" }}>Not a US number</span>}
          {otherPhones.map((p) => (
            <button key={p} type="button" onClick={() => setPhoneOverride(p)} className="block text-xs hover:underline mt-0.5"
              style={{ color: "var(--color-ink-muted)" }}>
              Use {formatUsPhone(p)} instead
            </button>
          ))}
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

      {editing ? (
        <TemplateEditor
          key={editing}
          initial={editing === "new" ? null : config?.templates.find((t) => t.key === editing) ?? null}
          onSaved={onTemplateSaved}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <div>
          <div className="flex items-baseline justify-between">
            <span style={labelStyle}>Template</span>
            <span className="flex gap-3">
              {template && <button type="button" style={linkButton} onClick={() => setEditing(template.key)}>Edit template</button>}
              <button type="button" style={linkButton} onClick={() => setEditing("new")} disabled={!config}>+ New template</button>
            </span>
          </div>
          <select aria-label="Template" value={key} onChange={(e) => { const v = e.target.value; switchTemplate(() => setKey(v)); }}
            className="w-full rounded-md px-2 py-1.5 text-sm" style={inputStyle} disabled={!config}>
            {config?.templates.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            <option value="">Free text</option>
          </select>
        </div>
      )}

      {usesLink && !edited && (
        <label className="block">
          <span style={labelStyle}>Link</span>
          <input type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://calendly.com/…"
            className="w-full rounded-md px-2 py-1.5 text-sm" style={inputStyle} />
        </label>
      )}

      <label className="block">
        <span style={labelStyle}>Text</span>
        <textarea value={body} rows={5} onChange={(e) => { setBody(e.target.value); setEdited(true); }}
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
    </div>
  );
}
