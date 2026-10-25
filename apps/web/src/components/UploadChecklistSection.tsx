// =============================================================================
// UploadChecklistSection — the Buzón checklist inside M30 (docs/features/buzon.md)
// =============================================================================
// What the client's Buzón page asks them to send. Staff add a Fee K's list (from
// its Fee K Type, Settings → Firm → Fee K Types) or one document by hand, mark
// one "Already have it" (the client stops seeing it), ask again for one that
// came in unreadable, or remove one nothing was sent for. The list belongs to
// the client, not the link: a new link shows the same list.
// API = routes/upload-checklist.ts.
// =============================================================================

import { useEffect, useState } from "react";
import {
  addChecklistItem, addConsultChecklist, addFeeKChecklist, fetchConsultLists, fetchUploadChecklist, removeChecklistItem, updateChecklistItem,
  type ChecklistItemInfo, type ConsultList, type UploadChecklist,
} from "../api";
import { Button } from "./ui/button";
import { shortDate } from "./UploadLinkModal";

const inputStyle = { border: "1px solid var(--color-border-light)", background: "var(--color-surface)", color: "var(--color-ink)" } as const;

/**
 * In the consult prep (M18): the documents the client was asked to send for
 * this consult and which came in, so the attorney sees them before the meeting.
 * Nothing when no consult list was added.
 */
export function ConsultBuzonItems({ profileLocalId, appointmentMondayId }: { profileLocalId: string; appointmentMondayId: string }) {
  const [items, setItems] = useState<ChecklistItemInfo[] | null>(null);
  useEffect(() => {
    fetchUploadChecklist(profileLocalId)
      .then((l) => setItems(l.items.filter((i) => i.appointmentMondayId === appointmentMondayId && i.status !== "not_needed")))
      .catch(() => setItems([]));
  }, [profileLocalId, appointmentMondayId]);
  if (!items?.length) return null;
  const have = items.filter((i) => i.status === "received").length;
  return (
    <li style={{ fontSize: 13, fontFamily: "var(--font-body)" }} data-testid="consult-buzon">
      <span style={{ color: "var(--color-ink-muted)" }}>📤 Buzón for this consult: {have} of {items.length} in</span>
      <ul style={{ margin: "2px 0 0 21px" }}>
        {items.map((i) => (
          <li key={i.id} style={{ color: i.status === "received" ? "var(--color-status-green)" : "var(--color-ink-faint)" }}>
            {i.status === "received" ? "✓" : "·"} {i.labelEn}{i.files ? ` (${i.files} file${i.files === 1 ? "" : "s"})` : ""}
          </li>
        ))}
      </ul>
    </li>
  );
}

/** On P13 / P6 case cards: "📤 4 of 6 documents" from the client's Buzón. */
export function ChecklistCount({ documents }: { documents: { received: number; total: number } }) {
  const all = documents.received >= documents.total;
  return (
    <div style={{ color: all ? "var(--color-status-green)" : "var(--color-ink-muted)" }} title="From the client's Buzón (upload link) checklist">
      📤 {documents.received} of {documents.total} documents{all ? " ✓" : ""}
    </div>
  );
}

/** "Missing" / "✓ Received Oct 23 · 2 files" / "Already have it". */
export function itemStatusText(i: Pick<ChecklistItemInfo, "status" | "receivedAt" | "files">): string {
  if (i.status === "not_needed") return "Already have it";
  if (i.status === "received") return `✓ Received${i.receivedAt ? ` ${shortDate(i.receivedAt)}` : ""}${i.files ? ` · ${i.files} file${i.files === 1 ? "" : "s"}` : ""}`;
  return i.files ? `Asked again · ${i.files} file${i.files === 1 ? "" : "s"} so far` : "Missing";
}

