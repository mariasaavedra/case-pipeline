// =============================================================================
// DocumentSettingsSection (P11.3.4) — what generated forms need from the firm
// =============================================================================
// The G-28 (M23) takes the attorney's details and a detained client's facility
// address from here, since Monday holds neither: the firm's shared address /
// phone / fax, each attorney's e-mail, USCIS online account and bar
// admissions, and each Det. Facility's mailing address. Admin-only (the tab is).
// =============================================================================

import { useEffect, useState } from "react";
import {
  fetchDocumentSettings, updateDocumentSettings,
  type AttorneyInfo, type DocumentSettings, type FacilityInfo, type FirmInfo,
} from "../api";
import { Button } from "./ui/button";
import { SectionCode } from "./ScreenCode";
import { settingsSectionTitle } from "./settingsStyles";

const inputStyle = { backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border-light)", color: "var(--color-ink)" } as const;
const subTitle = { fontSize: 13, fontWeight: 600, color: "var(--color-ink)", fontFamily: "var(--font-body)", margin: "16px 0 6px" } as const;
const th = { textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--color-ink-faint)", padding: "4px 6px", whiteSpace: "nowrap" } as const;

/** "MO 57287, KS 20857" ↔ bars; the first one goes on the form. */
const barsText = (a: AttorneyInfo) => {
  const def = a.bars.find((b) => b.state === a.defaultBar);
  return [...(def ? [def] : []), ...a.bars.filter((b) => b !== def)].map((b) => `${b.state} ${b.number}`).join(", ");
};
const parseBars = (s: string) =>
  s.split(/[,;]/).map((p) => p.trim()).filter(Boolean).map((p) => {
    const [state = "", ...rest] = p.split(/\s+/);
    return { state: state.toUpperCase().slice(0, 2), number: rest.join("") };
  });

function Cell({ value, onChange, width, placeholder }: { value: string; onChange: (v: string) => void; width: number; placeholder?: string }) {
  return (
    <td style={{ padding: "2px 3px" }}>
      <input className="text-sm px-2 py-1 rounded" style={{ ...inputStyle, width }} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </td>
  );
}

