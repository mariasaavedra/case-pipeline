// =============================================================================
// StatusTagsSection — admin editor for status label/color overrides
// =============================================================================
// Lists every status that exists in the synced data and lets an admin rename it
// and/or recolor it. Edits accumulate locally; "Save" writes the whole override
// map and refreshes it app-wide so every badge updates. Statuses with no override
// still render (via the code-seeded base map + keyword tone inference); the
// editor just makes those firm-tunable.
// =============================================================================

import { useEffect, useMemo, useState } from "react";
import {
  fetchStatusCatalog,
  updateStatusOverrides,
  type StatusCatalogEntry,
  type StatusOverrides,
} from "../api";
import {
  STATUS_OVERRIDES,
  STATUS_TONES,
  translateStatus,
  type StatusRule,
  type StatusTone,
} from "../config";
import { useStatusOverridesAdmin } from "../StatusOverridesProvider";

const TONE_DOT: Record<StatusTone, string> = {
  green: "var(--color-status-green)",
  blue: "var(--color-status-blue)",
  yellow: "var(--color-status-yellow)",
  red: "var(--color-status-red)",
  gray: "var(--color-status-gray)",
  purple: "var(--color-status-purple)",
};

export function StatusTagsSection() {
  const { admin, refresh } = useStatusOverridesAdmin();
  const [catalog, setCatalog] = useState<StatusCatalogEntry[]>([]);
  const [draft, setDraft] = useState<StatusOverrides>({});
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Seed the local draft from the saved admin layer whenever it (re)loads.
  useEffect(() => {
    setDraft({ ...admin });
  }, [admin]);

  useEffect(() => {
    fetchStatusCatalog()
      .then(setCatalog)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(admin), [draft, admin]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? catalog.filter((c) => c.status.toLowerCase().includes(q)) : catalog;
  }, [catalog, query]);

  /** The effective rule for a status under the current draft (base ∪ draft). */
  function effective(status: string): { label: string; tone: StatusTone } {
    return translateStatus(status, { ...STATUS_OVERRIDES, ...draft });
  }

  function setRule(status: string, patch: Partial<StatusRule>) {
    setDraft((prev) => {
      const cur = effective(status);
      const next: StatusRule = {
        label: patch.label ?? prev[status]?.label ?? (cur.label === status ? undefined : cur.label),
        tone: (patch.tone ?? prev[status]?.tone ?? cur.tone) as StatusTone,
      };
      if (!next.label) delete next.label;
      return { ...prev, [status]: next };
    });
    setSavedAt(null);
  }

  function resetRule(status: string) {
    setDraft((prev) => {
      const { [status]: _drop, ...rest } = prev;
      return rest;
    });
    setSavedAt(null);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await updateStatusOverrides(draft);
      refresh(); // re-fetch → merged map updates → every badge repaints
      setSavedAt(Date.now());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section style={{ marginBottom: "40px" }}>
      <h2 style={{ fontFamily: "var(--font-display)", fontSize: 18, color: "var(--color-ink)", marginBottom: 4 }}>
        Status Tags
      </h2>
      <p style={{ fontSize: 13, color: "var(--color-ink-faint)", fontFamily: "var(--font-body)", marginBottom: 16, maxWidth: 620 }}>
        How each Monday status reads across the dashboard. Rename a status or change its color; the
        change applies everywhere for everyone. Statuses you don't touch keep a sensible default.
      </p>

      {error && (
        <div className="px-4 py-2 rounded-lg mb-3 text-sm" style={{ backgroundColor: "var(--color-status-red-bg)", color: "var(--color-status-red)" }}>
          {error}
        </div>
      )}

      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter statuses…"
          className="text-sm px-3 py-1.5 rounded-lg flex-1 min-w-[200px]"
          style={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border-light)", color: "var(--color-ink)", fontFamily: "var(--font-body)" }}
        />
        <button
          onClick={save}
          disabled={!dirty || saving}
          className="text-sm px-3 py-1.5 rounded-lg font-medium"
          style={{
            backgroundColor: dirty ? "var(--color-amber)" : "var(--color-surface-warm)",
            color: dirty ? "#fff" : "var(--color-ink-faint)",
            border: "none",
            cursor: dirty && !saving ? "pointer" : "default",
            fontFamily: "var(--font-body)",
          }}
        >
          {saving ? "Saving…" : savedAt ? "Saved ✓" : dirty ? "Save changes" : "No changes"}
        </button>
      </div>

      {loading ? (
        <p className="text-sm" style={{ color: "var(--color-ink-faint)" }}>Loading statuses…</p>
      ) : (
        <div style={{ maxHeight: 460, overflowY: "auto", border: "1px solid var(--color-border-light)", borderRadius: 10 }}>
          <table className="w-full text-sm" style={{ borderCollapse: "collapse", fontFamily: "var(--font-body)" }}>
            <tbody>
              {filtered.map((entry) => {
                const eff = effective(entry.status);
                const overridden = !!draft[entry.status];
                return (
                  <tr key={entry.status} style={{ borderBottom: "1px solid var(--color-border-light)" }}>
                    {/* Raw status + count */}
                    <td className="px-3 py-2 align-middle" style={{ minWidth: 200 }}>
                      <div style={{ color: "var(--color-ink)" }}>{entry.status}</div>
                      <div className="text-[11px]" style={{ color: "var(--color-ink-faint)" }}>{entry.count} case{entry.count === 1 ? "" : "s"}</div>
                    </td>

                    {/* Live preview under the draft */}
                    <td className="px-3 py-2 align-middle" style={{ whiteSpace: "nowrap" }}>
                      <span className="status-pill" style={{ backgroundColor: `var(--color-status-${eff.tone}-bg)`, color: `var(--color-status-${eff.tone})` }}>
                        {eff.label}
                      </span>
                    </td>

                    {/* Label editor */}
                    <td className="px-3 py-2 align-middle">
                      <input
                        value={draft[entry.status]?.label ?? ""}
                        onChange={(e) => setRule(entry.status, { label: e.target.value })}
                        placeholder={entry.status}
                        className="text-sm px-2 py-1 rounded w-full"
                        style={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border-light)", color: "var(--color-ink)", minWidth: 140 }}
                      />
                    </td>

                    {/* Color chips */}
                    <td className="px-3 py-2 align-middle">
                      <div className="flex items-center gap-1.5">
                        {STATUS_TONES.map((tone) => (
                          <button
                            key={tone}
                            onClick={() => setRule(entry.status, { tone })}
                            title={tone}
                            aria-label={tone}
                            style={{
                              width: 18, height: 18, borderRadius: "50%",
                              backgroundColor: TONE_DOT[tone],
                              border: eff.tone === tone ? "2px solid var(--color-ink)" : "2px solid transparent",
                              cursor: "pointer",
                            }}
                          />
                        ))}
                      </div>
                    </td>

                    {/* Reset */}
                    <td className="px-3 py-2 align-middle" style={{ width: 60 }}>
                      {overridden && (
                        <button
                          onClick={() => resetRule(entry.status)}
                          className="text-[11px]"
                          style={{ background: "none", border: "none", color: "var(--color-ink-faint)", cursor: "pointer" }}
                          title="Remove this override"
                        >
                          Reset
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td className="px-3 py-6 text-center text-sm" style={{ color: "var(--color-ink-faint)" }}>No statuses match that filter.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Legend: each tone shown in its own colors */}
      <div className="flex items-center gap-2 mt-3 flex-wrap">
        <span className="text-[11px]" style={{ color: "var(--color-ink-faint)" }}>Tones:</span>
        {STATUS_TONES.map((t) => (
          <span key={t} className="status-pill" style={{ backgroundColor: `var(--color-status-${t}-bg)`, color: `var(--color-status-${t})` }}>
            {t}
          </span>
        ))}
      </div>
    </section>
  );
}
