// =============================================================================
// ConsultListsSection (P11.3.8) — document lists for consultations
// =============================================================================
// Named lists staff pick on a consult (P17 → Buzón → M30): what the client is
// asked to bring or send before / after the consult. Their files go to the
// Consult File → CONSULT. Same editor as Fee K Types → Documents… Until the
// first save the starting lists are shown (and used: picking a list is always
// a person's choice). docs/features/buzon.md, Phase 5.
// Admin-only (the tab is); saved to data/consult-lists.json, audited.
// =============================================================================

import { useEffect, useState } from "react";
import { fetchConsultLists, updateConsultLists, type ConsultList } from "../api";
import { Button } from "./ui/button";
import { SectionCode } from "./ScreenCode";
import { settingsSectionTitle } from "./settingsStyles";
import { DocumentsEditor } from "./FeeKTypesSection";

const inputStyle = { backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border-light)", color: "var(--color-ink)", fontFamily: "var(--font-body)" } as const;

export function ConsultListsSection() {
  const [lists, setLists] = useState<ConsultList[] | null>(null);
  const [draft, setDraft] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetchConsultLists().then((r) => { setLists(r.lists); setDraft(r.draft); }).catch((e: Error) => setError(e.message));
  }, []);

  const edit = (i: number, p: Partial<ConsultList>) => { setLists((ls) => ls && ls.map((l, j) => (j === i ? { ...l, ...p } : l))); setSaved(false); };

  async function save() {
    if (!lists) return;
    setSaving(true);
    setError(null);
    try {
      const r = await updateConsultLists(lists);
      setLists(r.lists);
      setDraft(r.draft);
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
        Consult document lists
        <SectionCode code="P11.3.8" inline />
      </h2>
      <p style={{ fontSize: 13, color: "var(--color-ink-faint)", fontFamily: "var(--font-body)", marginBottom: 8, lineHeight: 1.5 }}>
        What a client is asked to send for a consultation. Reception picks a list on the consult (Reception → <strong>Buzón</strong>);
        the files go to the client&apos;s Consult File → CONSULT. The client sees the document names, so keep them plain.
      </p>
      {draft && lists && (
        <div className="px-4 py-2 rounded-lg mb-3 text-sm" style={{ backgroundColor: "var(--color-status-yellow-bg)", color: "var(--color-ink)" }}>
          <strong>Starting lists.</strong> Check the documents and the Spanish, then <strong>Save</strong>.
        </div>
      )}
      {error && <p role="alert" className="text-sm mb-2" style={{ color: "var(--color-status-red)" }}>{error}</p>}
      {!lists ? (
        !error && <p className="text-sm" style={{ color: "var(--color-ink-faint)" }}>Loading…</p>
      ) : (
        <div className="space-y-2">
          {lists.map((l, i) => (
            <div key={l.key || i} className="rounded px-3 py-2" style={{ border: "1px solid var(--color-border-light)" }}>
              <div className="flex items-center gap-2 flex-wrap">
                <input className="text-sm px-2 py-1 rounded" style={{ ...inputStyle, flex: "1 1 220px" }} value={l.name} maxLength={80}
                  aria-label={`Consult list ${i + 1} name`} onChange={(e) => edit(i, { name: e.target.value })} />
                <button type="button" className="text-xs underline" style={{ color: "var(--color-ink-muted)" }} aria-expanded={open === i}
                  onClick={() => setOpen(open === i ? null : i)}>
                  Documents ({l.documents.length})
                </button>
                <button type="button" className="text-xs underline" style={{ color: "var(--color-status-red)" }}
                  onClick={() => { setLists((ls) => ls && ls.filter((_, j) => j !== i)); setSaved(false); }}>
                  Remove
                </button>
              </div>
              {open === i && (
                <div className="mt-2">
                  <DocumentsEditor feeKType={l.name || "this list"} documents={l.documents} onChange={(documents) => edit(i, { documents })} />
                </div>
              )}
            </div>
          ))}
          <button type="button" className="text-xs underline" style={{ color: "var(--color-ink-muted)" }}
            onClick={() => { setLists((ls) => [...(ls ?? []), { key: "", name: "Consult – ", documents: [] }]); setOpen(lists.length); setSaved(false); }}>
            + Add a list
          </button>
          <div className="flex items-center gap-3">
            <Button type="button" size="sm" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
            {saved && <span className="text-xs" style={{ color: "var(--color-ink-faint)" }}>Saved</span>}
          </div>
        </div>
      )}
    </section>
  );
}
