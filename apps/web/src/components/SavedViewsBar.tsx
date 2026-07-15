import { useState, useEffect } from "react";
import { getSavedViews, addSavedView, deleteSavedView } from "../api";
import type { SavedViewItem } from "../api";

interface Props {
  /** Current filter values (flat string map). */
  filters: Record<string, string>;
  /** Apply a set of filter values (resets others). */
  applyFilters: (updates: Record<string, string>) => void;
  hasActiveFilters: boolean;
}

/** Saved filter sets for the Clients page — save the current filters, re-apply, or delete. */
export function SavedViewsBar({ filters, applyFilters, hasActiveFilters }: Props) {
  const [views, setViews] = useState<SavedViewItem[]>([]);
  const [name, setName] = useState("");
  const [showSave, setShowSave] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getSavedViews("clients").then(setViews).catch(() => {});
  }, []);

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const v = await addSavedView(name.trim(), "clients", filters);
      setViews((prev) => [...prev, v].sort((a, b) => a.name.localeCompare(b.name)));
      setName("");
      setShowSave(false);
    } catch {
      /* ignore */
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: number) {
    try {
      await deleteSavedView(id);
      setViews((prev) => prev.filter((v) => v.id !== id));
    } catch {
      /* ignore */
    }
  }

  function apply(v: SavedViewItem) {
    // Clear every current key, then overlay the saved values.
    const cleared: Record<string, string> = {};
    for (const k of Object.keys(filters)) cleared[k] = "";
    applyFilters({ ...cleared, ...((v.filters as Record<string, string>) ?? {}) });
  }

  if (views.length === 0 && !hasActiveFilters) return null;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", margin: "0 0 12px" }}>
      {views.map((v) => (
        <span key={v.id} className="filter-chip" style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "default" }}>
          <button
            onClick={() => apply(v)}
            style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit", padding: 0 }}
            title="Apply this saved view"
          >
            {v.name}
          </button>
          <button
            onClick={() => remove(v.id)}
            title="Delete saved view"
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-ink-faint)", padding: 0, lineHeight: 1, fontSize: 14 }}
          >
            ×
          </button>
        </span>
      ))}

      {hasActiveFilters &&
        (showSave ? (
          <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && save()}
              placeholder="View name"
              autoFocus
              style={{
                padding: "4px 8px",
                borderRadius: 8,
                border: "1px solid var(--color-border)",
                background: "var(--color-card)",
                color: "var(--color-ink)",
                fontFamily: "var(--font-body)",
                fontSize: 12,
              }}
            />
            <button onClick={save} disabled={saving || !name.trim()} className="filter-chip filter-chip-active">
              Save
            </button>
            <button onClick={() => { setShowSave(false); setName(""); }} className="filter-chip">
              Cancel
            </button>
          </span>
        ) : (
          <button onClick={() => setShowSave(true)} className="filter-chip">
            + Save current filters
          </button>
        ))}
    </div>
  );
}
