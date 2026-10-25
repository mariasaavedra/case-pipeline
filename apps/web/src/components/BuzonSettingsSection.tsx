// =============================================================================
// BuzonSettingsSection (P11.3.7) — the Buzón's own texts, firm-wide
// =============================================================================
// Whether the link goes out on its own when a Fee K reaches Paid needs action
// (the server also needs BUZON_AUTO + BUZON_AUTO_SINCE), whether reminders run
// and on which days, office hours for texts, and the "we received your
// documents" text. Each client can be switched off in M30. The words are the
// "Buzón: …" templates in Text templates above. docs/features/buzon.md.
// Admin-only (the tab is); saved to data/buzon-settings.json, audited.
// =============================================================================

import { useEffect, useState } from "react";
import { fetchBuzonSettings, updateBuzonSettings, type BuzonSettings, type BuzonSettingsInfo } from "../api";
import { Button } from "./ui/button";
import { SectionCode } from "./ScreenCode";
import { settingsSectionTitle } from "./settingsStyles";

const inputStyle = { backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border-light)", color: "var(--color-ink)", fontFamily: "var(--font-body)" } as const;
const note = { fontSize: 13, color: "var(--color-ink-faint)", fontFamily: "var(--font-body)", lineHeight: 1.5 } as const;

/** "3, 7, 14" → [3, 7, 14]; anything else is dropped (the server cleans up too). */
export function parseDays(text: string): number[] {
  return [...new Set(text.split(/[\s,;]+/).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 90))].sort((a, b) => a - b);
}

const hourLabel = (h: number) => (h === 0 || h === 24 ? "12 AM" : h === 12 ? "12 PM" : h < 12 ? `${h} AM` : `${h - 12} PM`);

export function BuzonSettingsSection() {
  const [info, setInfo] = useState<BuzonSettingsInfo | null>(null);
  const [s, setS] = useState<BuzonSettings | null>(null);
  const [daysText, setDaysText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetchBuzonSettings()
      .then((i) => { setInfo(i); setS(i.settings); setDaysText(i.settings.reminders.days.join(", ")); })
      .catch((e: Error) => setError(e.message));
  }, []);

  const set = (p: Partial<BuzonSettings>) => { setS((x) => x && { ...x, ...p }); setSaved(false); };
  const setR = (p: Partial<BuzonSettings["reminders"]>) => { setS((x) => x && { ...x, reminders: { ...x.reminders, ...p } }); setSaved(false); };

  async function save() {
    if (!s) return;
    setSaving(true);
    setError(null);
    try {
      const i = await updateBuzonSettings({ ...s, reminders: { ...s.reminders, days: parseDays(daysText) } });
      setInfo(i);
      setS(i.settings);
      setDaysText(i.settings.reminders.days.join(", "));
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section style={{ marginBottom: "40px" }}>
      <h2 style={settingsSectionTitle}>
        Buzón texts
        <SectionCode code="P11.3.7" inline />
      </h2>
      <p style={{ ...note, marginBottom: 8 }}>
        The texts the Buzón (client upload link) sends on its own. A client can be switched off in their Upload link popup
        (VAWA, U visa, anyone whose phone someone else may read). The words are the &quot;Buzón: …&quot; text templates above.
      </p>
      {error && <p role="alert" className="text-sm mb-2" style={{ color: "var(--color-status-red)" }}>{error}</p>}
      {!s || !info ? (
        !error && <p className="text-sm" style={{ color: "var(--color-ink-faint)" }}>Loading…</p>
      ) : (
        <div className="space-y-4 text-sm" style={{ color: "var(--color-ink)", fontFamily: "var(--font-body)" }}>
          <div>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={s.autoText} onChange={(e) => set({ autoText: e.target.checked })} />
              Text the link when a Fee K reaches <strong>Paid needs action</strong>
            </label>
            <p style={{ ...note, marginLeft: 24 }}>
              {info.autoStart
                ? `The automatic start is on for Fee Ks paid since ${info.autoStart.since}. Only case types with a document list (Fee K Types → Documents…) get one.`
                : "The automatic start is off on the server (BUZON_AUTO). Staff send the Buzón from the client's Upload link."}
              {info.smsMode !== "on" && ` Texting is ${info.smsMode === "off" ? "off" : "in test mode"} (SMS_MODE).`}
            </p>
          </div>

          <div>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={s.reminders.on} onChange={(e) => setR({ on: e.target.checked })} />
              Send reminders while documents are missing
            </label>
            <div className="mt-2 flex flex-wrap items-center gap-3" style={{ marginLeft: 24, opacity: s.reminders.on ? 1 : 0.6 }}>
              <label className="flex items-center gap-2">
                Days after the first text
                <input className="px-2 py-1 rounded text-sm" style={{ ...inputStyle, width: 120 }} value={daysText}
                  aria-label="Reminder days" placeholder="3, 7, 14" onChange={(e) => { setDaysText(e.target.value); setSaved(false); }} />
              </label>
              <label className="flex items-center gap-2">
                From
                <select className="px-1 py-1 rounded text-sm" style={inputStyle} value={s.reminders.fromHour} aria-label="Texts from"
                  onChange={(e) => setR({ fromHour: Number(e.target.value) })}>
                  {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
                </select>
                to
                <select className="px-1 py-1 rounded text-sm" style={inputStyle} value={s.reminders.toHour} aria-label="Texts until"
                  onChange={(e) => setR({ toHour: Number(e.target.value) })}>
                  {Array.from({ length: 24 }, (_, h) => h + 1).map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={s.reminders.weekdaysOnly} onChange={(e) => setR({ weekdaysOnly: e.target.checked })} />
                Weekdays only
              </label>
            </div>
            <p style={{ ...note, marginLeft: 24 }}>
              One reminder per day listed, at most one text a day, firm time. After the last one, the case&apos;s paralegal and assistant are told.
            </p>
          </div>

          <label className="flex items-center gap-2">
            <input type="checkbox" checked={s.receivedText} onChange={(e) => set({ receivedText: e.target.checked })} />
            Text &quot;we received your documents&quot; (and what is still missing) after the client sends files
          </label>

          <div className="flex items-center gap-3">
            <Button type="button" size="sm" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
            {saved && <span className="text-xs" style={{ color: "var(--color-ink-faint)" }}>Saved</span>}
          </div>
        </div>
      )}
    </section>
  );
}