export function UploadChecklistSection({ profileLocalId, consult }: {
  profileLocalId: string;
  /** Opened from a consult: its consult lists come first, for that appointment. */
  consult?: { mondayId: string; label: string } | null;
}) {
  const [list, setList] = useState<UploadChecklist | null>(null);
  const [consultLists, setConsultLists] = useState<ConsultList[]>([]);
  const [pickedConsult, setPickedConsult] = useState<string>(consult?.mondayId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [en, setEn] = useState("");
  const [es, setEs] = useState("");
  const [feeK, setFeeK] = useState("");

  useEffect(() => {
    fetchUploadChecklist(profileLocalId)
      .then((l) => { setList(l); setPickedConsult((p) => p || l.consults?.[0]?.mondayId || ""); })
      .catch((e: Error) => setError(e.message));
    fetchConsultLists().then((c) => setConsultLists(c.lists)).catch(() => setConsultLists([]));
  }, [profileLocalId]);

  async function run(fn: () => Promise<UploadChecklist>) {
    setBusy(true);
    setError(null);
    try {
      setList(await fn());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!list) return error ? <p role="alert" className="text-xs" style={{ color: "var(--color-status-red)" }}>{error}</p> : null;

  const asked = list.items.filter((i) => i.required && i.status !== "not_needed");
  const have = asked.filter((i) => i.status === "received").length;
  const offer = list.feeKs.filter((k) => k.documents > 0 && !k.added);

  const addOne = () =>
    run(async () => {
      const r = await addChecklistItem(profileLocalId, { labelEn: en, labelEs: es || undefined, feeKLocalId: feeK || undefined });
      setEn("");
      setEs("");
      setAdding(false);
      return r;
    });

  return (
    <div className="space-y-2" data-testid="upload-checklist">
      <div className="flex items-baseline justify-between gap-3">
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-ink-muted)" }}>Documents to ask for</span>
        {asked.length > 0 && (
          <span className="text-xs" style={{ color: have === asked.length ? "var(--color-status-green)" : "var(--color-ink-muted)" }}>
            {have} of {asked.length} received
          </span>
        )}
      </div>

      {list.items.length === 0 && (
        <p className="text-xs" style={{ color: "var(--color-ink-faint)" }}>
          No checklist: the client's page just asks for "your documents".
        </p>
      )}

      {list.items.length > 0 && (
        <ul className="rounded-md" style={{ border: "1px solid var(--color-border-light)" }}>
          {list.items.map((i) => (
            <li key={i.id} className="flex items-start justify-between gap-3 px-3 py-2" style={{ borderTop: "1px solid var(--color-border-light)", opacity: i.status === "not_needed" ? 0.6 : 1 }}>
              <div className="min-w-0">
                <p>
                  {i.labelEn}
                  {!i.required && <span className="text-xs" style={{ color: "var(--color-ink-faint)" }}> (optional)</span>}
                </p>
                <p className="text-xs" style={{ color: i.status === "received" ? "var(--color-status-green)" : "var(--color-ink-muted)" }}>
                  {itemStatusText(i)} <span style={{ color: "var(--color-ink-faint)" }}>· → {i.folder}</span>
                </p>
              </div>
              <div className="flex shrink-0 gap-2 text-xs">
                {i.status === "missing" ? (
                  <button type="button" className="underline" disabled={busy} onClick={() => run(() => updateChecklistItem(i.id, { status: "not_needed" }))}>
                    Already have it
                  </button>
                ) : (
                  <button type="button" className="underline" disabled={busy} onClick={() => run(() => updateChecklistItem(i.id, { status: "missing" }))}>
                    Ask again
                  </button>
                )}
                {i.files === 0 && (
                  <button type="button" className="underline" style={{ color: "var(--color-status-red)" }} disabled={busy} onClick={() => run(() => removeChecklistItem(i.id))}>
                    Remove
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {offer.map((k) => (
        <Button key={k.localId} type="button" size="sm" variant="outline" disabled={busy} onClick={() => run(() => addFeeKChecklist(profileLocalId, k.localId))}>
          + Add the {k.feeKTypes.join(" + ") || k.name} list ({k.documents} document{k.documents === 1 ? "" : "s"})
        </Button>
      ))}
      {consultLists.length > 0 && (list.consults?.length ?? 0) > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span style={{ color: "var(--color-ink-muted)" }}>For the consult</span>
          <select className="rounded px-1 py-1 text-xs" style={inputStyle} value={pickedConsult} aria-label="Which consult"
            onChange={(e) => setPickedConsult(e.target.value)}>
            {list.consults!.map((c) => <option key={c.mondayId} value={c.mondayId}>{c.date ? `${c.date} · ` : ""}{c.name}</option>)}
          </select>
          {consultLists
            .filter((l) => !list.consults!.find((c) => c.mondayId === pickedConsult)?.lists.includes(l.key))
            .map((l) => (
              <Button key={l.key} type="button" size="sm" variant="outline" disabled={busy || !pickedConsult}
                onClick={() => run(() => addConsultChecklist(profileLocalId, l.key, pickedConsult))}>
                + {l.name} ({l.documents.length})
              </Button>
            ))}
        </div>
      )}
      {list.feeKs.length > 0 && list.feeKs.every((k) => k.documents === 0) && (
        <p className="text-xs" style={{ color: "var(--color-ink-faint)" }}>
          This client's case types have no document list yet (Settings → Firm → Fee K Types → Documents…).
        </p>
      )}

      {adding ? (
        <div className="space-y-2 rounded-md px-3 py-2" style={{ border: "1px solid var(--color-border-light)" }}>
          <input className="w-full rounded px-2 py-1 text-sm" style={inputStyle} value={en} maxLength={120} placeholder="Document, in English"
            aria-label="Document name in English" onChange={(e) => setEn(e.target.value)} />
          <input className="w-full rounded px-2 py-1 text-sm" style={inputStyle} value={es} maxLength={120} placeholder="In Spanish (the client may see this one)"
            aria-label="Document name in Spanish" onChange={(e) => setEs(e.target.value)} />
          {list.feeKs.length > 0 && (
            <select className="w-full rounded px-1 py-1 text-sm" style={inputStyle} value={feeK} aria-label="For which case" onChange={(e) => setFeeK(e.target.value)}>
              <option value="">No case: goes to CAF</option>
              {list.feeKs.map((k) => <option key={k.localId} value={k.localId}>For {k.feeKTypes.join(" + ") || k.name}: goes to EVIDENCE</option>)}
            </select>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setAdding(false)}>Cancel</Button>
            <Button type="button" size="sm" disabled={busy || !en.trim()} onClick={addOne}>Add</Button>
          </div>
        </div>
      ) : (
        <button type="button" className="block text-xs underline" style={{ color: "var(--color-ink-muted)" }} onClick={() => setAdding(true)}>
          + Ask for one more document
        </button>
      )}

      {error && <p role="alert" className="text-xs" style={{ color: "var(--color-status-red)" }}>{error}</p>}
    </div>
  );
}
