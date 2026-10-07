// =============================================================================
// NewContractModal — create a Fee K (contract) for a client
// =============================================================================
// Case type (the Fee Ks "Contract for..." dropdown, real options) + AF/FF/PF
// amounts. Creates the item on Monday via createContract, named "<client> —
// <case type>", auto-linked to the profile. Surcharges are NOT here (post-signing).
// The new Fee K gets a note — a For/Fees header (previewed here) plus the
// optional description — as an update and as a "Contract note" in its own
// Emails & Activities. Header format lives in the API's contractNoteText.
// Opened without a client (P14 Contracts), it starts with a client search; the
// rest of the form shows once one is picked. From P3.3 the client is fixed.
// The fields themselves are ContractFields, shared with M2's "this call
// requests a contract" section.
// =============================================================================

import { useEffect, useState } from "react";
import { createContract, searchClients } from "../api";
import type { SearchResult } from "../api";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import {
  ContractFields,
  emptyContractFields,
  toCreateContractInput,
  useContractCaseTypes,
  type ContractFieldValues,
} from "./ContractFields";

interface Props {
  /** Omit both to let the user pick the client first (P14). */
  profileLocalId?: string;
  clientName?: string;
  onClose: () => void;
  /** Told once the contract is created (or queued), e.g. so P4 can show it. */
  onCreated?: (contract: { name: string; pending: boolean }) => void;
}

export function NewContractModal({ profileLocalId, clientName, onClose, onCreated }: Props) {
  const clientFixed = profileLocalId != null;
  const [client, setClient] = useState<{ localId: string; name: string } | null>(
    profileLocalId != null ? { localId: profileLocalId, name: clientName ?? "" } : null,
  );
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      searchClients(q, ctrl.signal)
        .then((r) => setResults(r.slice(0, 8)))
        .catch(() => {});
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query]);

  const caseTypes = useContractCaseTypes();
  const [fields, setFields] = useState<ContractFieldValues>(emptyContractFields);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ name: string; pending: boolean } | null>(null);

  const submit = async () => {
    if (!client) { setError("Pick a client."); return; }
    if (!fields.caseType) { setError("Pick a case type."); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await createContract(client.localId, toCreateContractInput(fields));
      setDone({ name: res.name, pending: res.pending });
      onCreated?.({ name: res.name, pending: res.pending });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create contract");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent code="M11" className="gap-0 p-0 sm:max-w-[460px]">
        <DialogHeader className="gap-0.5 border-b border-border px-5 py-4 pr-12">
          <DialogTitle style={{ fontFamily: "var(--font-display)" }}>New contract (Fee K)</DialogTitle>
          <DialogDescription>{client ? client.name : "Pick a client"}</DialogDescription>
        </DialogHeader>

        <div className="px-5 py-4">
            {done ? (
              <div style={{ fontFamily: "var(--font-body)", fontSize: 14, color: "var(--color-ink)" }}>
                <p style={{ marginBottom: 8 }}>✓ Contract <strong>{done.name}</strong> {done.pending ? "queued (will sync to Monday shortly)" : "created in Monday"}.</p>
                <p style={{ fontSize: 12, color: "var(--color-ink-faint)" }}>It will appear in the Contracts list after the next sync.</p>
                <button type="button" onClick={onClose} className="mt-3 rounded-md px-3 py-1.5 text-sm" style={{ background: "var(--color-amber-light)", color: "var(--color-amber)", border: "none", cursor: "pointer" }}>Done</button>
              </div>
            ) : !client ? (
              <div style={{ display: "block", marginBottom: 4 }}>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--color-ink-muted)", marginBottom: 4, fontFamily: "var(--font-body)" }} htmlFor="m11-client">Client</label>
                <input id="m11-client" type="search" autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
                  placeholder="Name, phone, email…"
                  className="w-full rounded-md px-2 py-1.5 text-sm"
                  style={{ border: "1px solid var(--color-border-light)", background: "var(--color-surface)", color: "var(--color-ink)", fontFamily: "var(--font-body)" }} />
                {results.length > 0 && (
                  <ul className="mt-1 rounded-md overflow-hidden" style={{ border: "1px solid var(--color-border-light)" }}>
                    {results.map((r) => (
                      <li key={r.localId}>
                        <button type="button" className="w-full text-left px-3 py-1.5 text-sm"
                          style={{ color: "var(--color-ink)", background: "var(--color-card)", cursor: "pointer", fontFamily: "var(--font-body)" }}
                          onClick={() => { setClient({ localId: r.localId, name: r.name }); setQuery(""); setResults([]); setError(null); }}>
                          {r.name}
                          {r.phone ? <span style={{ color: "var(--color-ink-faint)" }}> · {r.phone}</span> : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {query.trim().length >= 2 && results.length === 0 && (
                  <p style={{ fontSize: 12, color: "var(--color-ink-faint)", marginTop: 6, fontFamily: "var(--font-body)" }}>No matching clients yet.</p>
                )}
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
                  <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
                </div>
              </div>
            ) : (
              <>
                {!clientFixed && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, fontSize: 13, fontFamily: "var(--font-body)", color: "var(--color-ink)" }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-ink-muted)" }}>Client</span>
                    <strong>{client.name}</strong>
                    <button type="button" onClick={() => setClient(null)} style={{ fontSize: 12, color: "var(--color-amber)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>Change</button>
                  </div>
                )}
                <ContractFields value={fields} onChange={setFields} />

                {error && <p role="alert" style={{ fontSize: 12, color: "var(--color-status-red)", marginBottom: 8 }}>{error}</p>}

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
                  <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
                  <Button type="button" onClick={submit} disabled={saving || caseTypes.length === 0}>
                    {saving ? "Creating…" : "Create contract"}
                  </Button>
                </div>
              </>
            )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
