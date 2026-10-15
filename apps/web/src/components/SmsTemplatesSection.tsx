// =============================================================================
// SmsTemplatesSection (P11.3.5) — the texts staff can send from M28
// =============================================================================
// One row per template: a name, the English text and the Spanish text. Shows
// the placeholders that get filled and a live segment count per language, so a
// template that costs three texts is visible before anyone sends it.
// Admin-only (the tab is); saved to data/sms-templates.json, audited.
// =============================================================================

import { useEffect, useState } from "react";
import { fetchSmsConfig, updateSmsTemplates, type SmsMode, type SmsTemplate } from "../api";
import { smsSegments, SMS_PLACEHOLDERS } from "@case-pipeline/core";
import { Button } from "./ui/button";
import { SectionCode } from "./ScreenCode";
import { settingsSectionTitle } from "./settingsStyles";

const inputStyle = { backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border-light)", color: "var(--color-ink)", fontFamily: "var(--font-body)" } as const;

const MODE_TEXT: Record<SmsMode, string> = {
  off: "Texting is off on the server (SMS_MODE).",
  "dry-run": "Test mode: texts are recorded but not sent (SMS_MODE=dry-run).",
  on: "Live: texts are sent through RingCentral.",
};

function Count({ text }: { text: string }) {
  if (!text.trim()) return null;
  const s = smsSegments(text);
  return (
    <span className="text-xs" style={{ color: s.segments > 2 ? "var(--color-status-red)" : "var(--color-ink-faint)" }}>
      ~{s.units} chars · {s.segments} {s.segments === 1 ? "text" : "texts"}{s.encoding === "unicode" ? " (accents → 70/text)" : ""}
    </span>
  );
}

export function SmsTemplatesSection() {
  const [templates, setTemplates] = useState<SmsTemplate[] | null>(null);
  const [mode, setMode] = useState<SmsMode | null>(null);
  const [fromNumber, setFromNumber] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    fetchSmsConfig()
      .then((c) => { setTemplates(c.templates); setMode(c.mode); setFromNumber(c.fromNumber); })
      .catch((e: Error) => setError(e.message));
  }, []);

  const set = (i: number, p: Partial<SmsTemplate>) => {
    setTemplates((ts) => ts && ts.map((t, j) => (j === i ? { ...t, ...p } : t)));
    setSavedAt(null);
  };

  async function save() {
    if (!templates) return;
    setSaving(true);
    setError(null);
    try {
      setTemplates(await updateSmsTemplates(templates));
      setSavedAt(Date.now());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section style={{ marginBottom: "40px" }}>
      <h2 style={settingsSectionTitle}>
        Text templates
        <SectionCode code="P11.3.5" inline />
      </h2>
      <p style={{ fontSize: 13, color: "var(--color-ink-faint)", fontFamily: "var(--font-body)", marginBottom: 8, lineHeight: 1.5 }}>
        What staff can text a client (Log Call → Text consult link). Placeholders filled in for them:{" "}
        {SMS_PLACEHOLDERS.map((p) => <code key={p} style={{ marginRight: 6 }}>{`{{${p}}}`}</code>)}
        — <code>{"{{link}}"}</code> is typed in when sending unless you write the link here. Keep the
        &quot;Reply STOP&quot; line: carriers require it.
      </p>
      {mode && (
        <p className="text-xs mb-3" style={{ color: mode === "on" ? "var(--color-ink-muted)" : "var(--color-status-red)" }}>
          {MODE_TEXT[mode]}{fromNumber ? ` From ${fromNumber}.` : ""}
        </p>
      )}

      {error && (
        <div className="px-4 py-2 rounded-lg mb-3 text-sm" style={{ backgroundColor: "var(--color-status-red-bg)", color: "var(--color-status-red)" }}>
          {error}
        </div>
      )}

      {!templates ? (
        <p className="text-sm" style={{ color: "var(--color-ink-faint)" }}>Loading…</p>
      ) : (
        <div className="space-y-4">
          {templates.map((t, i) => (
            <div key={i} className="rounded-lg p-3" style={{ border: "1px solid var(--color-border-light)" }}>
              <div className="flex items-center gap-2 mb-2">
                <input className="text-sm px-2 py-1 rounded font-semibold" style={{ ...inputStyle, width: 260 }} value={t.label}
                  placeholder="Template name" onChange={(e) => set(i, { label: e.target.value })} />
                <button type="button" className="text-xs px-2 ml-auto" style={{ color: "var(--color-ink-faint)" }}
                  aria-label={`Remove ${t.label}`}
                  onClick={() => { if (window.confirm(`Remove “${t.label}”?`)) { setTemplates((ts) => ts && ts.filter((_, j) => j !== i)); setSavedAt(null); } }}>
                  ✕ Remove
                </button>
              </div>
              <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
                {(["en", "es"] as const).map((l) => (
                  <label key={l} className="flex flex-col gap-1 text-xs" style={{ color: "var(--color-ink-muted)" }}>
                    {l === "en" ? "English" : "Español"}
                    <textarea rows={5} className="text-sm px-2 py-1 rounded" style={{ ...inputStyle, resize: "vertical" }}
                      value={t[l]} onChange={(e) => set(i, { [l]: e.target.value })} />
                    <Count text={t[l]} />
                  </label>
                ))}
              </div>
            </div>
          ))}
          <button type="button" className="text-xs hover:underline" style={{ color: "var(--color-ink-muted)" }}
            onClick={() => { setTemplates((ts) => [...(ts ?? []), { key: "", label: "", en: "", es: "" }]); setSavedAt(null); }}>
            + Add template
          </button>
          <div className="flex items-center gap-3">
            <Button type="button" size="sm" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
            {savedAt && <span className="text-xs" style={{ color: "var(--color-ink-faint)" }}>Saved</span>}
          </div>
        </div>
      )}
    </section>
  );
}
