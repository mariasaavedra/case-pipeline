// =============================================================================
// UrgencySettingsSection — admin editor for how urgency is scored
// =============================================================================
// The date thresholds that drive the Active Cases board's urgency columns, plus
// whether a status's own urgency (set in the Status Tags editor) reorders the
// board or is only a visual marker.
// =============================================================================

import { useEffect, useState } from "react";
import { fetchUrgencySettings, updateUrgencySettings, type UrgencySettings } from "../api";
import { Button } from "./ui/button";

export function UrgencySettingsSection() {
  const [settings, setSettings] = useState<UrgencySettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    fetchUrgencySettings()
      .then(setSettings)
      .catch((e: Error) => setError(e.message));
  }, []);

  function patch(p: Partial<UrgencySettings>) {
    setSettings((s) => (s ? { ...s, ...p } : s));
    setSavedAt(null);
  }

  async function save() {
    if (!settings) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await updateUrgencySettings(settings);
      setSettings(saved); // server clamps (e.g. soon ≥ critical)
      setSavedAt(Date.now());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const num = (v: number, onChange: (n: number) => void) => (
    <input
      type="number"
      min={0}
      value={v}
      onChange={(e) => onChange(Math.max(0, parseInt(e.target.value, 10) || 0))}
      className="text-sm px-2 py-1 rounded w-20"
      style={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border-light)", color: "var(--color-ink)" }}
    />
  );

  return (
    <section style={{ marginBottom: "40px" }}>
      <h2 style={{ fontFamily: "var(--font-display)", fontSize: 18, color: "var(--color-ink)", marginBottom: 4 }}>
        Urgency
      </h2>
      <p style={{ fontSize: 13, color: "var(--color-ink-faint)", fontFamily: "var(--font-body)", marginBottom: 16, maxWidth: 620 }}>
        How the Active Cases board scores urgency by a case's target date, and whether a status's own
        urgency (set under Status Tags) reorders the board.
      </p>

      {error && (
        <div className="px-4 py-2 rounded-lg mb-3 text-sm" style={{ backgroundColor: "var(--color-status-red-bg)", color: "var(--color-status-red)" }}>
          {error}
        </div>
      )}

      {!settings ? (
        <p className="text-sm" style={{ color: "var(--color-ink-faint)" }}>Loading…</p>
      ) : (
        <div className="flex flex-col gap-4" style={{ maxWidth: 620 }}>
          <div className="flex items-center gap-2 flex-wrap text-sm" style={{ color: "var(--color-ink)", fontFamily: "var(--font-body)" }}>
            <span>A target within</span>
            {num(settings.criticalDays, (n) => patch({ criticalDays: n }))}
            <span>days is</span>
            <span className="status-pill" style={{ backgroundColor: "var(--color-status-red-bg)", color: "var(--color-status-red)" }}>critical</span>
            <span>, within</span>
            {num(settings.soonDays, (n) => patch({ soonDays: n }))}
            <span>days is</span>
            <span className="status-pill" style={{ backgroundColor: "var(--color-status-yellow-bg)", color: "var(--color-status-yellow)" }}>soon</span>
            <span>.</span>
          </div>

          <label className="flex items-start gap-2 text-sm" style={{ color: "var(--color-ink)", fontFamily: "var(--font-body)", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={settings.statusUrgencyAffectsBoard}
              onChange={(e) => patch({ statusUrgencyAffectsBoard: e.target.checked })}
              style={{ marginTop: 3 }}
            />
            <span>
              <strong>Status urgency reorders the board.</strong>
              <span style={{ color: "var(--color-ink-faint)" }}>
                {" "}When on, a status you flag as urgent combines with the case's date (most urgent
                wins) and lifts it up the board. When off, that flag is only a marker on the badge.
              </span>
            </span>
          </label>

          <div>
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving…" : savedAt ? "Saved ✓" : "Save"}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