export function DocumentSettingsSection() {
  const [settings, setSettings] = useState<DocumentSettings | null>(null);
  // Bars are edited as text and parsed on save, so a half-typed "KS" isn't lost.
  const [bars, setBars] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const load = (s: DocumentSettings) => {
    setSettings(s);
    setBars(s.attorneys.map(barsText));
  };

  useEffect(() => {
    fetchDocumentSettings().then(load).catch((e: Error) => setError(e.message));
  }, []);

  const touch = (fn: (s: DocumentSettings) => DocumentSettings) => {
    setSettings((s) => (s ? fn(s) : s));
    setSavedAt(null);
  };
  const setFirm = (p: Partial<FirmInfo>) => touch((s) => ({ ...s, firm: { ...s.firm, ...p } }));
  const setAttorney = (i: number, p: Partial<AttorneyInfo>) =>
    touch((s) => ({ ...s, attorneys: s.attorneys.map((a, j) => (j === i ? { ...a, ...p } : a)) }));
  const setFacility = (i: number, p: Partial<FacilityInfo>) =>
    touch((s) => ({ ...s, facilities: s.facilities.map((f, j) => (j === i ? { ...f, ...p } : f)) }));

  async function save() {
    if (!settings) return;
    setSaving(true);
    setError(null);
    try {
      const attorneys = settings.attorneys.map((a, i) => {
        const parsed = parseBars(bars[i] ?? "");
        return { ...a, bars: parsed, defaultBar: parsed[0]?.state ?? "" };
      });
      load(await updateDocumentSettings({ ...settings, attorneys }));
      setSavedAt(Date.now());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const firmField = (k: keyof FirmInfo, label: string, width: number) =>
    settings && (
      <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--color-ink-muted)" }}>
        {label}
        <input className="text-sm px-2 py-1 rounded" style={{ ...inputStyle, width }} value={settings.firm[k]} onChange={(e) => setFirm({ [k]: e.target.value })} />
      </label>
    );

  return (
    <section style={{ marginBottom: "40px" }}>
      <h2 style={settingsSectionTitle}>
        Documents
      <SectionCode code="P11.3.4" inline /></h2>
      <p style={{ fontSize: 13, color: "var(--color-ink-faint)", fontFamily: "var(--font-body)", marginBottom: 12, lineHeight: 1.5 }}>
        What Generate Doc (G-28) fills in that Monday doesn&apos;t hold: the firm&apos;s address, each attorney&apos;s
        details, and where each detention facility takes mail.
      </p>

      {error && (
        <div className="px-4 py-2 rounded-lg mb-3 text-sm" style={{ backgroundColor: "var(--color-status-red-bg)", color: "var(--color-status-red)" }}>
          {error}
        </div>
      )}

      {!settings ? (
        <p className="text-sm" style={{ color: "var(--color-ink-faint)" }}>Loading…</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <h3 style={subTitle}>Firm (shared by every attorney)</h3>
          <div className="flex flex-wrap gap-2">
            {firmField("name", "Firm name", 240)}
            {firmField("street", "Street", 220)}
            {firmField("suite", "Suite", 70)}
            {firmField("city", "City", 130)}
            {firmField("state", "State", 50)}
            {firmField("zip", "ZIP", 70)}
            {firmField("phone", "Phone", 120)}
            {firmField("fax", "Fax", 120)}
          </div>

          <h3 style={subTitle}>Attorneys</h3>
          <table>
            <thead>
              <tr>
                <th style={th}>First name</th><th style={th}>Last name</th><th style={th}>Email</th><th style={th}>Mobile</th>
                <th style={th}>USCIS account</th><th style={th}>Bar(s) — first goes on the form</th><th />
              </tr>
            </thead>
            <tbody>
              {settings.attorneys.map((a, i) => (
                <tr key={a.id || i}>
                  <Cell value={a.givenName} width={90} onChange={(v) => setAttorney(i, { givenName: v })} />
                  <Cell value={a.familyName} width={130} onChange={(v) => setAttorney(i, { familyName: v })} />
                  <Cell value={a.email} width={200} onChange={(v) => setAttorney(i, { email: v })} />
                  <Cell value={a.mobile} width={110} onChange={(v) => setAttorney(i, { mobile: v })} />
                  <Cell value={a.uscisAccount} width={120} onChange={(v) => setAttorney(i, { uscisAccount: v })} />
                  <Cell value={bars[i] ?? ""} width={170} placeholder="MO 57287, KS 20857"
                    onChange={(v) => { setBars((b) => b.map((x, j) => (j === i ? v : x))); setSavedAt(null); }} />
                  <td>
                    <button type="button" className="text-xs px-2" style={{ color: "var(--color-ink-faint)" }} aria-label={`Remove ${a.givenName}`}
                      onClick={() => { touch((s) => ({ ...s, attorneys: s.attorneys.filter((_, j) => j !== i) })); setBars((b) => b.filter((_, j) => j !== i)); }}>
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="text-xs mt-1 hover:underline" style={{ color: "var(--color-ink-muted)" }}
            onClick={() => { touch((s) => ({ ...s, attorneys: [...s.attorneys, { id: "", givenName: "", familyName: "", email: "", mobile: "", uscisAccount: "", bars: [], defaultBar: "" }] })); setBars((b) => [...b, ""]); }}>
            + Add attorney
          </button>

          <h3 style={subTitle}>Detention facilities</h3>
          <p className="text-xs mb-1" style={{ color: "var(--color-ink-faint)" }}>
            &quot;Monday label&quot; must match the court case&apos;s Det. Facility exactly. The G-28 street line reads &quot;IN ICE CUSTODY &lt;street&gt;&quot;.
          </p>
          <table>
            <thead>
              <tr>
                <th style={th}>Monday label</th><th style={th}>Name</th><th style={th}>Street</th><th style={th}>City</th><th style={th}>State</th><th style={th}>ZIP</th><th />
              </tr>
            </thead>
            <tbody>
              {settings.facilities.map((f, i) => (
                <tr key={i}>
                  <Cell value={f.label} width={140} onChange={(v) => setFacility(i, { label: v })} />
                  <Cell value={f.name} width={200} onChange={(v) => setFacility(i, { name: v })} />
                  <Cell value={f.street} width={170} onChange={(v) => setFacility(i, { street: v })} />
                  <Cell value={f.city} width={120} onChange={(v) => setFacility(i, { city: v })} />
                  <Cell value={f.state} width={44} onChange={(v) => setFacility(i, { state: v.toUpperCase() })} />
                  <Cell value={f.zip} width={70} onChange={(v) => setFacility(i, { zip: v })} />
                  <td>
                    <button type="button" className="text-xs px-2" style={{ color: "var(--color-ink-faint)" }} aria-label={`Remove ${f.label}`}
                      onClick={() => touch((s) => ({ ...s, facilities: s.facilities.filter((_, j) => j !== i) }))}>
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="text-xs mt-1 hover:underline" style={{ color: "var(--color-ink-muted)" }}
            onClick={() => touch((s) => ({ ...s, facilities: [...s.facilities, { label: "", name: "", street: "", city: "", state: "", zip: "" }] }))}>
            + Add facility
          </button>

          <div className="flex items-center gap-3 mt-4">
            <Button type="button" size="sm" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
            {savedAt && <span className="text-xs" style={{ color: "var(--color-ink-faint)" }}>Saved</span>}
          </div>
        </div>
      )}
    </section>
  );
}
